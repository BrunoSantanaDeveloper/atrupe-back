import {
  Injectable,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../config/prisma/prisma.service';
import { EncryptionService } from '../../../shared/services/encryption.service';
import { FiscalAuditService } from '../shared/fiscal-audit.service';
import { FiscalCredentialResolverService } from '../shared/fiscal-credential-resolver.service';
import { problemaNoCsc } from '../utils/csc.util';
import { InvoicyHttpService } from './invoicy-http.service';
import {
  FiscalConfigAction,
  ActorType,
  FiscalEnvironment,
} from '@prisma/client';
import { InvoicyEnvironment } from './invoicy.types';

@Injectable()
export class InvoicyCompanyRegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryptionService: EncryptionService,
    private readonly fiscalAuditService: FiscalAuditService,
    private readonly invoicyHttpService: InvoicyHttpService,
    private readonly fiscalCredentialResolver: FiscalCredentialResolverService,
  ) {}

  /**
   * Garante que o emissor está cadastrado no Invoicy para o ambiente especificado.
   * Se já existe, retorna sem fazer nada. Se não existe, registra e persiste a access key cifrada.
   * Idempotente: seguro para re-execução.
   */
  async ensureRegistered(
    companyId: string,
    invoicyConfigId: string,
    environment: FiscalEnvironment,
    signal?: AbortSignal,
  ): Promise<void> {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      include: { address: true, DigitalCertificate: true },
    });

    const emissor = await this.prisma.invoicyConfig.findUniqueOrThrow({
      where: { id: invoicyConfigId },
    });

    // Ownership defensivo no nível do serviço (não confiar apenas no controller).
    if (emissor.companyId !== companyId) {
      throw new ForbiddenException('Emissor não pertence à empresa informada');
    }

    const cnpj = company.cnpj ?? '';

    // Check local credential first. If one exists AND the company is actually
    // registered in Invoicy, nothing to do.
    // We must verify with Invoicy because the backfill migration may have
    // populated this credential from the legacy company.accessKey without ever
    // calling POST /companies on the target environment — in that case the
    // credential is stale/wrong and we need to (re-)register.
    const localCred = await this.prisma.companyEnvironmentCredential.findUnique(
      {
        where: { companyId_environment: { companyId, environment } },
        select: { providerAccessKeyEncrypted: true },
      },
    );
    if (localCred?.providerAccessKeyEncrypted) {
      const alreadyInInvoicy =
        await this.invoicyHttpService.companyExistsInEnvironment(
          cnpj,
          environment as InvoicyEnvironment,
          signal,
        );
      if (alreadyInInvoicy) return;
      // Local credential exists but company is not in Invoicy for this env —
      // the credential is from the backfill and needs to be replaced.
    }

    // Selecionar o endereço Principal
    const address =
      (company.address ?? []).find((a: any) => a.type === 'Principal') ??
      company.address?.[0];

    // Decifrar certificado se disponível
    let certificate: string | undefined;
    let certificatePassword: string | undefined;
    const cert = company.DigitalCertificate;
    if (cert) {
      if (cert.certificateEncrypted) {
        certificate = this.encryptionService.decrypt(
          cert.certificateEncrypted,
          {
            table: 'digital_certificates',
            recordId: cert.id,
            companyId,
            field: 'certificateEncrypted',
            scope: 'GLOBAL',
          },
        );
      } else {
        certificate = cert.certificate ?? undefined;
      }

      if (cert.passwordEncrypted) {
        certificatePassword = this.encryptionService.decrypt(
          cert.passwordEncrypted,
          {
            table: 'digital_certificates',
            recordId: cert.id,
            companyId,
            field: 'passwordEncrypted',
            scope: 'GLOBAL',
          },
        );
      } else {
        certificatePassword = cert.password ?? undefined;
      }
    }

    const registration = await this.invoicyHttpService.registerCompany({
      cnpj,
      razaoSocial: company.legalName || company.name,
      nomeFantasia: company.name,
      ie: company.stateRegistration || undefined,
      im: company.municipalRegistration || undefined,
      uf: address?.state || undefined,
      codigoIbge: emissor.emitCmun || undefined,
      cep: address?.zipcode || undefined,
      logradouro: address?.street || undefined,
      numero: address?.number || undefined,
      bairro: address?.neighborhood || undefined,
      cidade: address?.city || undefined,
      certificate,
      certificatePassword,
      certificateType: cert?.type || undefined,
      environment: environment as InvoicyEnvironment,
      signal,
    });

    // Gravar access key cifrada usando upsert-then-encrypt
    await this.fiscalAuditService.commitWithOutcome(
      {
        companyId,
        invoicyConfigId,
        emissorName: emissor.name,
        action: FiscalConfigAction.CREDENTIALS_ROTATE,
        actorType: ActorType.SYSTEM,
        createdByName: 'FiscalActivation',
        environment,
        description: `Empresa cadastrada no Invoicy (${environment}) durante ativação`,
        result: 'SUCCESS',
      },
      async (tx) => {
        // Upsert-then-encrypt para garantir id estável
        const row = await tx.companyEnvironmentCredential.upsert({
          where: { companyId_environment: { companyId, environment } },
          create: { companyId, environment, providerAccessKeyEncrypted: null },
          update: {},
          select: { id: true },
        });

        const providerAccessKeyEncrypted = this.encryptionService.encrypt(
          registration.accessKey,
          {
            table: 'company_environment_credentials',
            recordId: row.id,
            companyId,
            field: 'providerAccessKeyEncrypted',
            scope: environment,
          },
        );

        await tx.companyEnvironmentCredential.update({
          where: { id: row.id },
          data: { providerAccessKeyEncrypted },
        });
      },
    );

    // Invalidar cache de token pois access key foi gravada
    this.invoicyHttpService.clearTokenCache(
      companyId,
      environment as InvoicyEnvironment,
    );
  }

  /**
   * Reenvia ao Invoicy os dados cadastrais atuais da empresa.
   *
   * ensureRegistered so' envia esses dados na criacao do cadastro. Quem editar
   * razao social, IE ou endereco depois disso fica com o Invoicy defasado, e
   * documentos montados pelo provedor a partir do cadastro (DACCE) saem com
   * campos em branco.
   *
   * Sincroniza apenas ambientes em que a empresa ja' esta' cadastrada — nunca
   * cria cadastro novo. Devolve os ambientes efetivamente atualizados.
   */
  async syncRegistrationData(
    companyId: string,
    signal?: AbortSignal,
  ): Promise<FiscalEnvironment[]> {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      include: { address: true },
    });

    const cnpj = (company.cnpj ?? '').replace(/\D/g, '');
    const razaoSocial = company.legalName || company.name;

    if (!cnpj || !razaoSocial) {
      throw new BadRequestException(
        'Empresa sem CNPJ ou razão social: complete o cadastro antes de sincronizar com o Invoicy',
      );
    }

    const address =
      (company.address ?? []).find((a: any) => a.type === 'Principal') ??
      company.address?.[0];

    // O codigo IBGE fica no emissor, nao no endereco da empresa.
    const emissor = await this.prisma.invoicyConfig.findFirst({
      where: { companyId },
      orderBy: { createdAt: 'asc' },
      select: { emitCmun: true },
    });

    // O PUT reescreve o cadastro inteiro: campo que for vazio aqui apaga o que
    // existe no provedor. Como o cadastro atual pode estar MAIS completo que o
    // nosso, so' sincronizamos com o endereco inteiro em maos.
    const missing = [
      !address?.street && 'logradouro',
      !address?.number && 'número',
      !address?.neighborhood && 'bairro',
      !address?.zipcode && 'CEP',
      !emissor?.emitCmun && 'código IBGE do município (emissor)',
    ].filter(Boolean);

    if (missing.length) {
      throw new BadRequestException(
        `Cadastro incompleto para sincronizar com o Invoicy — faltando: ${missing.join(', ')}. ` +
          'Sincronizar assim apagaria esses dados no provedor.',
      );
    }

    const credentials = await this.prisma.companyEnvironmentCredential.findMany(
      {
        where: { companyId, providerAccessKeyEncrypted: { not: null } },
        select: { environment: true },
      },
    );

    const updated: FiscalEnvironment[] = [];

    for (const { environment } of credentials) {
      await this.invoicyHttpService.updateCompanyRegistration({
        cnpj,
        razaoSocial,
        nomeFantasia: company.name,
        ie: company.stateRegistration || undefined,
        im: company.municipalRegistration || undefined,
        codigoIbge: emissor?.emitCmun || undefined,
        cep: address?.zipcode || undefined,
        logradouro: address?.street || undefined,
        numero: address?.number || undefined,
        bairro: address?.neighborhood || undefined,
        environment: environment as InvoicyEnvironment,
        signal,
      });
      updated.push(environment);
    }

    return updated;
  }

  /**
   * Envia ao cadastro da empresa no Invoicy o CSC da NFC-e salvo no emissor.
   *
   * O Invoicy monta o QR Code com o CSC do cadastro dele, não com o que vai na
   * nota; até aqui o CSC salvo no Atrupe nunca chegava lá. Chamado na ativação
   * da NFC-e, depois do ensureRegistered — trocar o CSC devolve o ambiente a
   * DRAFT, então todo CSC novo passa por aqui antes de valer.
   *
   * Formato errado é recusado com mensagem para quem configura (o identificador
   * de 18 dígitos que já existiu num emissor nunca caberia no provedor).
   */
  async syncNfceCsc(
    companyId: string,
    invoicyConfigId: string,
    environment: FiscalEnvironment,
    signal?: AbortSignal,
  ): Promise<{ alterado: boolean }> {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { cnpj: true },
    });
    const cnpj = (company.cnpj ?? '').replace(/\D/g, '');
    if (!cnpj) {
      throw new BadRequestException(
        'Empresa sem CNPJ: complete o cadastro antes de ativar a NFC-e.',
      );
    }

    const { cscId, cscToken } =
      await this.fiscalCredentialResolver.getEmissorCredentialsForValidation(
        companyId,
        invoicyConfigId,
        environment,
      );
    const problema = problemaNoCsc(cscId, cscToken);
    if (problema) {
      throw new BadRequestException(problema);
    }

    return this.invoicyHttpService.updateCompanyNfceCsc({
      cnpj,
      cscId,
      cscToken,
      environment: environment as InvoicyEnvironment,
      signal,
    });
  }
}
