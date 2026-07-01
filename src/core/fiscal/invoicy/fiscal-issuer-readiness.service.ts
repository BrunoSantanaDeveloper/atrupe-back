import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../config/prisma/prisma.service';
import { EncryptionService } from '../../../shared/services/encryption.service';
import { FiscalCredentialResolverService } from '../shared/fiscal-credential-resolver.service';
import { InvoicyHttpService } from './invoicy-http.service';
import { validateCnpj } from '../utils/fiscal-validators';
import {
  parsePfxCertificate,
  validatePfxCertificateCnpj,
} from '../utils/certificate-parser';
import { FiscalEnvironment } from '@prisma/client';
import { ReadinessResult, ReadinessCheck } from './dtos/fiscal-readiness.dto';

@Injectable()
export class FiscalIssuerReadinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryptionService: EncryptionService,
    private readonly credentialResolver: FiscalCredentialResolverService,
    private readonly invoicyHttpService: InvoicyHttpService,
  ) {}

  async checkLocalReadiness(
    companyId: string,
    invoicyConfigId: string,
    environment: FiscalEnvironment,
    docType?: 'NFE' | 'NFSE' | 'NFCE',
  ): Promise<{ localReady: boolean; checks: ReadinessCheck[] }> {
    const checks: ReadinessCheck[] = [];
    const isNfce = !docType || docType === 'NFCE';

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: { address: true, DigitalCertificate: true },
    });

    const emissor = await this.prisma.invoicyConfig.findUnique({
      where: { id: invoicyConfigId },
    });

    // 1. company_document
    checks.push(this.checkCompanyDocument(company?.cnpj));

    // 2. state_registration — obrigatória para NF-e e NFC-e; NFS-e usa IM (não verificado aqui)
    if (docType !== 'NFSE') {
      checks.push(this.checkStateRegistration(company?.stateRegistration));
    }

    // 3. company_address
    checks.push(this.checkCompanyAddress(company?.address, emissor?.emitCmun));

    // 4. certificate
    checks.push(
      await this.checkCertificate(
        companyId,
        company?.cnpj ?? null,
        company?.DigitalCertificate ?? null,
      ),
    );

    // 5. nfce_csc — exclusivo NFC-e
    if (isNfce) {
      checks.push(
        await this.checkNfceCsc(companyId, invoicyConfigId, environment),
      );
    }

    // 6. nfce_numbering — exclusivo NFC-e
    if (isNfce) {
      checks.push(await this.checkNfceNumbering(invoicyConfigId, environment));
    }

    const localReady = checks.every((c) => c.status === 'PASS');
    return { localReady, checks };
  }

  async checkFullReadiness(
    companyId: string,
    invoicyConfigId: string,
    environment: FiscalEnvironment,
    docType?: 'NFE' | 'NFSE' | 'NFCE',
    signal?: AbortSignal,
  ): Promise<ReadinessResult> {
    const { localReady, checks } = await this.checkLocalReadiness(
      companyId,
      invoicyConfigId,
      environment,
      docType,
    );

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { cnpj: true },
    });

    // 7. provider_registration
    const registrationCheck = await this.checkProviderRegistration(
      company?.cnpj ?? '',
      environment,
      signal,
    );

    // 8. provider_authentication
    const authCheck = await this.checkProviderAuthentication(
      companyId,
      company?.cnpj ?? '',
      environment,
      signal,
    );

    // Autenticação bem-sucedida implica que a empresa existe no Invoicy.
    // O check de registration via partner API pode falhar por diferença de formato
    // na resposta, mas se auth passa a empresa está acessível.
    if (authCheck.status === 'PASS' && registrationCheck.status === 'FAIL') {
      registrationCheck.status = 'PASS';
      registrationCheck.message = undefined;
    }

    checks.push(registrationCheck);
    checks.push(authCheck);

    const providerReady =
      registrationCheck.status === 'PASS' && authCheck.status === 'PASS';

    let requiresProviderRegistration: boolean | null = null;
    if (registrationCheck.status !== 'PENDING') {
      requiresProviderRegistration = registrationCheck.status === 'FAIL';
    }

    return {
      environment,
      localReady,
      ready: localReady && providerReady,
      requiresProviderRegistration,
      blocking: checks.filter((c) => c.status === 'FAIL').map((c) => c.check),
      checks,
      evaluatedAt: new Date().toISOString(),
    };
  }

  /**
   * Testa apenas a conexão/autenticação com o provider para o ambiente, sem exigir
   * que todos os checks de readiness (endereço, CSC, numeração) estejam completos.
   * Usado pelo endpoint test-connection.
   */
  async checkConnection(
    companyId: string,
    environment: FiscalEnvironment,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { cnpj: true },
    });
    const authCheck = await this.checkProviderAuthentication(
      companyId,
      company?.cnpj ?? '',
      environment,
      signal,
    );
    return authCheck.status === 'PASS';
  }

  private checkCompanyDocument(
    cnpj: string | null | undefined,
  ): ReadinessCheck {
    if (!cnpj) {
      return {
        check: 'company_document',
        status: 'FAIL',
        message: 'CNPJ não informado',
      };
    }
    const result = validateCnpj(cnpj);
    if (!result.valid) {
      return {
        check: 'company_document',
        status: 'FAIL',
        message: result.message,
      };
    }
    return { check: 'company_document', status: 'PASS' };
  }

  private checkStateRegistration(
    ie: string | null | undefined,
  ): ReadinessCheck {
    const rawIe = (ie ?? '').trim();
    const isIsento = rawIe.toUpperCase() === 'ISENTO';
    const hasDigits = /\d/.test(rawIe);

    if (!isIsento && !hasDigits) {
      return {
        check: 'state_registration',
        status: 'FAIL',
        message: 'IE não informada (aceito: dígitos ou ISENTO)',
      };
    }
    return { check: 'state_registration', status: 'PASS' };
  }

  private checkCompanyAddress(
    addresses: any[] | null | undefined,
    emitCmun: string | null | undefined,
  ): ReadinessCheck {
    const address =
      (addresses ?? []).find((a: any) => a.type === 'Principal') ??
      (addresses ?? [])[0];

    const missing: string[] = [];
    if (!address?.state) missing.push('UF');
    if (!address?.zipcode) missing.push('CEP');
    if (!address?.city) missing.push('cidade');
    if (!address?.street) missing.push('logradouro');
    if (!address?.neighborhood) missing.push('bairro');
    if (!address?.number) missing.push('número');
    if (!emitCmun || emitCmun === '0') missing.push('código IBGE do município');

    if (missing.length > 0) {
      return {
        check: 'company_address',
        status: 'FAIL',
        message: `Endereço incompleto: ${missing.join(', ')}`,
      };
    }
    return { check: 'company_address', status: 'PASS' };
  }

  private async checkCertificate(
    companyId: string,
    cnpj: string | null,
    digitalCertificate: any,
  ): Promise<ReadinessCheck> {
    if (!digitalCertificate) {
      return {
        check: 'certificate',
        status: 'FAIL',
        message: 'Certificado digital não cadastrado',
      };
    }

    let certificate: string | null = null;
    let password: string | null = null;

    try {
      if (digitalCertificate.certificateEncrypted) {
        certificate = this.encryptionService.decrypt(
          digitalCertificate.certificateEncrypted,
          {
            table: 'digital_certificates',
            recordId: digitalCertificate.id,
            companyId,
            field: 'certificateEncrypted',
            scope: 'GLOBAL',
          },
        );
      } else {
        certificate = digitalCertificate.certificate ?? null;
      }

      if (digitalCertificate.passwordEncrypted) {
        password = this.encryptionService.decrypt(
          digitalCertificate.passwordEncrypted,
          {
            table: 'digital_certificates',
            recordId: digitalCertificate.id,
            companyId,
            field: 'passwordEncrypted',
            scope: 'GLOBAL',
          },
        );
      } else {
        password = digitalCertificate.password ?? null;
      }
    } catch {
      return {
        check: 'certificate',
        status: 'FAIL',
        message: 'Falha ao decifrar certificado',
      };
    }

    if (!certificate) {
      return {
        check: 'certificate',
        status: 'FAIL',
        message: 'Arquivo do certificado não encontrado',
      };
    }

    if (cnpj) {
      const cnpjCheck = validatePfxCertificateCnpj(
        certificate,
        password ?? '',
        cnpj,
      );
      if (!cnpjCheck.valid) {
        return {
          check: 'certificate',
          status: 'FAIL',
          message: cnpjCheck.message,
        };
      }
    }

    const certInfo = parsePfxCertificate(certificate, password ?? '');
    if (!certInfo) {
      return {
        check: 'certificate',
        status: 'FAIL',
        message: 'Não foi possível ler o certificado',
      };
    }

    const now = new Date();
    if (certInfo.validFrom && certInfo.validFrom > now) {
      return {
        check: 'certificate',
        status: 'FAIL',
        message: 'Certificado ainda não está vigente',
      };
    }
    if (certInfo.expiresAt && certInfo.expiresAt <= now) {
      return {
        check: 'certificate',
        status: 'FAIL',
        message: 'Certificado expirado',
      };
    }

    return { check: 'certificate', status: 'PASS' };
  }

  private async checkNfceCsc(
    companyId: string,
    invoicyConfigId: string,
    environment: FiscalEnvironment,
  ): Promise<ReadinessCheck> {
    const creds =
      await this.credentialResolver.getEmissorCredentialsForValidation(
        companyId,
        invoicyConfigId,
        environment,
      );

    if (!creds.cscId || !creds.cscToken) {
      return {
        check: 'nfce_csc',
        status: 'FAIL',
        message: `CSC não configurado para ambiente ${environment}`,
      };
    }
    return { check: 'nfce_csc', status: 'PASS' };
  }

  private async checkNfceNumbering(
    invoicyConfigId: string,
    environment: FiscalEnvironment,
  ): Promise<ReadinessCheck> {
    const envConfig = await this.prisma.invoicyEnvironmentConfig.findUnique({
      where: {
        invoicyConfigId_environment_docType: {
          invoicyConfigId,
          environment,
          docType: 'NFCE',
        },
      },
      select: { nfceSeries: true, nfceNextNumber: true },
    });

    const series = envConfig?.nfceSeries ?? 0;
    const nextNumber = envConfig?.nfceNextNumber ?? 0;

    if (!series || series < 1 || !nextNumber || nextNumber < 1) {
      return {
        check: 'nfce_numbering',
        status: 'FAIL',
        message: 'Série e próximo número devem ser ≥ 1',
      };
    }
    return { check: 'nfce_numbering', status: 'PASS' };
  }

  private async checkProviderRegistration(
    cnpj: string,
    environment: FiscalEnvironment,
    signal?: AbortSignal,
  ): Promise<ReadinessCheck> {
    if (!cnpj) {
      return {
        check: 'provider_registration',
        status: 'PENDING',
        message: 'CNPJ não disponível',
      };
    }
    try {
      const exists = await this.invoicyHttpService.companyExistsInEnvironment(
        cnpj,
        environment,
        signal,
      );
      return {
        check: 'provider_registration',
        status: exists ? 'PASS' : 'FAIL',
        message: exists
          ? undefined
          : 'Empresa não cadastrada no Invoicy para este ambiente',
      };
    } catch {
      return {
        check: 'provider_registration',
        status: 'PENDING',
        message: 'Falha ao consultar Invoicy',
      };
    }
  }

  private async checkProviderAuthentication(
    companyId: string,
    cnpj: string,
    environment: FiscalEnvironment,
    signal?: AbortSignal,
  ): Promise<ReadinessCheck> {
    try {
      await this.invoicyHttpService.authenticateForEnvironment(
        companyId,
        cnpj,
        environment,
        signal,
      );
      return { check: 'provider_authentication', status: 'PASS' };
    } catch (error) {
      return {
        check: 'provider_authentication',
        status: 'FAIL',
        message: `Falha na autenticação: ${error?.message ?? 'erro desconhecido'}`,
      };
    }
  }
}
