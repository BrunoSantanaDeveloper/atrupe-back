import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import {
  CreateProductFiscalDataDto,
  UpdateProductFiscalDataDto,
} from './dtos/product-fiscal.dto';

@Injectable()
export class ProductFiscalService {
  constructor(private readonly prisma: PrismaService) { }

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
    };
  }
}
