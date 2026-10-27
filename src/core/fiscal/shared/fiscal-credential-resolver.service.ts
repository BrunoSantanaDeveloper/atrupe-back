import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../config/prisma/prisma.service';
import { EncryptionService } from '../../../shared/services/encryption.service';
import { FiscalRolloutPolicyService } from './fiscal-rollout-policy.service';
import { FiscalEnvironment } from '@prisma/client';
import { aparaCsc } from '../utils/csc.util';

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
          invoicyConfigId_environment_docType: {
            invoicyConfigId,
            environment,
            docType: 'NFCE',
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

      // Aparado na leitura para cobrir também o que já foi gravado com espaço.
      return {
        cscId: aparaCsc(envConfig?.cscId),
        cscToken: aparaCsc(cscToken),
        nfceSeries: envConfig?.nfceSeries ?? 1,
        nfceNextNumber: envConfig?.nfceNextNumber ?? 1,
      };
    } else {
      // Fallback
      return {
        cscId: aparaCsc(invoicyConfig.cscId),
        cscToken: aparaCsc(invoicyConfig.cscToken),
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
    let credential = await this.prisma.companyEnvironmentCredential.findUnique({
      where: { companyId_environment: { companyId, environment } },
    });

    // A chave de acesso do Invoicy é a mesma para homologação e produção.
    // Quando o registro de PRODUCAO ainda não existe (antes da primeira ativação),
    // usa a credencial de HOMOLOGACAO como fallback para que o diagnóstico passe.
    // O ensureRegistered na ativação persiste a chave formalmente para o ambiente.
    // credentialScope rastreia o ambiente REAL da credencial encontrada (necessário
    // para descriptografar com o mesmo AAD usado na cifragem).
    let credentialScope: 'HOMOLOGACAO' | 'PRODUCAO' =
      environment === FiscalEnvironment.PRODUCAO ? 'PRODUCAO' : 'HOMOLOGACAO';
    if (
      !credential?.providerAccessKeyEncrypted &&
      environment === FiscalEnvironment.PRODUCAO
    ) {
      credential = await this.prisma.companyEnvironmentCredential.findUnique({
        where: {
          companyId_environment: {
            companyId,
            environment: FiscalEnvironment.HOMOLOGACAO,
          },
        },
      });
      credentialScope = 'HOMOLOGACAO';
    }

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
          scope: credentialScope,
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
      where: {
        invoicyConfigId_environment_docType: {
          invoicyConfigId,
          environment,
          docType: 'NFCE',
        },
      },
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
      cscId: aparaCsc(envConfig?.cscId),
      cscToken: aparaCsc(cscToken),
      nfceSeries: envConfig?.nfceSeries ?? 1,
      nfceNextNumber: envConfig?.nfceNextNumber ?? 1,
    };
  }

  /**
   * Resolve o ambiente operacional diretamente de um objeto de configuração já carregado,
   * sem realizar nova consulta ao banco. Preferir este método em fluxos de prepare onde
   * a config já foi buscada, evitando round-trips desnecessários.
   *
   * Precedência: activeEnvironment → environment legado → ambiente legado → HOMOLOGACAO
   */
  resolveEnvironmentFromConfig(
    config: {
      activeEnvironment?: string | null;
      activeEnvironmentNfe?: string | null;
      activeEnvironmentNfse?: string | null;
      activeEnvironmentNfce?: string | null;
      environment?: string | null;
      ambiente?: number | null;
    },
    docType?: 'NFE' | 'NFSE' | 'NFCE',
  ): FiscalEnvironment {
    if (docType === 'NFE' && config.activeEnvironmentNfe)
      return config.activeEnvironmentNfe as FiscalEnvironment;
    if (docType === 'NFSE' && config.activeEnvironmentNfse)
      return config.activeEnvironmentNfse as FiscalEnvironment;
    if (docType === 'NFCE' && config.activeEnvironmentNfce)
      return config.activeEnvironmentNfce as FiscalEnvironment;
    if (config.activeEnvironment)
      return config.activeEnvironment as FiscalEnvironment;
    if (config.environment === 'PRODUCAO' || config.ambiente === 1)
      return FiscalEnvironment.PRODUCAO;
    return FiscalEnvironment.HOMOLOGACAO;
  }

  async resolveOperationalEnvironment(
    companyId: string,
    invoicyConfigId: string,
    docType?: 'NFE' | 'NFSE' | 'NFCE',
  ): Promise<FiscalEnvironment> {
    const invoicyConfig = await this.prisma.invoicyConfig.findUnique({
      where: { id: invoicyConfigId },
      select: {
        companyId: true,
        activeEnvironment: true,
        activeEnvironmentNfe: true,
        activeEnvironmentNfse: true,
        activeEnvironmentNfce: true,
        environment: true,
        ambiente: true,
      },
    });

    if (!invoicyConfig || invoicyConfig.companyId !== companyId) {
      throw new NotFoundException(
        `Emissor fiscal ${invoicyConfigId} não encontrado para esta empresa`,
      );
    }

    return this.resolveEnvironmentFromConfig(invoicyConfig, docType);
  }

  /**
   * Garante que o ambiente resolvido para emissão foi formalmente ativado
   * (wizard de ativação concluído, status READY em InvoicyEnvironmentConfig).
   * Sem essa checagem, emissões caem no fluxo legado sem credenciais
   * configuradas para o ambiente e falham tarde, com erro genérico do Invoicy.
   * Deve ser chamado no início de todo prepare/emit (NF-e, NFS-e, NFC-e).
   */
  async assertEnvironmentReady(
    invoicyConfigId: string,
    environment: FiscalEnvironment,
    docType: 'NFE' | 'NFSE' | 'NFCE',
  ): Promise<void> {
    const envConfig = await this.prisma.invoicyEnvironmentConfig.findUnique({
      where: {
        invoicyConfigId_environment_docType: {
          invoicyConfigId,
          environment,
          docType,
        },
      },
      select: { status: true },
    });

    if (!envConfig || envConfig.status !== 'READY') {
      const envLabel =
        environment === FiscalEnvironment.PRODUCAO ? 'produção' : 'homologação';
      const docLabel =
        docType === 'NFE' ? 'NF-e' : docType === 'NFSE' ? 'NFS-e' : 'NFC-e';
      throw new UnprocessableEntityException(
        `O ambiente de ${envLabel} para ${docLabel} deste emissor ainda não foi ativado. ` +
          'Acesse Configurações > Emissores de Nota Fiscal e conclua a ativação antes de emitir documentos.',
      );
    }
  }

  /**
   * Reserva atomicamente o próximo número de NF-e para (emissor, ambiente).
   *
   * Deve ser chamado DENTRO de uma transação, ANTES de transmitir ao Invoicy.
   * Antes desta função, `NfeService.emit` lia `proximoNumeroNfe` sem lock e só
   * incrementava após a autorização — duas emissões concorrentes montavam o
   * payload com o mesmo número e a segunda era rejeitada como duplicada.
   *
   * Retorna o número reservado (valor ANTES do incremento).
   */
  async reserveNfeNumber(
    tx: any, // Prisma.TransactionClient
    invoicyConfigId: string,
    environment: FiscalEnvironment,
  ): Promise<{ reservedNumber: number; series: number }> {
    // Lock do emissor legado — mesma ordem de locks do reserveNfceNumber
    // (emissor → ambiente), para não gerar deadlock entre docTypes.
    const configs = await tx.$queryRaw<any[]>`
      SELECT id, "proximoNumeroNfe", "serieNfe"
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

    const envConfigs = await tx.$queryRaw<any[]>`
      SELECT id, "nfeNextNumber", "nfeSeries"
      FROM invoicy_environment_configs
      WHERE "invoicyConfigId" = ${invoicyConfigId}
        AND environment = ${environment}::"FiscalEnvironment"
        AND "docType" = 'NFE'::"FiscalDocType"
      FOR UPDATE
    `;
    const envConfig = envConfigs[0];

    // A linha ambiental é a autoridade quando existe (criada pela migration
    // 20260803120000). Sem ela, cai no campo legado global.
    const reservedNumber =
      envConfig?.nfeNextNumber ?? config.proximoNumeroNfe ?? 1;
    const series = envConfig?.nfeSeries ?? config.serieNfe ?? 1;
    const nextNumber = reservedNumber + 1;

    if (envConfig) {
      await tx.$executeRaw`
        UPDATE invoicy_environment_configs
        SET "nfeNextNumber" = ${nextNumber}
        WHERE id = ${envConfig.id}
      `;
    } else {
      await tx.invoicyEnvironmentConfig.create({
        data: {
          invoicyConfigId,
          environment,
          docType: 'NFE',
          nfeNextNumber: nextNumber,
          nfeSeries: series,
        },
      });
    }

    // NÃO espelha em invoicy_configs."proximoNumeroNfe" de propósito.
    //
    // Aquela coluna é global (não tem ambiente) e é o campo que o usuário edita
    // na tela de Emissor. Espelhar o contador ali fazia a emissão sobrescrever
    // o valor digitado a cada tentativa: quem ajustava a sequência de produção
    // via um número diferente aparecer no formulário logo depois. Os leitores do
    // prepare passaram a usar `activeNumbering`, que sai desta linha ambiental.
    return { reservedNumber, series };
  }

  /**
   * Reserva atomicamente o próximo RPS de NFS-e para (emissor, ambiente).
   * Mesmo contrato de reserveNfeNumber; a série da NFS-e é alfanumérica.
   */
  async reserveNfseRpsNumber(
    tx: any, // Prisma.TransactionClient
    invoicyConfigId: string,
    environment: FiscalEnvironment,
  ): Promise<{ reservedNumber: number; series: string }> {
    const configs = await tx.$queryRaw<any[]>`
      SELECT id, "proximoRpsNfse", "serieNfse"
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

    const envConfigs = await tx.$queryRaw<any[]>`
      SELECT id, "nfseNextNumber", "nfseSeries"
      FROM invoicy_environment_configs
      WHERE "invoicyConfigId" = ${invoicyConfigId}
        AND environment = ${environment}::"FiscalEnvironment"
        AND "docType" = 'NFSE'::"FiscalDocType"
      FOR UPDATE
    `;
    const envConfig = envConfigs[0];

    const reservedNumber =
      envConfig?.nfseNextNumber ?? config.proximoRpsNfse ?? 1;
    const series = envConfig?.nfseSeries ?? config.serieNfse ?? '1';
    const nextNumber = reservedNumber + 1;

    if (envConfig) {
      await tx.$executeRaw`
        UPDATE invoicy_environment_configs
        SET "nfseNextNumber" = ${nextNumber}
        WHERE id = ${envConfig.id}
      `;
    } else {
      await tx.invoicyEnvironmentConfig.create({
        data: {
          invoicyConfigId,
          environment,
          docType: 'NFSE',
          nfseNextNumber: nextNumber,
          nfseSeries: series,
        },
      });
    }

    // Mesma razão de reserveNfeNumber: `proximoRpsNfse` é o campo editável da
    // tela, não o contador. Não espelhar aqui.
    return { reservedNumber, series };
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

    // 2. Lock the environmental config (InvoicyEnvironmentConfig) for NFCE
    const envConfigs = await tx.$queryRaw<any[]>`
      SELECT id, "nfceNextNumber", "nfceSeries"
      FROM invoicy_environment_configs
      WHERE "invoicyConfigId" = ${invoicyConfigId}
        AND environment = ${environment}::"FiscalEnvironment"
        AND "docType" = 'NFCE'::"FiscalDocType"
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
            docType: 'NFCE',
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
            docType: 'NFCE',
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
