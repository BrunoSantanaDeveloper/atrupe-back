import {
  Injectable,
  NotFoundException,
  Logger,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'nestjs-prisma';
import {
  CreateInvoicyConfigDto,
  UpdateInvoicyConfigDto,
} from './dtos/invoicy-config.dto';
import { InvoicyHttpService } from './invoicy-http.service';
import { validatePfxCertificateCnpj } from '../utils/certificate-parser';
import { EncryptionService } from '../../../shared/services/encryption.service';
import { FiscalRolloutPolicyService } from '../shared/fiscal-rollout-policy.service';
import { FiscalAuditService } from '../shared/fiscal-audit.service';
import { FiscalCredentialResolverService } from '../shared/fiscal-credential-resolver.service';
import {
  FiscalEnvironment,
  FiscalConfigAction,
  ActorType,
} from '@prisma/client';
import * as crypto from 'crypto';

@Injectable()
export class InvoicyService {
  private readonly logger = new Logger(InvoicyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly invoicyHttpService: InvoicyHttpService,
    private readonly encryptionService: EncryptionService,
    private readonly fiscalRolloutPolicy: FiscalRolloutPolicyService,
    private readonly fiscalAuditService: FiscalAuditService,
    private readonly fiscalCredentialResolver: FiscalCredentialResolverService,
  ) {}

  /**
   * Retorna as credenciais globais do Invoicy (Atrupe como revendedor)
   * A partnerKey é global, mas accessKey deve ser configurada por empresa
   */
  getGlobalCredentials() {
    return {
      partnerKey: this.configService.get<string>('INVOICY_PARTNER_KEY'),
      environment:
        this.configService.get<string>('INVOICY_ENVIRONMENT') || 'HOMOLOGACAO',
    };
  }

  private mapDtoToDb(dto: CreateInvoicyConfigDto | UpdateInvoicyConfigDto) {
    const data: any = {};

    // Campos de identificação do emissor
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.isDefault !== undefined) data.isDefault = dto.isDefault;

    // environment/ambiente are legacy fields — not accepted via DTO anymore.
    // Use activate() endpoint to change the active environment.

    if (dto.emitCrt !== undefined) data.emitCrt = dto.emitCrt;
    if (dto.codigoServico !== undefined) data.codigoServico = dto.codigoServico;
    if (dto.aliquotaIss !== undefined) data.aliquotaIss = dto.aliquotaIss;
    if (dto.regimeEspecialTributacao !== undefined)
      data.regimeEspecialTributacao = dto.regimeEspecialTributacao;
    if (dto.defaultCfop !== undefined) data.defaultCfop = dto.defaultCfop;
    if (dto.defaultNcm !== undefined) data.defaultNcm = dto.defaultNcm;
    if (dto.defaultOperationNature !== undefined)
      data.defaultOperationNature = dto.defaultOperationNature;
    if (dto.taxInfoText !== undefined) data.taxInfoText = dto.taxInfoText;
    if (dto.sendDanfeXmlAutomatically !== undefined)
      data.sendDanfeXmlAutomatically = dto.sendDanfeXmlAutomatically;
    if (dto.sendDanfeAutomatically !== undefined)
      data.sendDanfeAutomatically = dto.sendDanfeAutomatically;
    if (dto.sendXmlAutomatically !== undefined)
      data.sendXmlAutomatically = dto.sendXmlAutomatically;
    if (dto.sendFiscalEmailCopyTo !== undefined)
      data.sendFiscalEmailCopyTo = dto.sendFiscalEmailCopyTo;

    // Reforma Tributaria (IBS/CBS)
    if (dto.ibsCbsEnviarValores !== undefined)
      data.ibsCbsEnviarValores = dto.ibsCbsEnviarValores;
    if (dto.reformaTributariaAtiva !== undefined)
      data.reformaTributariaAtiva = dto.reformaTributariaAtiva;
    if (dto.indicadorOperacaoNfse !== undefined)
      data.indicadorOperacaoNfse = dto.indicadorOperacaoNfse;
    if (dto.regApIbsCbsSn !== undefined) data.regApIbsCbsSn = dto.regApIbsCbsSn;
    if (dto.aliquotaIbsUf !== undefined) data.aliquotaIbsUf = dto.aliquotaIbsUf;
    if (dto.aliquotaIbsMun !== undefined)
      data.aliquotaIbsMun = dto.aliquotaIbsMun;
    if (dto.aliquotaCbs !== undefined) data.aliquotaCbs = dto.aliquotaCbs;

    // NF-e field mappings (frontend -> database)
    if (dto.nfeSeries !== undefined) {
      const parsed = parseInt(dto.nfeSeries, 10);
      data.serieNfe = isNaN(parsed) ? 1 : parsed;
    }
    if (dto.serieNfe !== undefined) data.serieNfe = dto.serieNfe;
    if (dto.nfeNextNumber !== undefined)
      data.proximoNumeroNfe = dto.nfeNextNumber;
    if (dto.proximoNumeroNfe !== undefined)
      data.proximoNumeroNfe = dto.proximoNumeroNfe;

    // NFS-e field mappings (frontend -> database)
    if (dto.nfseSeries !== undefined) data.serieNfse = dto.nfseSeries;
    if (dto.serieNfse !== undefined) data.serieNfse = dto.serieNfse;
    if (dto.nfseNextNumber !== undefined)
      data.proximoRpsNfse = dto.nfseNextNumber;
    if (dto.proximoRpsNfse !== undefined)
      data.proximoRpsNfse = dto.proximoRpsNfse;

    // NFC-e field mappings (frontend -> database)
    if (dto.nfceSeries !== undefined) {
      const parsed = parseInt(dto.nfceSeries, 10);
      data.serieNfce = isNaN(parsed) ? 1 : parsed;
    }
    if (dto.nfceNextNumber !== undefined)
      data.proximoNumeroNfce = dto.nfceNextNumber;
    if (dto.serieNfce !== undefined) data.serieNfce = dto.serieNfce;
    if (dto.proximoNumeroNfce !== undefined)
      data.proximoNumeroNfce = dto.proximoNumeroNfce;
    // CSC fields via PATCH are rejected — use /environments/:environment/csc endpoint
    if (dto.cscToken !== undefined && dto.cscToken !== '') {
      throw new BadRequestException(
        'Credenciais devem ser alteradas pelos endpoints dedicados (/environments/:environment/csc)',
      );
    }
    // cscId without cscToken is allowed for informational update only
    if (dto.cscId !== undefined && dto.cscId !== '') data.cscId = dto.cscId;

    // Boolean field
    if ('isActive' in dto && dto.isActive !== undefined)
      data.isActive = dto.isActive;

    // Prazo de cancelamento da NFC-e (minutos) — varia por UF
    if (dto.prazoCancelamentoNfce !== undefined)
      data.prazoCancelamentoNfce = dto.prazoCancelamentoNfce;

    // Teto para tentar o cancelamento da NF-e (horas) — varia por UF
    if (dto.prazoCancelamentoNfeHoras !== undefined)
      data.prazoCancelamentoNfeHoras = dto.prazoCancelamentoNfeHoras;

    return data;
  }

  private resolveDtoEnvironment(
    dto: CreateInvoicyConfigDto | UpdateInvoicyConfigDto,
  ): 'PRODUCAO' | 'HOMOLOGACAO' | undefined {
    if (dto.environment !== undefined) {
      return dto.environment === 'PRODUCAO' ? 'PRODUCAO' : 'HOMOLOGACAO';
    }

    if (dto.ambiente !== undefined) {
      const ambiente = String(dto.ambiente);
      return ambiente === '1' || ambiente === 'PRODUCAO'
        ? 'PRODUCAO'
        : 'HOMOLOGACAO';
    }

    return undefined;
  }

  private normalizeEnvironment(environment?: string | null) {
    return environment === 'PRODUCAO' ? 'PRODUCAO' : 'HOMOLOGACAO';
  }

  /**
   * Numeração efetiva de cada docType: a linha de `invoicy_environment_configs`
   * do ambiente ATIVO daquele documento.
   *
   * As colunas legadas de `invoicy_configs` (serieNfe/proximoNumeroNfe e
   * companhia) não servem para isso: elas são globais e a reserva atômica lê da
   * linha ambiental. Quem exibia o campo legado mostrava um número diferente do
   * que seria realmente emitido — foi o que escondeu a numeração de produção
   * semeada em 1 pela migration 20260803120000.
   *
   * Cai no campo legado só quando a linha ambiental não veio no include ou
   * ainda não existe (emissor anterior à Fase 3 que nunca emitiu).
   */
  private resolveActiveNumbering(config: any) {
    const rows = (config.environmentConfigs as any[]) ?? [];

    const pick = (
      docType: 'NFE' | 'NFSE' | 'NFCE',
      seriesColumn: string,
      numberColumn: string,
      legacySeries: any,
      legacyNumber: any,
    ) => {
      const environment =
        this.fiscalCredentialResolver.resolveEnvironmentFromConfig(
          config,
          docType,
        );
      const row = rows.find(
        (r) => r.docType === docType && r.environment === environment,
      );
      return {
        environment,
        series:
          row?.[seriesColumn] ??
          legacySeries ??
          // A serie da NFS-e nacional entra no Id do DPS e precisa ser
          // numerica (TSSerieDPS). "A1" era o padrao antigo e e' recusado
          // pelos municipios no padrao nacional.
          (docType === 'NFSE' ? '1' : 1),
        nextNumber: row?.[numberColumn] ?? legacyNumber ?? 1,
      };
    };

    return {
      nfe: pick(
        'NFE',
        'nfeSeries',
        'nfeNextNumber',
        config.serieNfe,
        config.proximoNumeroNfe,
      ),
      nfce: pick(
        'NFCE',
        'nfceSeries',
        'nfceNextNumber',
        config.serieNfce,
        config.proximoNumeroNfce,
      ),
      nfse: pick(
        'NFSE',
        'nfseSeries',
        'nfseNextNumber',
        config.serieNfse,
        config.proximoRpsNfse,
      ),
    };
  }

  // Map database fields to frontend fields
  private mapDbToResponse(config: any) {
    if (!config) return null;

    const company = config.company || {};
    const address =
      (company.address as any[] | undefined)?.find(
        (a: any) => a.type === 'Principal',
      ) ||
      company.address?.[0] ||
      {};
    const digitalCertificate = company.DigitalCertificate || {};

    const normalizedEnvironment =
      config.environment ||
      (config.ambiente === 1 ? 'PRODUCAO' : 'HOMOLOGACAO');

    return {
      // Allowlist explícita — nunca expor campos cifrados ou chaves de parceiro
      id: config.id,
      companyId: config.companyId,
      name: config.name,
      isDefault: config.isDefault,
      isActive: config.isActive,
      environment: normalizedEnvironment,
      ambiente: config.ambiente,
      activeEnvironment: config.activeEnvironment ?? null,
      emitCrt: config.emitCrt,
      defaultNcm: config.defaultNcm || null,
      codigoServico: config.codigoServico,
      aliquotaIss: config.aliquotaIss,
      regimeEspecialTributacao: config.regimeEspecialTributacao ?? null,
      defaultCfop: config.defaultCfop,
      defaultOperationNature: config.defaultOperationNature,
      taxInfoText: config.taxInfoText,
      ibgeCode: config.emitCmun || null,
      contingenciaNfceAtiva: config.contingenciaNfceAtiva,
      contingenciaNfceMotivo: config.contingenciaNfceMotivo,
      contingenciaNfceDataHora: config.contingenciaNfceDataHora,
      prazoCancelamentoNfce: config.prazoCancelamentoNfce,
      prazoCancelamentoNfeHoras: config.prazoCancelamentoNfeHoras ?? null,

      // Reforma Tributaria. Sem estes campos na allowlist os servicos fiscais
      // liam `undefined` e o grupo de IBS/CBS jamais era enviado, por mais que
      // a coluna estivesse ligada no banco.
      ibsCbsEnviarValores: config.ibsCbsEnviarValores ?? false,
      reformaTributariaAtiva: config.reformaTributariaAtiva ?? false,
      indicadorOperacaoNfse: config.indicadorOperacaoNfse ?? null,
      regApIbsCbsSn: config.regApIbsCbsSn ?? null,
      aliquotaIbsUf: config.aliquotaIbsUf ?? null,
      aliquotaIbsMun: config.aliquotaIbsMun ?? null,
      aliquotaCbs: config.aliquotaCbs ?? null,

      sendDanfeXmlAutomatically: config.sendDanfeXmlAutomatically,
      sendDanfeAutomatically: config.sendDanfeAutomatically,
      sendXmlAutomatically: config.sendXmlAutomatically,
      sendFiscalEmailCopyTo: config.sendFiscalEmailCopyTo,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,

      // Campo virtual derivado do UF do endereço principal (usado por nfe.service)
      emitUf: address.state ?? null,

      // Numeração efetiva por documento (linha do ambiente ativo). É o que a
      // emissão realmente consome — preferir isto aos campos legados abaixo.
      activeNumbering: this.resolveActiveNumbering(config),

      // Numeração — nomes legados mantidos para compatibilidade com nfe/nfce/nfse services
      serieNfe: config.serieNfe,
      proximoNumeroNfe: config.proximoNumeroNfe,
      serieNfce: config.serieNfce,
      proximoNumeroNfce: config.proximoNumeroNfce,
      serieNfse: config.serieNfse,
      proximoRpsNfse: config.proximoRpsNfse,
      emitCmun: config.emitCmun,
      // Nomes API-friendly (usados no frontend)
      nfeSeries: config.serieNfe?.toString() || '1',
      nfeNextNumber: config.proximoNumeroNfe || 1,
      nfseSeries: config.serieNfse || 'A1',
      nfseNextNumber: config.proximoRpsNfse || 1,
      nfceSeries: config.serieNfce?.toString() || '1',
      nfceNextNumber: config.proximoNumeroNfce || 1,
      cscId: config.cscId || '',
      cscConfigured:
        !!config.cscToken ||
        ((config.environmentConfigs as any[]) ?? []).some(
          (ec: any) => !!ec.cscTokenEncrypted,
        ),

      activeEnvironmentNfe: config.activeEnvironmentNfe ?? null,
      activeEnvironmentNfse: config.activeEnvironmentNfse ?? null,
      activeEnvironmentNfce: config.activeEnvironmentNfce ?? null,

      // Estado por ambiente+docType (DRAFT/VALIDATING/READY/ERROR...) para a UI.
      // environmentSwitchLocked é enriquecido de forma assíncrona em getById.
      environmentSwitchLocked: null as boolean | null,
      environments: ((config.environmentConfigs as any[]) ?? []).map(
        (ec: any) => ({
          environment: ec.environment,
          docType: ec.docType,
          status: ec.status,
          cscConfigured: !!ec.cscTokenEncrypted,
          lastValidationAt: ec.lastValidationAt ?? null,
          lastValidationError: ec.lastValidationError ?? null,
          activatedAt: ec.activatedAt ?? null,
          // Numeração da linha: só o par do docType da linha é significativo.
          // A tela de Emissor precisa dela para editar homologação e produção
          // separadamente, em vez de escrever numa coluna global.
          series:
            ec.docType === 'NFE'
              ? ec.nfeSeries
              : ec.docType === 'NFSE'
                ? ec.nfseSeries
                : ec.nfceSeries,
          nextNumber:
            ec.docType === 'NFE'
              ? ec.nfeNextNumber
              : ec.docType === 'NFSE'
                ? ec.nfseNextNumber
                : ec.nfceNextNumber,
        }),
      ),

      // Nested company — sem accessKey, partnerKey, chaves cifradas
      company: {
        id: company.id,
        name: company.name,
        legalName: company.legalName,
        cnpj: company.cnpj,
        stateRegistration: company.stateRegistration,
        municipalRegistration: company.municipalRegistration,
        // Considera tanto o legado (Company.accessKey) quanto a credencial
        // ambiental cifrada (CompanyEnvironmentCredential). Emissores migrados
        // para criptografia não devem aparecer como não configurados.
        providerConfigured:
          !!company.accessKey ||
          ((company.environmentCredentials as any[]) ?? []).some(
            (c: any) => !!c.providerAccessKeyEncrypted,
          ),
        address: {
          street: address.street,
          number: address.number,
          neighborhood: address.neighborhood,
          zipcode: address.zipcode,
          city: address.city,
          state: address.state,
          country: address.country || '1058',
        },
        hasCertificate: !!digitalCertificate.id,
        certificateExpiresAt: digitalCertificate.expiresAt || null,
        certificateIssuer: digitalCertificate.issuer || null,
        certificateSerialNumber: digitalCertificate.serialNumber || null,
      },
    };
  }

  /**
   * Listar todos os emissores de uma empresa
   */
  async getAllByCompany(companyId: string) {
    const configs = await this.prisma.invoicyConfig.findMany({
      where: { companyId },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: {
        environmentConfigs: true,
        company: {
          include: {
            address: true,
            DigitalCertificate: true, // Assuming this is the relation name
            environmentCredentials: {
              select: { environment: true, providerAccessKeyEncrypted: true },
            },
          },
        },
      },
    });

    const switchLocked = await this.fiscalRolloutPolicy
      .isRolloutActivationEnabled()
      .then((enabled) => !enabled)
      .catch(() => true);

    return configs.map((config) => {
      const mapped = this.mapDbToResponse(config);
      if (mapped) {
        // Para listas, derivamos o lock apenas do gate global de ativacao,
        // evitando N consultas (uma por emissor). A primeira ativacao deve
        // continuar liberada quando o rollout global permitir.
        mapped.environmentSwitchLocked = switchLocked;
      }
      return mapped;
    });
  }

  /**
   * Obter emissor por ID
   */
  async getById(id: string) {
    const config = await this.prisma.invoicyConfig.findUnique({
      where: { id },
      include: {
        environmentConfigs: true,
        company: {
          include: {
            address: true,
            DigitalCertificate: true,
            environmentCredentials: {
              select: { environment: true, providerAccessKeyEncrypted: true },
            },
          },
        },
      },
    });

    const mapped = this.mapDbToResponse(config);
    if (mapped) {
      mapped.environmentSwitchLocked =
        await this.fiscalRolloutPolicy.isEnvironmentSwitchLocked(id);
    }
    return mapped;
  }

  /**
   * Obter emissor padrão de uma empresa
   */
  async getDefault(companyId: string) {
    const config = await this.prisma.invoicyConfig.findFirst({
      where: { companyId, isDefault: true },
      include: {
        environmentConfigs: true,
        company: {
          include: {
            address: true,
            DigitalCertificate: true,
            environmentCredentials: {
              select: { environment: true, providerAccessKeyEncrypted: true },
            },
          },
        },
      },
    });

    // Se não houver emissor padrão, retorna o primeiro
    if (!config) {
      const firstConfig = await this.prisma.invoicyConfig.findFirst({
        where: { companyId },
        orderBy: { createdAt: 'asc' },
        include: {
          environmentConfigs: true,
          company: {
            include: {
              address: true,
              DigitalCertificate: true,
              environmentCredentials: {
                select: {
                  environment: true,
                  providerAccessKeyEncrypted: true,
                },
              },
            },
          },
        },
      });
      const mappedFirst = this.mapDbToResponse(firstConfig);
      if (mappedFirst && firstConfig) {
        mappedFirst.environmentSwitchLocked =
          await this.fiscalRolloutPolicy.isEnvironmentSwitchLocked(
            firstConfig.id,
          );
      }
      return mappedFirst;
    }

    const mapped = this.mapDbToResponse(config);
    if (mapped) {
      mapped.environmentSwitchLocked =
        await this.fiscalRolloutPolicy.isEnvironmentSwitchLocked(config.id);
    }
    return mapped;
  }

  /**
   * Alias para getDefault - retorna o emissor padrão de uma empresa
   * Este método é mantido por compatibilidade e conveniência
   */
  async getConfig(companyId: string) {
    return this.getDefault(companyId);
  }

  /**
   * Criar novo emissor
   */
  async create(companyId: string, dto: CreateInvoicyConfigDto) {
    // Verificar se já existe emissor com mesmo nome na empresa
    const existing = await this.prisma.invoicyConfig.findFirst({
      where: { companyId, name: dto.name },
    });

    if (existing) {
      throw new ConflictException(
        `Já existe um emissor com o nome "${dto.name}" nesta empresa`,
      );
    }

    const data = await this.prepareDataWithCep(dto);

    // Se é o primeiro emissor ou marcado como padrão, garantir apenas um padrão
    const countEmissores = await this.prisma.invoicyConfig.count({
      where: { companyId },
    });

    const isDefault = countEmissores === 0 || dto.isDefault === true;

    // Se este será o padrão, remover padrão dos outros
    if (isDefault) {
      await this.prisma.invoicyConfig.updateMany({
        where: { companyId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const result = await this.prisma.invoicyConfig.create({
      data: {
        ...data,
        companyId,
        isDefault,
        // Legacy fields: always start as HOMOLOGACAO; activeEnvironment is set by activate()
        environment: 'HOMOLOGACAO',
        ambiente: 2,
        // Cria as SEIS linhas de ambiente (2 ambientes x 3 docTypes).
        //
        // Antes criava uma só, sem docType explícito — o DEFAULT 'NFCE' do
        // banco a transformava em NFC-e em silêncio, e o emissor nascia sem
        // nenhuma linha para NF-e e NFS-e. Todas em DRAFT: existir a linha não
        // significa ambiente ativado, isso continua com o assistente.
        environmentConfigs: {
          create: (['HOMOLOGACAO', 'PRODUCAO'] as const).flatMap((env) =>
            (['NFE', 'NFSE', 'NFCE'] as const).map((docType) => ({
              environment: env,
              docType,
              status: 'DRAFT' as const,
              // Semeia a numeração informada na criação apenas no ambiente de
              // homologação; produção começa com sequência independente.
              ...(env === 'HOMOLOGACAO'
                ? {
                    ...(docType === 'NFE'
                      ? {
                          nfeSeries: data.serieNfe ?? 1,
                          nfeNextNumber: data.proximoNumeroNfe ?? 1,
                        }
                      : {}),
                    ...(docType === 'NFSE'
                      ? {
                          nfseSeries: data.serieNfse ?? 'A1',
                          nfseNextNumber: data.proximoRpsNfse ?? 1,
                        }
                      : {}),
                    ...(docType === 'NFCE'
                      ? {
                          nfceSeries: data.serieNfce ?? 1,
                          nfceNextNumber: data.proximoNumeroNfce ?? 1,
                        }
                      : {}),
                  }
                : {}),
            })),
          ),
        },
      },
      include: {
        environmentConfigs: true,
        company: {
          include: {
            address: true,
            DigitalCertificate: true,
            environmentCredentials: {
              select: { environment: true, providerAccessKeyEncrypted: true },
            },
          },
        },
      },
    });

    return this.mapDbToResponse(result);
  }

  // createConfig - alias removido, usar create() diretamente

  /**
   * Atualizar emissor por ID
   */
  async update(id: string, dto: UpdateInvoicyConfigDto) {
    const config = await this.prisma.invoicyConfig.findUnique({
      where: { id },
    });

    if (!config) {
      throw new NotFoundException('Emissor não encontrado');
    }

    // Se está alterando o nome, verificar duplicidade
    if (dto.name && dto.name !== config.name) {
      const existing = await this.prisma.invoicyConfig.findFirst({
        where: { companyId: config.companyId, name: dto.name, id: { not: id } },
      });

      if (existing) {
        throw new ConflictException(
          `Já existe um emissor com o nome "${dto.name}" nesta empresa`,
        );
      }
    }

    const data = await this.prepareDataWithCep(dto);

    if (dto.isDefault === true) {
      await this.prisma.invoicyConfig.updateMany({
        where: {
          companyId: config.companyId,
          isDefault: true,
          id: { not: id },
        },
        data: { isDefault: false },
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // A numeração vai ANTES do update para o include abaixo já devolver as
      // linhas ambientais atualizadas, sem uma segunda leitura.
      //
      // Gravar só as colunas legadas não muda a numeração da emissão: a reserva
      // atômica lê de invoicy_environment_configs. Sem este passo, o usuário
      // digitava o próximo número, salvava, e a emissão seguia usando a
      // sequência antiga do ambiente.
      await this.syncEnvironmentNumbering(tx, config, dto, data);

      return tx.invoicyConfig.update({
        where: { id },
        data,
        include: {
          environmentConfigs: true,
          company: {
            include: {
              address: true,
              DigitalCertificate: true,
              environmentCredentials: {
                select: { environment: true, providerAccessKeyEncrypted: true },
              },
            },
          },
        },
      });
    });

    return this.mapDbToResponse(result);
  }

  /**
   * Propaga a numeração informada no PATCH para a linha de
   * `invoicy_environment_configs` do ambiente correspondente.
   *
   * O ambiente vem de `<doc>NumberingEnvironment` quando informado; senão é o
   * ambiente ATIVO daquele docType — que é onde a emissão vai buscar o número.
   * Só escreve o par (série, próximo número) do docType cujos campos vieram no
   * DTO, para um PATCH parcial não zerar a numeração dos outros documentos.
   */
  private async syncEnvironmentNumbering(
    tx: any,
    config: any,
    dto: UpdateInvoicyConfigDto,
    data: any,
  ): Promise<void> {
    const targets = [
      {
        docType: 'NFE' as const,
        environment:
          dto.nfeNumberingEnvironment ??
          this.fiscalCredentialResolver.resolveEnvironmentFromConfig(
            config,
            'NFE',
          ),
        series: data.serieNfe,
        nextNumber: data.proximoNumeroNfe,
        seriesColumn: 'nfeSeries',
        numberColumn: 'nfeNextNumber',
      },
      {
        docType: 'NFCE' as const,
        environment:
          dto.nfceNumberingEnvironment ??
          this.fiscalCredentialResolver.resolveEnvironmentFromConfig(
            config,
            'NFCE',
          ),
        series: data.serieNfce,
        nextNumber: data.proximoNumeroNfce,
        seriesColumn: 'nfceSeries',
        numberColumn: 'nfceNextNumber',
      },
      {
        docType: 'NFSE' as const,
        environment:
          dto.nfseNumberingEnvironment ??
          this.fiscalCredentialResolver.resolveEnvironmentFromConfig(
            config,
            'NFSE',
          ),
        series: data.serieNfse,
        nextNumber: data.proximoRpsNfse,
        seriesColumn: 'nfseSeries',
        numberColumn: 'nfseNextNumber',
      },
    ];

    for (const target of targets) {
      const changes: Record<string, any> = {};
      if (target.series !== undefined)
        changes[target.seriesColumn] = target.series;
      if (target.nextNumber !== undefined)
        changes[target.numberColumn] = target.nextNumber;

      if (Object.keys(changes).length === 0) continue;

      await tx.invoicyEnvironmentConfig.upsert({
        where: {
          invoicyConfigId_environment_docType: {
            invoicyConfigId: config.id,
            environment: target.environment,
            docType: target.docType,
          },
        },
        // status DRAFT no create: existir a linha nunca significou ambiente
        // ativado — isso continua sendo do assistente de ativação.
        create: {
          invoicyConfigId: config.id,
          environment: target.environment,
          docType: target.docType,
          status: 'DRAFT',
          ...changes,
        },
        update: changes,
      });

      this.logger.log(
        `Numeração de ${target.docType} do emissor ${config.id} ajustada em ${target.environment}: ` +
          JSON.stringify(changes),
      );
    }
  }

  // updateConfig - alias removido, usar update() com id diretamente

  /**
   * Upsert - criar ou atualizar emissor padrão (para compatibilidade)
   */
  async upsertConfig(companyId: string, dto: CreateInvoicyConfigDto) {
    const existing = await this.prisma.invoicyConfig.findFirst({
      where: { companyId, isDefault: true },
    });

    if (existing) {
      return this.update(existing.id, dto);
    }

    return this.create(companyId, dto);
  }

  /**
   * Excluir emissor por ID
   */
  async delete(id: string) {
    const config = await this.prisma.invoicyConfig.findUnique({
      where: { id },
    });

    if (!config) {
      throw new NotFoundException('Emissor não encontrado');
    }

    const wasDefault = config.isDefault;
    const companyId = config.companyId;

    await this.prisma.invoicyConfig.delete({
      where: { id },
    });

    // Se era o padrão, definir outro como padrão
    if (wasDefault) {
      const nextDefault = await this.prisma.invoicyConfig.findFirst({
        where: { companyId },
        orderBy: { createdAt: 'asc' },
      });

      if (nextDefault) {
        await this.prisma.invoicyConfig.update({
          where: { id: nextDefault.id },
          data: { isDefault: true },
        });
      }
    }

    return { success: true };
  }

  /**
   * Atualizar certificado digital do emissor.
   * Envia o novo certificado para o Invoicy via API de parceiro.
   * Grava criptografado (e em plaintext legado se modo DUAL).
   */
  async updateCertificate(
    id: string,
    certificate: string,
    certificatePassword: string,
    certificateType = 'A1',
    actorUserId?: string,
    actorUserName?: string,
  ) {
    const config = await this.prisma.invoicyConfig.findUnique({
      where: { id },
      include: { company: true },
    });

    if (!config) {
      throw new NotFoundException('Emissor não encontrado');
    }

    const cnpj = config.company?.cnpj;
    if (!cnpj) {
      throw new NotFoundException('CNPJ da empresa não encontrado');
    }

    this.validateCertificateMatchesCompany(
      certificate,
      certificatePassword,
      cnpj,
    );

    await this.invoicyHttpService.updateCompanyCertificate({
      cnpj,
      certificate,
      certificatePassword,
      certificateType,
      environment:
        ((config.activeEnvironment as string) ?? config.environment) ===
        'PRODUCAO'
          ? 'PRODUCAO'
          : 'HOMOLOGACAO',
    });

    // Upsert para obter/criar o ID do certificado (necessário para AAD)
    const existing = await this.prisma.digitalCertificate.findUnique({
      where: { companyId: config.companyId },
      select: { id: true },
    });
    const certId = existing?.id ?? crypto.randomUUID();
    const companyId = config.companyId;

    const passwordEncrypted = this.encryptionService.encrypt(
      certificatePassword,
      {
        table: 'digital_certificates',
        recordId: certId,
        companyId,
        field: 'passwordEncrypted',
        scope: 'GLOBAL',
      },
    );
    const certificateEncrypted = this.encryptionService.encrypt(certificate, {
      table: 'digital_certificates',
      recordId: certId,
      companyId,
      field: 'certificateEncrypted',
      scope: 'GLOBAL',
    });

    const writeToLegacy = this.fiscalRolloutPolicy.shouldWriteToLegacy();

    const auditAction = actorUserId
      ? this.fiscalAuditService.runAuditedAction(
          {
            companyId,
            invoicyConfigId: id,
            emissorName: config.name,
            action: FiscalConfigAction.CERTIFICATE_UPLOADED,
            actorType: ActorType.USER,
            createdBy: actorUserId,
            createdByName: actorUserName ?? actorUserId,
            description: 'Certificado digital atualizado',
          },
          async (tx) => {
            if (existing) {
              await tx.digitalCertificate.update({
                where: { id: certId },
                data: {
                  type: certificateType as any,
                  passwordEncrypted,
                  certificateEncrypted,
                  lastUpload: new Date(),
                  ...(writeToLegacy
                    ? { password: certificatePassword, certificate }
                    : {}),
                },
              });
            } else {
              await tx.digitalCertificate.create({
                data: {
                  id: certId,
                  companyId,
                  type: certificateType as any,
                  passwordEncrypted,
                  certificateEncrypted,
                  lastUpload: new Date(),
                  ...(writeToLegacy
                    ? { password: certificatePassword, certificate }
                    : {}),
                },
              });
            }
          },
        )
      : (async () => {
          if (existing) {
            await this.prisma.digitalCertificate.update({
              where: { id: certId },
              data: {
                type: certificateType as any,
                passwordEncrypted,
                certificateEncrypted,
                lastUpload: new Date(),
                ...(writeToLegacy
                  ? { password: certificatePassword, certificate }
                  : {}),
              },
            });
          } else {
            await this.prisma.digitalCertificate.create({
              data: {
                id: certId,
                companyId,
                type: certificateType as any,
                passwordEncrypted,
                certificateEncrypted,
                lastUpload: new Date(),
                ...(writeToLegacy
                  ? { password: certificatePassword, certificate }
                  : {}),
              },
            });
          }
        })();

    await auditAction;

    // Certificado é GLOBAL: rebaixar TODOS os ambientes de TODOS os emissores da empresa
    await this.prisma.invoicyEnvironmentConfig.updateMany({
      where: {
        invoicyConfig: { companyId },
      },
      data: {
        status: 'DRAFT',
        lastValidationAt: null,
        lastValidationError: null,
      },
    });

    this.invoicyHttpService.clearTokenCache(companyId);
    return { success: true, message: 'Certificado atualizado com sucesso' };
  }

  /**
   * Definir emissor como padrão
   */
  private validateCertificateMatchesCompany(
    certificate: string,
    certificatePassword: string,
    companyCnpj: string,
  ) {
    const result = validatePfxCertificateCnpj(
      certificate,
      certificatePassword,
      companyCnpj,
    );

    if (!result.valid) {
      throw new BadRequestException(result.message);
    }
  }

  async setDefault(id: string, companyId: string) {
    const config = await this.prisma.invoicyConfig.findUnique({
      where: { id },
    });

    if (!config || config.companyId !== companyId) {
      throw new NotFoundException('Emissor não encontrado');
    }

    // Remover padrão dos outros
    await this.prisma.invoicyConfig.updateMany({
      where: { companyId, isDefault: true },
      data: { isDefault: false },
    });

    // Definir este como padrão
    const result = await this.prisma.invoicyConfig.update({
      where: { id },
      data: { isDefault: true },
      include: {
        company: {
          include: {
            address: true,
            DigitalCertificate: true,
            environmentCredentials: {
              select: { environment: true, providerAccessKeyEncrypted: true },
            },
          },
        },
      },
    });

    return this.mapDbToResponse(result);
  }

  /**
   * Incrementar número da NF-e para um emissor específico
   *
   * @deprecated Não usar em fluxo de emissão. Incrementa a coluna legada GLOBAL
   * `proximoNumeroNfe`, que hoje é o campo editável da tela de Emissor e não a
   * sequência que a SEFAZ vê — além de não separar homologação de produção.
   * A reserva correta é `FiscalCredentialResolverService.reserveNfeNumber`,
   * atômica e por (emissor, ambiente). Sem chamadores em produção.
   */
  async incrementNfeNumber(emissoreId: string): Promise<number> {
    const updated = await this.prisma.invoicyConfig.update({
      where: { id: emissoreId },
      data: { proximoNumeroNfe: { increment: 1 } },
      select: { proximoNumeroNfe: true },
    });

    if (!updated) {
      throw new NotFoundException('Emissor não encontrado');
    }

    return updated.proximoNumeroNfe - 1;
  }

  /**
   * Incrementar número do RPS (NFS-e) para um emissor específico
   */
  async incrementNfseRpsNumber(emissoreId: string): Promise<number> {
    const updated = await this.prisma.invoicyConfig.update({
      where: { id: emissoreId },
      data: { proximoRpsNfse: { increment: 1 } },
      select: { proximoRpsNfse: true },
    });

    if (!updated) {
      throw new NotFoundException('Emissor não encontrado');
    }

    return updated.proximoRpsNfse - 1;
  }

  /**
   * Incrementar número da NFC-e para um emissor específico
   */
  async incrementNfceNumber(emissoreId: string): Promise<number> {
    const updated = await this.prisma.invoicyConfig.update({
      where: { id: emissoreId },
      data: { proximoNumeroNfce: { increment: 1 } },
      select: { proximoNumeroNfce: true },
    });

    if (!updated) {
      throw new NotFoundException('Emissor não encontrado');
    }

    return updated.proximoNumeroNfce - 1;
  }

  /**
   * Testar conexão com o Invoicy para um emissor específico.
   * Usa o resolvedor de credenciais para obter a chave correta do ambiente.
   */
  async testConnection(emissoreId: string): Promise<boolean> {
    const fullConfig = await this.prisma.invoicyConfig.findUnique({
      where: { id: emissoreId },
    });

    if (!fullConfig) {
      throw new NotFoundException('Emissor não encontrado');
    }

    try {
      this.logger.log(
        `Testando conexão com Invoicy para emissor ${emissoreId}`,
      );
      return await this.invoicyHttpService.testConnection(fullConfig.companyId);
    } catch {
      this.logger.error('Erro ao testar conexão com Invoicy');
      return false;
    }
  }

  /**
   * Verifica que o emissor pertence à empresa do usuário (anti-IDOR).
   * Lança NotFoundException para não revelar existência do recurso.
   */
  async verifyOwnership(id: string, companyId: string): Promise<void> {
    const config = await this.prisma.invoicyConfig.findUnique({
      where: { id },
      select: { companyId: true },
    });
    if (!config || config.companyId !== companyId) {
      throw new NotFoundException('Emissor não encontrado');
    }
  }

  /**
   * Verifica se a troca de ambiente está bloqueada para um emissor.
   * Retorna true enquanto a migração de criptografia não estiver concluída.
   */
  async getEnvironmentSwitchLocked(invoicyConfigId: string): Promise<boolean> {
    return this.fiscalRolloutPolicy.isEnvironmentSwitchLocked(invoicyConfigId);
  }

  /**
   * Configurar CSC para um ambiente específico do emissor.
   * Segue o protocolo validate-before-replace com auditoria transacional.
   */
  async setCsc(
    invoicyConfigId: string,
    environment: FiscalEnvironment,
    cscId: string,
    cscToken: string,
    actorUserId: string,
    actorUserName: string,
  ): Promise<{ success: boolean }> {
    const config = await this.prisma.invoicyConfig.findUnique({
      where: { id: invoicyConfigId },
      include: { company: true },
    });

    if (!config) {
      throw new NotFoundException('Emissor não encontrado');
    }

    const companyId = config.companyId;
    const emissorName = config.name;

    await this.fiscalAuditService.runAuditedAction(
      {
        companyId,
        invoicyConfigId,
        emissorName,
        action: FiscalConfigAction.CREDENTIALS_ROTATE,
        actorType: ActorType.USER,
        createdBy: actorUserId,
        createdByName: actorUserName,
        environment,
        description: `CSC configurado para ambiente ${environment}`,
        changes: { cscId },
      },
      async (tx) => {
        // Upsert-then-encrypt: obter id estável antes de cifrar (garante AAD correto)
        const row = await tx.invoicyEnvironmentConfig.upsert({
          where: {
            invoicyConfigId_environment_docType: {
              invoicyConfigId,
              environment,
              docType: 'NFCE',
            },
          },
          create: {
            invoicyConfigId,
            environment,
            docType: 'NFCE',
            cscId,
            cscTokenEncrypted: null,
          },
          update: { cscId },
          select: { id: true },
        });

        const cscTokenEncrypted = this.encryptionService.encrypt(cscToken, {
          table: 'invoicy_environment_configs',
          recordId: row.id,
          companyId,
          field: 'cscTokenEncrypted',
          scope: environment,
        });

        await tx.invoicyEnvironmentConfig.update({
          where: { id: row.id },
          data: {
            cscTokenEncrypted,
            // Rebaixar para DRAFT: credencial alterada invalida ativação anterior
            status: 'DRAFT',
            lastValidationAt: null,
            lastValidationError: null,
          },
        });

        // Escrita dupla no legado somente se modo DUAL e ambiente for o ativo do emissor
        if (this.fiscalRolloutPolicy.shouldWriteToLegacy()) {
          const activeEnv =
            await this.fiscalCredentialResolver.resolveOperationalEnvironment(
              companyId,
              invoicyConfigId,
            );
          if (activeEnv === environment) {
            await tx.invoicyConfig.update({
              where: { id: invoicyConfigId },
              data: { cscId, cscToken },
            });
          }
        }
      },
    );

    return { success: true };
  }

  /**
   * Remover CSC de um ambiente específico do emissor.
   */
  async deleteCsc(
    invoicyConfigId: string,
    environment: FiscalEnvironment,
    actorUserId: string,
    actorUserName: string,
  ): Promise<{ success: boolean }> {
    const config = await this.prisma.invoicyConfig.findUnique({
      where: { id: invoicyConfigId },
    });

    if (!config) {
      throw new NotFoundException('Emissor não encontrado');
    }

    const companyId = config.companyId;

    await this.fiscalAuditService.runAuditedAction(
      {
        companyId,
        invoicyConfigId,
        emissorName: config.name,
        action: FiscalConfigAction.CREDENTIALS_ROTATE,
        actorType: ActorType.USER,
        createdBy: actorUserId,
        createdByName: actorUserName,
        environment,
        description: `CSC removido do ambiente ${environment}`,
      },
      async (tx) => {
        await tx.invoicyEnvironmentConfig.updateMany({
          where: { invoicyConfigId, environment },
          data: {
            cscId: null,
            cscTokenEncrypted: null,
            status: 'DRAFT',
            lastValidationAt: null,
            lastValidationError: null,
          },
        });

        // Limpar legado somente se modo DUAL e ambiente ativo
        if (this.fiscalRolloutPolicy.shouldWriteToLegacy()) {
          const activeEnv =
            await this.fiscalCredentialResolver.resolveOperationalEnvironment(
              companyId,
              invoicyConfigId,
            );
          if (activeEnv === environment) {
            await tx.invoicyConfig.update({
              where: { id: invoicyConfigId },
              data: { cscId: null, cscToken: null },
            });
          }
        }
      },
    );

    return { success: true };
  }

  /**
   * Configurar access key do Invoicy para um ambiente específico.
   * Valida autenticação antes de substituir a chave anterior.
   */
  async setAccessKey(
    invoicyConfigId: string,
    environment: FiscalEnvironment,
    accessKey: string,
    actorUserId: string,
    actorUserName: string,
  ): Promise<{ success: boolean }> {
    const config = await this.prisma.invoicyConfig.findUnique({
      where: { id: invoicyConfigId },
      include: { company: true },
    });

    if (!config) {
      throw new NotFoundException('Emissor não encontrado');
    }

    const companyId = config.companyId;

    const cnpj = config.company?.cnpj;
    if (!cnpj) {
      throw new BadRequestException('Empresa sem CNPJ configurado');
    }

    const auditData = {
      companyId,
      invoicyConfigId,
      emissorName: config.name,
      action: FiscalConfigAction.CREDENTIALS_ROTATE,
      actorType: ActorType.USER,
      createdBy: actorUserId,
      createdByName: actorUserName,
      environment,
      description: `Access key configurada para ambiente ${environment}`,
    };

    // A chamada externa precisa ocorrer fora da transação interativa do Prisma.
    // Em caso de rejeição ou indisponibilidade, registra FAILED separadamente e
    // preserva a credencial atual.
    try {
      const isValid = await this.invoicyHttpService.validateRawAccessKey(
        cnpj,
        environment,
        accessKey,
      );
      if (!isValid) {
        throw new BadRequestException(
          'Access key rejeitada pelo Invoicy para este ambiente',
        );
      }
    } catch (error) {
      await this.fiscalAuditService.recordFailedAction(auditData, error);
      throw error;
    }

    await this.fiscalAuditService.runAuditedAction(auditData, async (tx) => {
      // Upsert-then-encrypt: obter id estável antes de cifrar (garante AAD correto)
      const row = await tx.companyEnvironmentCredential.upsert({
        where: { companyId_environment: { companyId, environment } },
        create: { companyId, environment, providerAccessKeyEncrypted: null },
        update: {},
        select: { id: true },
      });

      const providerAccessKeyEncrypted = this.encryptionService.encrypt(
        accessKey,
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

      // Escrita dupla no legado somente se modo DUAL e ambiente ativo
      if (this.fiscalRolloutPolicy.shouldWriteToLegacy()) {
        const activeEnv =
          await this.fiscalCredentialResolver.resolveOperationalEnvironment(
            companyId,
            invoicyConfigId,
          );
        if (activeEnv === environment) {
          await tx.company.update({
            where: { id: companyId },
            data: { accessKey },
          });
        }
      }

      // Rebaixar TODOS os emissores da empresa neste ambiente para DRAFT,
      // INCLUSIVE o alvo. A access key (CompanyEnvironmentCredential) é
      // compartilhada por company+environment; trocá-la invalida qualquer
      // READY existente, que passa a exigir nova ativação/validação.
      await tx.invoicyEnvironmentConfig.updateMany({
        where: { invoicyConfig: { companyId }, environment },
        data: {
          status: 'DRAFT',
          lastValidationAt: null,
          lastValidationError: null,
        },
      });

      // Invalidar cache de token pois credenciais mudaram
      this.invoicyHttpService.clearTokenCache(companyId, environment as any);
    });

    return { success: true };
  }

  /**
   * Configurar série e próximo número da NFC-e para um ambiente específico.
   *
   * A numeração fiscal por ambiente vive em `InvoicyEnvironmentConfig` e é a
   * fonte usada pela reserva atômica de número (Plano 3) quando
   * `USE_ENCRYPTED_FISCAL_DB=true`. O PATCH comum do emissor altera apenas os
   * campos legados, por isso este endpoint dedicado é necessário para o check
   * de readiness `nfce_numbering`.
   */
  async setNfceNumbering(
    invoicyConfigId: string,
    environment: FiscalEnvironment,
    nfceSeries: number,
    nfceNextNumber: number,
    actorUserId: string,
    actorUserName: string,
  ): Promise<{ success: boolean }> {
    if (
      !nfceSeries ||
      nfceSeries < 1 ||
      !nfceNextNumber ||
      nfceNextNumber < 1
    ) {
      throw new BadRequestException('Série e próximo número devem ser ≥ 1');
    }

    const config = await this.prisma.invoicyConfig.findUnique({
      where: { id: invoicyConfigId },
    });
    if (!config) {
      throw new NotFoundException('Emissor não encontrado');
    }

    const companyId = config.companyId;

    await this.fiscalAuditService.runAuditedAction(
      {
        companyId,
        invoicyConfigId,
        emissorName: config.name,
        action: FiscalConfigAction.ENVIRONMENT_CONFIG_CREATE,
        actorType: ActorType.USER,
        createdBy: actorUserId,
        createdByName: actorUserName,
        environment,
        description: `Numeração NFC-e configurada para ambiente ${environment}`,
        changes: { nfceSeries, nfceNextNumber },
      },
      async (tx) => {
        await tx.invoicyEnvironmentConfig.upsert({
          where: {
            invoicyConfigId_environment_docType: {
              invoicyConfigId,
              environment,
              docType: 'NFCE',
            },
          },
          create: {
            invoicyConfigId,
            environment,
            docType: 'NFCE',
            nfceSeries,
            nfceNextNumber,
          },
          update: { nfceSeries, nfceNextNumber },
        });

        // Escrita dupla no legado somente se modo DUAL e ambiente for o ativo do emissor
        if (this.fiscalRolloutPolicy.shouldWriteToLegacy()) {
          const activeEnv =
            await this.fiscalCredentialResolver.resolveOperationalEnvironment(
              companyId,
              invoicyConfigId,
            );
          if (activeEnv === environment) {
            await tx.invoicyConfig.update({
              where: { id: invoicyConfigId },
              data: {
                serieNfce: nfceSeries,
                proximoNumeroNfce: nfceNextNumber,
              },
            });
          }
        }
      },
    );

    return { success: true };
  }

  /**
   * Helper para preparar dados (simplified)
   */
  private async prepareDataWithCep(
    dto: CreateInvoicyConfigDto | UpdateInvoicyConfigDto,
  ) {
    // We no longer fetch address from CEP here as address is managed by Company
    return this.mapDtoToDb(dto);
  }
}
