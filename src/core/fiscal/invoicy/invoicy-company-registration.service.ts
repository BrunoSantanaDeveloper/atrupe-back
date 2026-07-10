import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../config/prisma/prisma.service';
import { EncryptionService } from '../../../shared/services/encryption.service';
import { FiscalAuditService } from '../shared/fiscal-audit.service';
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
}
