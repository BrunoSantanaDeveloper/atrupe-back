import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import {
  CreateProductFiscalDataDto,
  UpdateProductFiscalDataDto,
} from './dtos/product-fiscal.dto';

@Injectable()
export class ProductFiscalService {
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

    if (existing) {
      // Se já existe, atualiza
      return this.prisma.productFiscalData.update({
        where: { productId: dto.productId },
        data: {
          ncm: dto.ncm,
          cest: dto.cest,
          cfop: dto.cfop,
          productCode: dto.productCode,
          commercialUnit: dto.commercialUnit,
          origem: dto.origem,
          icmsCst: dto.icmsCst,
          icmsAliquota: dto.icmsAliquota,
          icmsReducao: dto.icmsReducao,
          icmsCreditRate: dto.icmsCreditRate,
          icmsBaseModality: dto.icmsBaseModality,
          pisCst: dto.pisCst,
          pisAliquota: dto.pisAliquota,
          cofinsCst: dto.cofinsCst,
          cofinsAliquota: dto.cofinsAliquota,
          ipiCst: dto.ipiCst,
          ipiAliquota: dto.ipiAliquota,
          ipiFramework: dto.ipiFramework,
        },
      });
    }

    return this.prisma.productFiscalData.create({
      data: dto,
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

    return this.prisma.productFiscalData.update({
      where: { productId },
      data: dto,
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

    return this.prisma.productFiscalData.upsert({
      where: { productId: dto.productId },
      create: dto,
      update: {
        ncm: dto.ncm,
        cest: dto.cest,
        cfop: dto.cfop,
        productCode: dto.productCode,
        commercialUnit: dto.commercialUnit,
        origem: dto.origem,
        icmsCst: dto.icmsCst,
        icmsAliquota: dto.icmsAliquota,
        icmsReducao: dto.icmsReducao,
        icmsCreditRate: dto.icmsCreditRate,
        icmsBaseModality: dto.icmsBaseModality,
        pisCst: dto.pisCst,
        pisAliquota: dto.pisAliquota,
        cofinsCst: dto.cofinsCst,
        cofinsAliquota: dto.cofinsAliquota,
        ipiCst: dto.ipiCst,
        ipiAliquota: dto.ipiAliquota,
        ipiFramework: dto.ipiFramework,
      },
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
}
