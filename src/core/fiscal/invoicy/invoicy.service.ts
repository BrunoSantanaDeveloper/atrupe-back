import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'nestjs-prisma';
import {
  CreateInvoicyConfigDto,
  UpdateInvoicyConfigDto,
} from './dtos/invoicy-config.dto';

@Injectable()
export class InvoicyService {
  private readonly logger = new Logger(InvoicyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Retorna as credenciais globais do Invoicy (Atrupe como revendedor)
   * Estas credenciais são usadas para todas as empresas
   */
  getGlobalCredentials() {
    return {
      partnerKey: this.configService.get<string>('INVOICY_PARTNER_KEY'),
      accessKey: this.configService.get<string>('INVOICY_ACCESS_KEY'),
      environment:
        this.configService.get<string>('INVOICY_ENVIRONMENT') || 'HOMOLOGACAO',
    };
  }

  // Map frontend fields to database fields
  private mapDtoToDb(dto: CreateInvoicyConfigDto | UpdateInvoicyConfigDto) {
    const data: any = {};

    // Direct mappings (fields that exist in both)
    // Note: partnerKey and accessKey are global credentials (from env vars), not per-client
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
    };
  }

  async getConfig(companyId: string) {
    const config = await this.prisma.invoicyConfig.findUnique({
      where: { companyId },
    });

    return this.mapDbToResponse(config);
  }

  async createConfig(companyId: string, dto: CreateInvoicyConfigDto) {
    const data = this.mapDtoToDb(dto);

    const result = await this.prisma.invoicyConfig.create({
      data: {
        ...data,
        companyId,
      },
    });

    return this.mapDbToResponse(result);
  }

  async updateConfig(companyId: string, dto: UpdateInvoicyConfigDto) {
    const config = await this.prisma.invoicyConfig.findUnique({
      where: { companyId },
    });

    if (!config) {
      throw new NotFoundException(
        'Configuração do Invoicy não encontrada para esta empresa',
      );
    }

    const data = this.mapDtoToDb(dto);

    const result = await this.prisma.invoicyConfig.update({
      where: { companyId },
      data,
    });

    return this.mapDbToResponse(result);
  }

  async upsertConfig(companyId: string, dto: CreateInvoicyConfigDto) {
    const data = this.mapDtoToDb(dto);

    const result = await this.prisma.invoicyConfig.upsert({
      where: { companyId },
      create: {
        ...data,
        companyId,
      },
      update: data,
    });

    return this.mapDbToResponse(result);
  }

  async deleteConfig(companyId: string) {
    const config = await this.prisma.invoicyConfig.findUnique({
      where: { companyId },
    });

    if (!config) {
      throw new NotFoundException(
        'Configuração do Invoicy não encontrada para esta empresa',
      );
    }

    return this.prisma.invoicyConfig.delete({
      where: { companyId },
    });
  }

  async incrementNfeNumber(companyId: string): Promise<number> {
    const config = await this.prisma.invoicyConfig.findUnique({
      where: { companyId },
    });

    if (!config) {
      throw new NotFoundException(
        'Configuração do Invoicy não encontrada para esta empresa',
      );
    }

    const currentNumber = config.proximoNumeroNfe;

    await this.prisma.invoicyConfig.update({
      where: { companyId },
      data: {
        proximoNumeroNfe: currentNumber + 1,
      },
    });

    return currentNumber;
  }

  async incrementNfseRpsNumber(companyId: string): Promise<number> {
    const config = await this.prisma.invoicyConfig.findUnique({
      where: { companyId },
    });

    if (!config) {
      throw new NotFoundException(
        'Configuração do Invoicy não encontrada para esta empresa',
      );
    }

    const currentNumber = config.proximoRpsNfse;

    await this.prisma.invoicyConfig.update({
      where: { companyId },
      data: {
        proximoRpsNfse: currentNumber + 1,
      },
    });

    return currentNumber;
  }

  async incrementNfceNumber(companyId: string): Promise<number> {
    const config = await this.prisma.invoicyConfig.findUnique({
      where: { companyId },
    });

    if (!config) {
      throw new NotFoundException(
        'Configuração do Invoicy não encontrada para esta empresa',
      );
    }

    const currentNumber = config.proximoNumeroNfce;

    await this.prisma.invoicyConfig.update({
      where: { companyId },
      data: {
        proximoNumeroNfce: currentNumber + 1,
      },
    });

    return currentNumber;
  }

  async testConnection(companyId: string): Promise<boolean> {
    const config = await this.getConfig(companyId);

    if (!config) {
      throw new NotFoundException(
        'Configuração do Invoicy não encontrada para esta empresa',
      );
    }

    try {
      // TODO: Implementar chamada real à API do Invoicy para testar conexão
      this.logger.log(`Testando conexão com Invoicy para empresa ${companyId}`);
      return true;
    } catch (error) {
      this.logger.error(
        `Erro ao testar conexão com Invoicy: ${error.message}`,
        error.stack,
      );
      return false;
    }
  }
}
