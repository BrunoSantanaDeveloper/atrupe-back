import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateProductDto } from './dto/create-product.dto';
import { PrismaService } from 'nestjs-prisma';
import { ProductFilterDTO } from './dto/filter.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductStatus } from '@prisma/client';

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
        width: item.width || undefined,
        height: item.height || undefined,
        length: item.length || undefined,
        weight: item.weight || undefined,
        volume: item.volume || undefined,
        distance: item.distance || undefined,
        duration: item.duration || undefined,
      }));
      const productionStages = createProductDto.productionStages || [];
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
          technicalDescription:
            createProductDto.technicalDescription || undefined,
          allowEditDescription: createProductDto.allowEditDescription,
          allowEditValues: createProductDto.allowEditDescription,
          items: {
            create: items,
          },
          productionStages: JSON.parse(JSON.stringify(productionStages)),
        },
      });

      return this.findOne(created.id);
    } catch (error) {
      throw new BadRequestException('Failed to create product', error.message);
    }
  }

  async findAllQuantity(companyId: string) {
    const allStatuses: ProductStatus[] = ['ACTIVE', 'INACTIVE'];

    const result = await this.prisma.product.groupBy({
      by: ['status'],
      where: { companyId, status: { in: allStatuses } },
      _count: true,
    });

    const statusCount = allStatuses.reduce(
      (acc, status) => {
        acc[status] = 0;
        return acc;
      },
      {} as { [K in ProductStatus]: number },
    );

    result.forEach((cur) => {
      statusCount[cur.status] = cur._count;
    });

    const total = Object.values(statusCount).reduce((acc, cur) => acc + cur, 0);

    return {
      ...statusCount,
      TOTAL: total,
    };
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

      if (filter.status) {
        where = { ...where, status: filter.status };
      }

      if (filter.search) {
        where = {
          ...where,
          OR: [
            { name: { contains: filter.search, mode: 'insensitive' } },
            { code: { contains: filter.search, mode: 'insensitive' } },
            {
              technicalDescription: {
                contains: filter.search,
                mode: 'insensitive',
              },
            },
          ],
        };
      }

      const [total, products] = await Promise.all([
        this.prisma.product.count({ where }),
        this.prisma.product.findMany({
          where: where,
          select: {
            id: true,
            name: true,
            code: true,
            sector: {
              select: {
                name: true,
              },
            },
            items: {
              select: {
                unitCost: true,
                salePrice: true,
                unitOfMeasure: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
          take: +filter.limit,
          skip: (+filter.page - 1) * +filter.limit,
          orderBy: { name: 'asc' },
        }),
      ]);

      // Mapear os produtos para calcular os totais de unitCost e salePrice
      const data = products.map((product) => {
        const { id, name, code, sector, items } = product;

        // Calculando os totais
        const unitCost = items.reduce(
          (sum, item) => sum + (item.unitCost || 0),
          0,
        );
        const salePrice = items.reduce(
          (sum, item) => sum + (item.salePrice || 0),
          0,
        );

        return {
          id,
          name,
          code,
          sectorName: sector?.name || null,
          unitOfMeasureCode: 'UN',
          unitCost,
          salePrice,
        };
      });

      return {
        total,
        lastPage: Math.ceil(total / +filter.limit),
        data,
      };
    } catch (error) {
      console.error(error.message);
      throw error;
    }
  }

  findOne(id: string) {
    return this.prisma.product.findUnique({
      where: { id },
      include: {
        items: {
          orderBy: {
            name: 'asc',
          },
        },
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
        width: item.width || undefined,
        height: item.height || undefined,
        length: item.length || undefined,
        weight: item.weight || undefined,
        volume: item.volume || undefined,
        distance: item.distance || undefined,
        duration: item.duration || undefined,
      }));

      const productionStages = updateProductDto.productionStages || [];
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
          status: updateProductDto.status,
          technicalDescription:
            updateProductDto.technicalDescription || undefined,
          allowEditDescription: updateProductDto.allowEditDescription,
          allowEditValues: updateProductDto.allowEditDescription,
          items: {
            upsert: items?.map((item) => ({
              where: { id: item.id },
              create: item,
              update: item,
            })),
          },
          productionStages: JSON.parse(JSON.stringify(productionStages)), // Corrigido
        },
      });
    } catch (error) {
      throw new BadRequestException('Failed to update product', error.message);
    }
  }

  async remove(id: string) {
    try {
      const product = await this.findOne(id);
      if (!product) {
        throw new BadRequestException('Product not found');
      }
      return this.prisma.product.update({
        where: { id },
        data: {
          isActive: false,
        },
      });
    } catch (error) {
      throw new BadRequestException('Failed to delete product', error.message);
    }
  }

  async removeItem(id: string) {
    try {
      return this.prisma.productItem.delete({
        where: { id },
      });
    } catch (error) {
      throw new BadRequestException(
        'Failed to delete product item',
        error.message,
      );
    }
  }
}
