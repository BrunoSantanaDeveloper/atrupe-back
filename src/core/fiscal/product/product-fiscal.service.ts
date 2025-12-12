import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';

export interface ProductFiscalDataDto {
  productCode?: string;
  commercialUnit?: string;
  ncm?: string;
  cean?: string;
  icmsOrigin?: string;
  icmsCst?: string;
  icmsRate?: number;
  icmsCreditRate?: number;
  icmsBaseModality?: string;
  pisCst?: string;
  pisRate?: number;
  cofinsCst?: string;
  cofinsRate?: number;
  ipiFramework?: string;
  ipiCst?: string;
  ipiRate?: number;
  cfopInState?: string;
  cfopOutState?: string;
  cfopExport?: string;
}

@Injectable()
export class ProductFiscalService {
  constructor(private prisma: PrismaService) {}

  async findByProductId(productId: string, companyId: string) {
    // Verify product belongs to company
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        companyId,
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const fiscalData = await this.prisma.productFiscalData.findUnique({
      where: { productId },
    });

    return fiscalData;
  }

  async upsert(productId: string, companyId: string, dto: ProductFiscalDataDto) {
    // Verify product belongs to company
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        companyId,
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const existingData = await this.prisma.productFiscalData.findUnique({
      where: { productId },
    });

    if (existingData) {
      return this.prisma.productFiscalData.update({
        where: { productId },
        data: dto,
      });
    }

    return this.prisma.productFiscalData.create({
      data: {
        productId,
        ...dto,
      },
    });
  }

  async delete(productId: string, companyId: string) {
    // Verify product belongs to company
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        companyId,
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return this.prisma.productFiscalData.delete({
      where: { productId },
    });
  }
}
