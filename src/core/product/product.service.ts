import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateProductDto } from './dto/create-product.dto';
import { PrismaService } from 'nestjs-prisma';
import { ProductFilterDTO } from './dto/filter.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createProductDto: CreateProductDto) {
    try {
      const items = createProductDto.items?.map((item) => ({
        name: item.name,
        unitOfMeasureId: item.unitOfMeasureId,
        unitCost: item.unitCost,
        salePrice: item.salePrice,
      }));

      // Criação do produto com tratamento para inserção condicional de itens
      const created = await this.prisma.product.create({
        data: {
          name: createProductDto.name,
          code: createProductDto.code,
          isActive: createProductDto.isActive,
          isStandard: createProductDto.isStandard,
          companyId: createProductDto.companyId || undefined,
          categoryId: createProductDto.categoryId || undefined,
          sectorId: createProductDto.sectorId || undefined,
          unitOfMeasureId: createProductDto.unitOfMeasureId || null,
          unitCost: createProductDto.unitCost || undefined,
          salePrice: createProductDto.salePrice || undefined,
          items: {
            create: items,
          },
        },
      });

      return this.findOne(created.id);
    } catch (error) {
      // Lança uma exceção se algo der errado durante a criação do produto
      throw new BadRequestException('Failed to create product', error.message);
    }
  }

  async findAll(filter: ProductFilterDTO) {
    try {
      let where = {};
      if (filter.companyId) {
        where = { ...where, companyId: filter.companyId };
      }

      if (filter.categoryId) {
        where = { ...where, categoryId: filter.categoryId };
      }

      if (filter.unitOfMeasureId) {
        where = { ...where, unitOfMeasureId: filter.unitOfMeasureId };
      }

      if (filter.sectorId) {
        where = { ...where, sectorId: filter.sectorId };
      }

      if (filter.isActive) {
        where = { ...where, isActive: filter.isActive === 'true' };
      }

      const products = await this.prisma.product.findMany({
        where: where,
        include: {
          items: true,
        },
        take: +filter.limit,
        skip: (+filter.page - 1) * +filter.limit,
      });

      return {
        data: products,
        total: await this.prisma.product.count({ where }),
      };
    } catch (e) {
      console.error(e);
      throw e;
    }
  }

  findOne(id: string) {
    return this.prisma.product.findUnique({
      where: { id },
      include: {
        items: true,
      },
    });
  }

  async update(id: string, updateProductDto: UpdateProductDto) {
    try {
      const product = await this.findOne(id);

      if (!product) {
        throw new BadRequestException('Product not found');
      }

      const items = updateProductDto.items?.map((item) => ({
        id: item.id,
        name: item.name,
        unitOfMeasureId: item.unitOfMeasureId,
        unitCost: item.unitCost,
        salePrice: item.salePrice,
      }));

      return this.prisma.product.update({
        where: { id },
        data: {
          name: updateProductDto.name,
          code: updateProductDto.code,
          isActive: updateProductDto.isActive,
          isStandard: updateProductDto.isStandard,
          companyId: updateProductDto.companyId || undefined,
          categoryId: updateProductDto.categoryId || undefined,
          sectorId: updateProductDto.sectorId || undefined,
          unitOfMeasureId: updateProductDto.unitOfMeasureId || null,
          unitCost: updateProductDto.unitCost || undefined,
          salePrice: updateProductDto.salePrice || undefined,
          items: {
            upsert: items?.map((item) => ({
              where: { id: item.id },
              create: item,
              update: item,
            })),
          },
        },
      });
    } catch (error) {
      throw new BadRequestException('Failed to update product', error.message);
    }
  }

  remove(id: string) {
    return this.prisma.product.delete({ where: { id } });
  }
}
