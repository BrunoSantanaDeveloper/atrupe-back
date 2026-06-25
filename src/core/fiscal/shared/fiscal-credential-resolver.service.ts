import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../config/prisma/prisma.service';
import { EncryptionService } from '../../../shared/services/encryption.service';
import { FiscalRolloutPolicyService } from './fiscal-rollout-policy.service';
import { FiscalEnvironment } from '@prisma/client';

@Injectable()
export class FiscalCredentialResolverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryptionService: EncryptionService,
    private readonly configService: ConfigService,
    private readonly rolloutPolicy: FiscalRolloutPolicyService,
  ) {}

  async getCompanyRuntimeCredentials(
    companyId: string,
    environment: FiscalEnvironment,
  ): Promise<{
    accessKey: string | null;
    certificate: string | null;
    certificatePassword: string | null;
  }> {
    if (this.rolloutPolicy.shouldReadFromEncrypted()) {
      const credential =
        await this.prisma.companyEnvironmentCredential.findUnique({
          where: {
            companyId_environment: {
              companyId,
              environment,
            },
          },
        });

      const certificate = await this.prisma.digitalCertificate.findUnique({
        where: { companyId },
      });

      let accessKey: string | null = null;
      if (credential && credential.providerAccessKeyEncrypted) {
        accessKey = this.encryptionService.decrypt(
          credential.providerAccessKeyEncrypted,
          {
            table: 'company_environment_credentials',
            recordId: credential.id,
            companyId,
            field: 'providerAccessKeyEncrypted',
            scope: environment,
          },
        );
      }

      let certificateData: string | null = null;
      let certificatePassword: string | null = null;

      if (certificate) {
        if (certificate.certificateEncrypted) {
          certificateData = this.encryptionService.decrypt(
            certificate.certificateEncrypted,
            {
              table: 'digital_certificates',
              recordId: certificate.id,
              companyId,
              field: 'certificateEncrypted',
              scope: 'GLOBAL',
            },
          );
        }
        if (certificate.passwordEncrypted) {
          certificatePassword = this.encryptionService.decrypt(
            certificate.passwordEncrypted,
            {
              table: 'digital_certificates',
              recordId: certificate.id,
              companyId,
              field: 'passwordEncrypted',
              scope: 'GLOBAL',
            },
          );
        }
      }

      return {
        accessKey,
        certificate: certificateData,
        certificatePassword,
      };
    } else {
      // Fallback: colunas legadas plaintext
      const company = await this.prisma.company.findUnique({
        where: { id: companyId },
        select: { accessKey: true },
      });

      const certificate = await this.prisma.digitalCertificate.findUnique({
        where: { companyId },
        select: { certificate: true, password: true },
      });

      return {
        accessKey: company?.accessKey || null,
        certificate: certificate?.certificate || null,
        certificatePassword: certificate?.password || null,
      };
    }
  }

  async getEmissorRuntimeCredentials(
    companyId: string,
    invoicyConfigId: string,
    environment: FiscalEnvironment,
  ): Promise<{
    cscId: string | null;
    cscToken: string | null;
    nfceSeries: number;
    nfceNextNumber: number;
  }> {
    const invoicyConfig = await this.prisma.invoicyConfig.findUnique({
      where: { id: invoicyConfigId },
    });

    if (!invoicyConfig || invoicyConfig.companyId !== companyId) {
      throw new NotFoundException(
        `Emissor fiscal ${invoicyConfigId} não encontrado para esta empresa`,
      );
    }

    if (this.rolloutPolicy.shouldReadFromEncrypted()) {
      const envConfig = await this.prisma.invoicyEnvironmentConfig.findUnique({
        where: {
          invoicyConfigId_environment: {
            invoicyConfigId,
            environment,
          },
        },
      });

      let cscToken: string | null = null;
      if (envConfig && envConfig.cscTokenEncrypted) {
        cscToken = this.encryptionService.decrypt(envConfig.cscTokenEncrypted, {
          table: 'invoicy_environment_configs',
          recordId: envConfig.id,
          companyId,
          field: 'cscTokenEncrypted',
          scope: environment,
        });
      }

      return {
        cscId: envConfig?.cscId || null,
        cscToken,
        nfceSeries: envConfig?.nfceSeries ?? 1,
        nfceNextNumber: envConfig?.nfceNextNumber ?? 1,
      };
    } else {
      // Fallback
      return {
        cscId: invoicyConfig.cscId,
        cscToken: invoicyConfig.cscToken,
        nfceSeries: invoicyConfig.serieNfce ?? 1,
        nfceNextNumber: invoicyConfig.proximoNumeroNfce ?? 1,
      };
    }
  }

  /**
   * Lê credenciais SEMPRE das tabelas ambientais (sem fallback legado).
   * Usado pelo readiness/test-connection para garantir validação do ambiente correto.
   */
  async getCompanyCredentialsForValidation(
    companyId: string,
    environment: FiscalEnvironment,
  ): Promise<{
    accessKey: string | null;
    certificate: string | null;
    certificatePassword: string | null;
  }> {
    const credential =
      await this.prisma.companyEnvironmentCredential.findUnique({
        where: { companyId_environment: { companyId, environment } },
      });

    const certificate = await this.prisma.digitalCertificate.findUnique({
      where: { companyId },
    });

    let accessKey: string | null = null;
    if (credential?.providerAccessKeyEncrypted) {
      accessKey = this.encryptionService.decrypt(
        credential.providerAccessKeyEncrypted,
        {
          table: 'company_environment_credentials',
          recordId: credential.id,
          companyId,
          field: 'providerAccessKeyEncrypted',
          scope: environment,
        },
      );
    }

    let certificateData: string | null = null;
    let certificatePassword: string | null = null;

    if (certificate) {
      if (certificate.certificateEncrypted) {
        certificateData = this.encryptionService.decrypt(
          certificate.certificateEncrypted,
          {
            table: 'digital_certificates',
            recordId: certificate.id,
            companyId,
            field: 'certificateEncrypted',
            scope: 'GLOBAL',
          },
        );
      }
      if (certificate.passwordEncrypted) {
        certificatePassword = this.encryptionService.decrypt(
          certificate.passwordEncrypted,
          {
            table: 'digital_certificates',
            recordId: certificate.id,
            companyId,
            field: 'passwordEncrypted',
            scope: 'GLOBAL',
          },
        );
      }
    }

    return { accessKey, certificate: certificateData, certificatePassword };
  }

  /**
   * Lê CSC SEMPRE da tabela ambiental (sem fallback legado).
   * Usado pelo readiness/test-connection.
   */
  async getEmissorCredentialsForValidation(
    companyId: string,
    invoicyConfigId: string,
    environment: FiscalEnvironment,
  ): Promise<{
    cscId: string | null;
    cscToken: string | null;
    nfceSeries: number;
    nfceNextNumber: number;
  }> {
    const envConfig = await this.prisma.invoicyEnvironmentConfig.findUnique({
      where: { invoicyConfigId_environment: { invoicyConfigId, environment } },
    });

    let cscToken: string | null = null;
    if (envConfig?.cscTokenEncrypted) {
      cscToken = this.encryptionService.decrypt(envConfig.cscTokenEncrypted, {
        table: 'invoicy_environment_configs',
        recordId: envConfig.id,
        companyId,
        field: 'cscTokenEncrypted',
        scope: environment,
      });
    }

    return {
      cscId: envConfig?.cscId ?? null,
      cscToken,
      nfceSeries: envConfig?.nfceSeries ?? 1,
      nfceNextNumber: envConfig?.nfceNextNumber ?? 1,
    };
  }

  async resolveOperationalEnvironment(
    companyId: string,
    invoicyConfigId: string,
  ): Promise<FiscalEnvironment> {
    const invoicyConfig = await this.prisma.invoicyConfig.findUnique({
      where: { id: invoicyConfigId },
      select: {
        companyId: true,
        activeEnvironment: true,
        environment: true,
        ambiente: true,
      },
    });

    if (!invoicyConfig || invoicyConfig.companyId !== companyId) {
      throw new NotFoundException(
        `Emissor fiscal ${invoicyConfigId} não encontrado para esta empresa`,
      );
    }

    if (invoicyConfig.activeEnvironment) {
      return invoicyConfig.activeEnvironment;
    }

    const envStr = invoicyConfig.environment;
    const ambInt = invoicyConfig.ambiente;
    if (envStr === 'PRODUCAO' || ambInt === 1) {
      return FiscalEnvironment.PRODUCAO;
    }
    return FiscalEnvironment.HOMOLOGACAO;
  }

  /**
   * Reserve the next NFC-e number atomically (lock + increment).
   * Must be called WITHIN a transaction before calling the Invoicy API.
   * Returns the reserved number (value BEFORE increment).
   */
  async reserveNfceNumber(
    tx: any, // Prisma.TransactionClient
    invoicyConfigId: string,
    environment: FiscalEnvironment,
  ): Promise<{ reservedNumber: number; series: number }> {
    // 1. Lock the legacy issuer (InvoicyConfig)
    const configs = await tx.$queryRaw<any[]>`
      SELECT id, "proximoNumeroNfce", "serieNfce"
      FROM invoicy_configs
      WHERE id = ${invoicyConfigId}
      FOR UPDATE
    `;
    const config = configs[0];
    if (!config) {
      throw new NotFoundException(
        `Emissor fiscal ${invoicyConfigId} não encontrado`,
      );
    }

    // 2. Lock the environmental config (InvoicyEnvironmentConfig)
    const envConfigs = await tx.$queryRaw<any[]>`
      SELECT id, "nfceNextNumber", "nfceSeries"
      FROM invoicy_environment_configs
      WHERE "invoicyConfigId" = ${invoicyConfigId} AND environment = ${environment}::"FiscalEnvironment"
      FOR UPDATE
    `;
    const envConfig = envConfigs[0];

    const readEncrypted = this.rolloutPolicy.shouldReadFromEncrypted();
    const writeToLegacy = this.rolloutPolicy.shouldWriteToLegacy();

    let reservedNumber: number;
    let series: number;
    let nextNumber: number;

    if (!readEncrypted) {
      // Fases 1-3 (readEncrypted=false, DUAL is true)
      // InvoicyConfig.proximoNumeroNfce is authoritative.
      reservedNumber = config.proximoNumeroNfce ?? 1;
      series = config.serieNfce ?? 1;
      nextNumber = reservedNumber + 1;

      // Update legacy
      await tx.$executeRaw`
        UPDATE invoicy_configs
        SET "proximoNumeroNfce" = ${nextNumber}
        WHERE id = ${invoicyConfigId}
      `;

      // Upsert environmental
      if (envConfig) {
        await tx.$executeRaw`
          UPDATE invoicy_environment_configs
          SET "nfceNextNumber" = ${nextNumber}
          WHERE id = ${envConfig.id}
        `;
      } else {
        await tx.invoicyEnvironmentConfig.create({
          data: {
            invoicyConfigId,
            environment,
            nfceNextNumber: nextNumber,
            nfceSeries: series,
          },
        });
      }
    } else {
      // readEncrypted = true (Fase 4, 5, 6)
      // InvoicyEnvironmentConfig.nfceNextNumber is authoritative.
      reservedNumber = envConfig?.nfceNextNumber ?? 1;
      series = envConfig?.nfceSeries ?? config.serieNfce ?? 1;
      nextNumber = reservedNumber + 1;

      // Update environmental
      if (envConfig) {
        await tx.$executeRaw`
          UPDATE invoicy_environment_configs
          SET "nfceNextNumber" = ${nextNumber}
          WHERE id = ${envConfig.id}
        `;
      } else {
        await tx.invoicyEnvironmentConfig.create({
          data: {
            invoicyConfigId,
            environment,
            nfceNextNumber: nextNumber,
            nfceSeries: series,
          },
        });
      }

      // If writeToLegacy is true (Fase 4), update legacy to match
      if (writeToLegacy) {
        await tx.$executeRaw`
          UPDATE invoicy_configs
          SET "proximoNumeroNfce" = ${nextNumber}
          WHERE id = ${invoicyConfigId}
        `;
      }
    }

    return { reservedNumber, series };
  }
}
