import {
  Injectable,
  NotFoundException,
  Logger,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'nestjs-prisma';
import {
  CreateInvoicyConfigDto,
  UpdateInvoicyConfigDto,
} from './dtos/invoicy-config.dto';
import { InvoicyHttpService } from './invoicy-http.service';
import { fetchCepData } from '../utils/cep.util';

@Injectable()
export class InvoicyService {
  private readonly logger = new Logger(InvoicyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly invoicyHttpService: InvoicyHttpService,
  ) { }

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

  // Map frontend fields to database fields
  private mapDtoToDb(dto: CreateInvoicyConfigDto | UpdateInvoicyConfigDto) {
    const data: any = {};

    // Campos de identificação do emissor
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.isDefault !== undefined) data.isDefault = dto.isDefault;

    // Invoicy credentials (per-company)
    if (dto.accessKey !== undefined) data.accessKey = dto.accessKey;
    if (dto.partnerKey !== undefined) data.partnerKey = dto.partnerKey;

    // Certificado digital
    if (dto.certificate !== undefined) data.certificate = dto.certificate;
    if (dto.certificatePassword !== undefined)
      data.certificatePassword = dto.certificatePassword;

    // Direct mappings (fields that exist in both)
    if (dto.environment !== undefined) data.environment = dto.environment;
    if (dto.apiToken !== undefined) data.apiToken = dto.apiToken;
    if (dto.ambiente !== undefined) data.ambiente = dto.ambiente;
    if (dto.emitCnpj !== undefined) data.emitCnpj = dto.emitCnpj;
    if (dto.emitIe !== undefined) data.emitIe = dto.emitIe;
    if (dto.emitIm !== undefined) data.emitIm = dto.emitIm;
    if (dto.emitRazaoSocial !== undefined)
      data.emitRazaoSocial = dto.emitRazaoSocial;
    if (dto.emitNomeFantasia !== undefined)
      data.emitNomeFantasia = dto.emitNomeFantasia;
    if (dto.emitCrt !== undefined) data.emitCrt = dto.emitCrt;
    if (dto.emitEndereco !== undefined) data.emitEndereco = dto.emitEndereco;
    if (dto.emitNumero !== undefined) data.emitNumero = dto.emitNumero;
    if (dto.emitBairro !== undefined) data.emitBairro = dto.emitBairro;
    if (dto.emitCep !== undefined) data.emitCep = dto.emitCep;
    if (dto.emitCmun !== undefined) data.emitCmun = dto.emitCmun;
    if (dto.emitXMun !== undefined) data.emitXMun = dto.emitXMun;
    if (dto.emitUf !== undefined) data.emitUf = dto.emitUf;
    if (dto.emitPais !== undefined) data.emitPais = dto.emitPais;
    if (dto.codigoServico !== undefined) data.codigoServico = dto.codigoServico;
    if (dto.aliquotaIss !== undefined) data.aliquotaIss = dto.aliquotaIss;
    if (dto.defaultCfop !== undefined) data.defaultCfop = dto.defaultCfop;
    if (dto.defaultOperationNature !== undefined)
      data.defaultOperationNature = dto.defaultOperationNature;
    if (dto.taxInfoText !== undefined) data.taxInfoText = dto.taxInfoText;

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

    // Boolean field
    if ('isActive' in dto && dto.isActive !== undefined)
      data.isActive = dto.isActive;

    return data;
  }

  // Map database fields to frontend fields
  private mapDbToResponse(config: any) {
    if (!config) return null;

    return {
      ...config,
      // Map database names to frontend names
      nfeSeries: config.serieNfe?.toString() || '1',
      nfeNextNumber: config.proximoNumeroNfe || 1,
      nfseSeries: config.serieNfse || 'A1',
      nfseNextNumber: config.proximoRpsNfse || 1,
      nfceSeries: config.serieNfce?.toString() || '1',
      nfceNextNumber: config.proximoNumeroNfce || 1,
      // Ensure emitCmun is explicitly included
      emitCmun: config.emitCmun || null,
      emitIm: config.emitIm || null,
      // Mask certificate password for security
      certificatePassword: config.certificatePassword ? '********' : null,
      // Indicate if certificate is configured
      hasCertificate: !!config.certificate,
    };
  }

  /**
   * Listar todos os emissores de uma empresa
   */
  async getAllByCompany(companyId: string) {
    const configs = await this.prisma.invoicyConfig.findMany({
      where: { companyId },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });

    return configs.map((config) => this.mapDbToResponse(config));
  }

  /**
   * Obter emissor por ID
   */
  async getById(id: string) {
    const config = await this.prisma.invoicyConfig.findUnique({
      where: { id },
    });

    return this.mapDbToResponse(config);
  }

  /**
   * Obter emissor padrão de uma empresa
   */
  async getDefault(companyId: string) {
    const config = await this.prisma.invoicyConfig.findFirst({
      where: { companyId, isDefault: true },
    });

    // Se não houver emissor padrão, retorna o primeiro
    if (!config) {
      const firstConfig = await this.prisma.invoicyConfig.findFirst({
        where: { companyId },
        orderBy: { createdAt: 'asc' },
      });
      return this.mapDbToResponse(firstConfig);
    }

    return this.mapDbToResponse(config);
  }

  /**
   * @deprecated Use getAllByCompany instead
   * Mantido para compatibilidade com código existente
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
      },
    });

    return this.mapDbToResponse(result);
  }

  /**
   * @deprecated Use create instead
   */
  async createConfig(companyId: string, dto: CreateInvoicyConfigDto) {
    return this.create(companyId, dto);
  }

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
    if (dto.isDefault === true) {
      await this.prisma.invoicyConfig.updateMany({
        where: { companyId: config.companyId, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }

    const result = await this.prisma.invoicyConfig.update({
      where: { id },
      data,
    });

    return this.mapDbToResponse(result);
  }

  /**
   * @deprecated Use update with id instead
   */
  async updateConfig(companyId: string, dto: UpdateInvoicyConfigDto) {
    const config = await this.prisma.invoicyConfig.findFirst({
      where: { companyId, isDefault: true },
    });

    if (!config) {
      throw new NotFoundException(
        'Configuração do Invoicy não encontrada para esta empresa',
      );
    }

    return this.update(config.id, dto);
  }

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
   * @deprecated Use delete with id instead
   */
  async deleteConfig(companyId: string) {
    const config = await this.prisma.invoicyConfig.findFirst({
      where: { companyId, isDefault: true },
    });

    if (!config) {
      throw new NotFoundException(
        'Configuração do Invoicy não encontrada para esta empresa',
      );
    }

    return this.delete(config.id);
  }

  /**
   * Definir emissor como padrão
   */
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
    });

    return this.mapDbToResponse(result);
  }

  /**
   * Incrementar número da NF-e para um emissor específico
   */
  async incrementNfeNumber(emissoreId: string): Promise<number> {
    const config = await this.prisma.invoicyConfig.findUnique({
      where: { id: emissoreId },
    });

    if (!config) {
      throw new NotFoundException('Emissor não encontrado');
    }

    const currentNumber = config.proximoNumeroNfe;

    await this.prisma.invoicyConfig.update({
      where: { id: emissoreId },
      data: {
        proximoNumeroNfe: currentNumber + 1,
      },
    });

    return currentNumber;
  }

  /**
   * Incrementar número do RPS (NFS-e) para um emissor específico
   */
  async incrementNfseRpsNumber(emissoreId: string): Promise<number> {
    const config = await this.prisma.invoicyConfig.findUnique({
      where: { id: emissoreId },
    });

    if (!config) {
      throw new NotFoundException('Emissor não encontrado');
    }

    const currentNumber = config.proximoRpsNfse;

    await this.prisma.invoicyConfig.update({
      where: { id: emissoreId },
      data: {
        proximoRpsNfse: currentNumber + 1,
      },
    });

    return currentNumber;
  }

  /**
   * Incrementar número da NFC-e para um emissor específico
   */
  async incrementNfceNumber(emissoreId: string): Promise<number> {
    const config = await this.prisma.invoicyConfig.findUnique({
      where: { id: emissoreId },
    });

    if (!config) {
      throw new NotFoundException('Emissor não encontrado');
    }

    const currentNumber = config.proximoNumeroNfce;

    await this.prisma.invoicyConfig.update({
      where: { id: emissoreId },
      data: {
        proximoNumeroNfce: currentNumber + 1,
      },
    });

    return currentNumber;
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
      this.logger.log(`Testando conexão com Invoicy para emissor ${emissoreId}`);
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
   * Helper para preparar dados com busca de CEP
   */
  private async prepareDataWithCep(
    dto: CreateInvoicyConfigDto | UpdateInvoicyConfigDto,
  ) {
    const data = this.mapDtoToDb(dto);

    // Auto-fill address fields from CEP if IBGE code is not provided
    if (dto.emitCep && (!dto.emitCmun || !dto.emitXMun)) {
      this.logger.log(`Fetching address data from CEP: ${dto.emitCep}`);
      const cepData = await fetchCepData(dto.emitCep);

      if (cepData) {
        this.logger.log(
          `Found address: ${cepData.cidade}/${cepData.uf} - IBGE: ${cepData.codigoIbge}`,
        );

        // Only fill fields that weren't explicitly provided
        if (!dto.emitCmun) data.emitCmun = cepData.codigoIbge;
        if (!dto.emitXMun) data.emitXMun = cepData.cidade;
        if (!dto.emitUf) data.emitUf = cepData.uf;
        if (!dto.emitBairro && cepData.bairro) data.emitBairro = cepData.bairro;
        if (!dto.emitEndereco && cepData.logradouro)
          data.emitEndereco = cepData.logradouro;
      } else {
        this.logger.warn(`CEP not found: ${dto.emitCep}`);
      }
    }

    return data;
  }
}
