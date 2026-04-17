import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import {
  CreateProductFiscalDataDto,
  UpdateProductFiscalDataDto,
} from './dtos/product-fiscal.dto';

@Injectable()
export class ProductFiscalService {
  private readonly logger = new Logger(ProductFiscalService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findByProductId(productId: string) {
    const fiscalData = await this.prisma.productFiscalData.findUnique({
      where: { productId },
      include: {
        product: true,
      },
    });

    return fiscalData;
  }

  async create(dto: CreateProductFiscalDataDto) {
    // Verificar se o produto existe
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
    });

    if (!product) {
      throw new NotFoundException('Produto não encontrado');
    }

    // Verificar se já existe dados fiscais para o produto
    const existing = await this.prisma.productFiscalData.findUnique({
      where: { productId: dto.productId },
    });

    const data = this.mapDtoToData(dto);

    if (existing) {
      // Se já existe, atualiza
      return this.prisma.productFiscalData.update({
        where: { productId: dto.productId },
        data,
      });
    }

    return this.prisma.productFiscalData.create({
      data: {
        product: { connect: { id: dto.productId } },
        ...data,
      },
    });
  }

  async update(productId: string, dto: UpdateProductFiscalDataDto) {
    const fiscalData = await this.prisma.productFiscalData.findUnique({
      where: { productId },
    });

    if (!fiscalData) {
      throw new NotFoundException(
        'Dados fiscais não encontrados para este produto',
      );
    }

    const data = this.mapDtoToData(dto);

    return this.prisma.productFiscalData.update({
      where: { productId },
      data,
    });
  }

  async upsert(dto: CreateProductFiscalDataDto) {
    // Verificar se o produto existe
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
    });

    if (!product) {
      throw new NotFoundException('Produto não encontrado');
    }

    const data = this.mapDtoToData(dto);

    return this.prisma.productFiscalData.upsert({
      where: { productId: dto.productId },
      create: {
        product: { connect: { id: dto.productId } },
        ...data,
      },
      update: data,
    });
  }

  async delete(productId: string) {
    const fiscalData = await this.prisma.productFiscalData.findUnique({
      where: { productId },
    });

    if (!fiscalData) {
      throw new NotFoundException(
        'Dados fiscais não encontrados para este produto',
      );
    }

    return this.prisma.productFiscalData.delete({
      where: { productId },
    });
  }

  async findManyByProductIds(productIds: string[]) {
    return this.prisma.productFiscalData.findMany({
      where: {
        productId: { in: productIds },
      },
    });
  }

  /**
   * Get existing ProductFiscalData or create with company defaults.
   * Ensures every product always has fiscal data available for NF-e emission.
   *
   * @param productId - The product ID
   * @param companyId - The company ID (used to look up InvoicyConfig defaults)
   */
  async getOrCreateWithDefaults(productId: string, companyId: string) {
    // Check if ProductFiscalData already exists
    const existing = await this.prisma.productFiscalData.findUnique({
      where: { productId },
    });

    if (existing) return existing;

    // Get company's fiscal defaults from InvoicyConfig
    const config = await this.getCompanyFiscalDefaults(companyId);

    // Create with defaults
    const created = await this.prisma.productFiscalData.create({
      data: {
        product: { connect: { id: productId } },
        ncm: config.defaultNcm || '49119900',
        cfopInState: config.defaultCfop || '5101',
        cfopOutState: '6101',
        commercialUnit: 'UN',
        icmsOrigin: '0',
        icmsCst: '102',
        pisCst: '99',
        cofinsCst: '99',
      },
    });

    this.logger.log(
      `Created fiscal data with defaults for product ${productId} (NCM: ${created.ncm})`,
    );

    return created;
  }

  /**
   * Get company fiscal defaults from InvoicyConfig.
   * Returns whatever defaults are configured, falling back to nulls.
   */
  private async getCompanyFiscalDefaults(companyId: string): Promise<{
    defaultNcm: string | null;
    defaultCfop: string | null;
  }> {
    const config = await this.prisma.invoicyConfig.findFirst({
      where: { companyId, isDefault: true },
      select: { defaultNcm: true, defaultCfop: true },
    });

    if (!config) {
      // Fallback: try first config if no default is set
      const firstConfig = await this.prisma.invoicyConfig.findFirst({
        where: { companyId },
        orderBy: { createdAt: 'asc' },
        select: { defaultNcm: true, defaultCfop: true },
      });

      return {
        defaultNcm: firstConfig?.defaultNcm || null,
        defaultCfop: firstConfig?.defaultCfop || null,
      };
    }

    return {
      defaultNcm: config.defaultNcm || null,
      defaultCfop: config.defaultCfop || null,
    };
  }

  private mapDtoToData(
    dto: CreateProductFiscalDataDto | UpdateProductFiscalDataDto,
  ) {
    return {
      ncm: dto.ncm || null,
      cest: dto.cest || null,
      cean: dto.cean || null,
      productCode: dto.productCode || null,
      commercialUnit: dto.commercialUnit || null,
      icmsOrigin: dto.icmsOrigin || null,
      icmsCst: dto.icmsCst || null,
      icmsRate: dto.icmsRate ?? null,
      icmsCreditRate: dto.icmsCreditRate ?? null,
      icmsBaseModality: dto.icmsBaseModality || null,
      icmsReducao: dto.icmsReducao ?? null,
      pisCst: dto.pisCst || null,
      pisRate: dto.pisRate ?? null,
      cofinsCst: dto.cofinsCst || null,
      cofinsRate: dto.cofinsRate ?? null,
      ipiCst: dto.ipiCst || null,
      ipiRate: dto.ipiRate ?? null,
      ipiFramework: dto.ipiFramework || null,
      cfopInState: dto.cfopInState || null,
      cfopOutState: dto.cfopOutState || null,
      cfopExport: dto.cfopExport || null,
      codigoServico: dto.codigoServico || null,
      aliquotaIss: dto.aliquotaIss ?? null,
      discriminacao: dto.discriminacao || null,
      codTribMunicipio: dto.codTribMunicipio || null,
      cnae: dto.cnae || null,
      nbs: dto.nbs || null,
      codTribNacional: dto.codTribNacional || null,
      codClassificacao: dto.codClassificacao || null,
    };
  }
}
