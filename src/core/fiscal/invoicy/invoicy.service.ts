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

@Injectable()
export class InvoicyService {
  private readonly logger = new Logger(InvoicyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly invoicyHttpService: InvoicyHttpService,
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

    // Sincroniza ambiente (int) e environment (string) sempre juntos
    // O form pode enviar 'ambiente' como string ('PRODUCAO'/'HOMOLOGACAO')
    // ou como número (1/2). O campo 'environment' é sempre string.
    if (dto.environment !== undefined) {
      data.environment = dto.environment;
      data.ambiente = dto.environment === 'PRODUCAO' ? 1 : 2;
    }
    if (dto.ambiente !== undefined) {
      // Se chegou como número (correto)
      if (typeof dto.ambiente === 'number') {
        data.ambiente = dto.ambiente;
        data.environment = dto.ambiente === 1 ? 'PRODUCAO' : 'HOMOLOGACAO';
      } else {
        // Se chegou como string (via form select) — normaliza
        const ambStr = String(dto.ambiente);
        const isProd = ambStr === 'PRODUCAO' || ambStr === '1';
        data.ambiente = isProd ? 1 : 2;
        data.environment = isProd ? 'PRODUCAO' : 'HOMOLOGACAO';
      }
    }

    if (dto.emitCrt !== undefined) data.emitCrt = dto.emitCrt;
    if (dto.codigoServico !== undefined) data.codigoServico = dto.codigoServico;
    if (dto.aliquotaIss !== undefined) data.aliquotaIss = dto.aliquotaIss;
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
    if (dto.nfseNextNumber !== undefined)
      data.proximoRpsNfse = dto.nfseNextNumber;

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
    if (dto.cscId !== undefined && dto.cscId !== '') data.cscId = dto.cscId;
    if (dto.cscToken !== undefined && dto.cscToken !== '')
      data.cscToken = dto.cscToken;

    // Boolean field
    if ('isActive' in dto && dto.isActive !== undefined)
      data.isActive = dto.isActive;

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

  private async ensureCompanyRegisteredForEnvironment(
    companyId: string,
    environment: 'PRODUCAO' | 'HOMOLOGACAO',
  ) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: { address: true, DigitalCertificate: true },
    });

    if (!company) {
      throw new NotFoundException('Empresa não encontrada');
    }

    if (!company.cnpj) {
      throw new BadRequestException(
        'CNPJ da empresa é obrigatório para cadastrar no Invoicy',
      );
    }

    if (company.DigitalCertificate?.certificate) {
      this.validateCertificateMatchesCompany(
        company.DigitalCertificate.certificate,
        company.DigitalCertificate.password || '',
        company.cnpj,
      );
    }

    const address = company.address?.[0];
    const registration = await this.invoicyHttpService.registerCompany({
      cnpj: company.cnpj,
      razaoSocial: company.legalName || company.name,
      nomeFantasia: company.name,
      ie: company.stateRegistration || undefined,
      im: company.municipalRegistration || undefined,
      uf: address?.state || undefined,
      cep: address?.zipcode || undefined,
      logradouro: address?.street || undefined,
      numero: address?.number || undefined,
      bairro: address?.neighborhood || undefined,
      cidade: address?.city || undefined,
      environment,
      certificate: company.DigitalCertificate?.certificate || undefined,
      certificatePassword: company.DigitalCertificate?.password || undefined,
      certificateType: company.DigitalCertificate?.type || undefined,
    });

    await this.prisma.company.update({
      where: { id: companyId },
      data: { accessKey: registration.accessKey },
    });
  }

  // Map database fields to frontend fields
  private mapDbToResponse(config: any) {
    if (!config) return null;

    const company = config.company || {};
    const address = company.address?.[0] || {}; // Assume first address is principal
    const digitalCertificate = company.DigitalCertificate || {};

    // Normalizar environment a partir de ambiente (int) se estiver nulo
    // Garante consistência mesmo em registros antigos com campos dessincronizados
    const normalizedEnvironment =
      config.environment ||
      (config.ambiente === 1 ? 'PRODUCAO' : 'HOMOLOGACAO');

    return {
      ...config,
      environment: normalizedEnvironment,
      // Nested company structure
      company: {
        id: company.id,
        name: company.name, // Nome Fantasia
        legalName: company.legalName, // Razão Social
        cnpj: company.cnpj,
        stateRegistration: company.stateRegistration, // IE
        municipalRegistration: company.municipalRegistration, // IM
        accessKey: company.accessKey,
        partnerKey: company.partnerKey,
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

      // Fiscal specific config
      nfeSeries: config.serieNfe?.toString() || '1',
      nfeNextNumber: config.proximoNumeroNfe || 1,
      nfseSeries: config.serieNfse || 'A1',
      nfseNextNumber: config.proximoRpsNfse || 1,
      nfceSeries: config.serieNfce?.toString() || '1',
      nfceNextNumber: config.proximoNumeroNfce || 1,
      cscId: config.cscId || '',
      cscConfigured: !!config.cscToken,

      // IBGE Code (Configuration specific if we want to override, or just null)
      // Keeping it on root as it might be relevant for the configuration specifically
      ibgeCode: config.emitCmun || null,

      // Default NCM for new products
      defaultNcm: config.defaultNcm || null,
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
        company: {
          include: {
            address: true,
            DigitalCertificate: true, // Assuming this is the relation name
          },
        },
      },
    });

    return configs.map((config) => this.mapDbToResponse(config));
  }

  /**
   * Obter emissor por ID
   */
  async getById(id: string) {
    const config = await this.prisma.invoicyConfig.findUnique({
      where: { id },
      include: {
        company: {
          include: {
            address: true,
            DigitalCertificate: true,
          },
        },
      },
    });

    return this.mapDbToResponse(config);
  }

  /**
   * Obter emissor padrão de uma empresa
   */
  async getDefault(companyId: string) {
    const config = await this.prisma.invoicyConfig.findFirst({
      where: { companyId, isDefault: true },
      include: {
        company: {
          include: {
            address: true,
            DigitalCertificate: true,
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
          company: {
            include: {
              address: true,
              DigitalCertificate: true,
            },
          },
        },
      });
      return this.mapDbToResponse(firstConfig);
    }

    return this.mapDbToResponse(config);
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
    const targetEnvironment = this.resolveDtoEnvironment(dto);

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

    if (targetEnvironment === 'PRODUCAO') {
      await this.ensureCompanyRegisteredForEnvironment(
        companyId,
        targetEnvironment,
      );
    }

    const result = await this.prisma.invoicyConfig.create({
      data: {
        ...data,
        companyId,
        isDefault,
      },
      include: {
        company: {
          include: {
            address: true,
            DigitalCertificate: true,
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

    // Se está marcando como padrão, remover padrão dos outros
    const targetEnvironment = this.resolveDtoEnvironment(dto);
    const currentEnvironment = this.normalizeEnvironment(config.environment);

    if (targetEnvironment && targetEnvironment !== currentEnvironment) {
      await this.ensureCompanyRegisteredForEnvironment(
        config.companyId,
        targetEnvironment,
      );
    }

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

    const result = await this.prisma.invoicyConfig.update({
      where: { id },
      data,
      include: {
        company: {
          include: {
            address: true,
            DigitalCertificate: true,
          },
        },
      },
    });

    return this.mapDbToResponse(result);
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
   */
  async updateCertificate(
    id: string,
    certificate: string,
    certificatePassword: string,
    certificateType = 'A1',
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
        config.environment === 'PRODUCAO' ? 'PRODUCAO' : 'HOMOLOGACAO',
    });

    await this.prisma.digitalCertificate.upsert({
      where: { companyId: config.companyId },
      create: {
        companyId: config.companyId,
        type: certificateType as any,
        password: certificatePassword,
        certificate,
        lastUpload: new Date(),
      },
      update: {
        type: certificateType as any,
        password: certificatePassword,
        certificate,
        lastUpload: new Date(),
      },
    });

    // Limpar cache de token pois credenciais podem ter mudado
    this.invoicyHttpService.clearTokenCache(config.companyId);

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
          },
        },
      },
    });

    return this.mapDbToResponse(result);
  }

  /**
   * Incrementar número da NF-e para um emissor específico
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
   * Testar conexão com o Invoicy para um emissor específico
   */
  async testConnection(emissoreId: string): Promise<boolean> {
    const config = await this.getById(emissoreId);

    if (!config) {
      throw new NotFoundException('Emissor não encontrado');
    }

    if (!config.accessKey) {
      this.logger.warn(
        `Chave de acesso (accessKey) não configurada para emissor ${emissoreId}`,
      );
      return false;
    }

    try {
      this.logger.log(
        `Testando conexão com Invoicy para emissor ${emissoreId}`,
      );
      // Usar companyId do emissor para o teste
      const fullConfig = await this.prisma.invoicyConfig.findUnique({
        where: { id: emissoreId },
      });
      return await this.invoicyHttpService.testConnection(fullConfig.companyId);
    } catch (error) {
      this.logger.error(
        `Erro ao testar conexão com Invoicy: ${error.message}`,
        error.stack,
      );
      return false;
    }
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
