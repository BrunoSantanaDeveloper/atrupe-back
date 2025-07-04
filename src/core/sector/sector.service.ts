import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateSectorDto } from './dto/create-sector.dto';
import { UpdateSectorDto } from './dto/update-sector.dto';
import { PrismaService } from 'nestjs-prisma';
import { SectorFilterDto } from './dto/filter.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class SectorService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createSectorDto: CreateSectorDto) {
    const company = await this.prisma.company.findUnique({
      where: { id: createSectorDto.companyId },
    });

    if (!company) {
      throw new NotFoundException('Company not found');
    }

    return this.prisma.companySector.create({
      data: {
        ...createSectorDto,
      },
    });
  }

  async findAllWithProducts(companyId: string) {
    return this.prisma.companySector.findMany({
      where: {
        isActive: true,
        isSystem: false,
        companyId: companyId,
        product: {
          some: {}, // Garante que só retorna setores que possuem pelo menos um produto cadastrado
        },
      },
      select: {
        id: true,
        name: true,
        icon: true,
      },
    });
  }

  async findAll(filter: SectorFilterDto) {
    try {
      let where: Prisma.CompanySectorWhereInput = { isSystem: false };

      if (filter.companyId) {
        where = { ...where, companyId: filter.companyId };
      }

      if (filter.isProductionStage !== undefined) {
        where = { ...where, isProductionStage: filter.isProductionStage };
      }
      const [total, sectors] = await this.prisma.$transaction([
        this.prisma.companySector.count({ where }),
        this.prisma.companySector.findMany({
          where: where,
          take: +filter.limit,
          skip: (+filter.page - 1) * +filter.limit,
          orderBy: [
            {
              kind: 'asc',
            },
            {
              isActive: 'desc', // true (1) vem antes de false (0)
            },
            {
              name: 'asc',
            },
          ],
        }),
      ]);

      return {
        total,
        lastPage: Math.ceil(total / +filter.limit),
        data: sectors,
      };
    } catch (e) {
      console.error(e);
      throw e;
    }
  }

  findOne(id: string) {
    return this.prisma.companySector.findFirst({ where: { id: id } });
  }

  async update(id: string, updateSectorDto: UpdateSectorDto) {
    // Só processa se o updateSectorDto.isActive for explicitamente false
    if (updateSectorDto !== undefined && updateSectorDto.isActive === false) {
      const json = [{ id: id, isActive: true }];
      const products = await this.prisma.product.findMany({
        where: {
          productionStages: {
            array_contains: json,
          },
        },
      });

      // Sai do if se não encontrar produtos
      if (products.length === 0) {
        // Inativar categorias relacionadas ao setor quando o setor for inativado
        await this.prisma.category.updateMany({
          where: {
            sectorId: id,
            isActive: true, // Só inativa categorias que estão ativas
          },
          data: {
            isActive: false,
          },
        });

        return await this.prisma.companySector.update({
          where: { id: id },
          data: updateSectorDto,
        });
      }

      for (const product of products) {
        let stages = product.productionStages as any;

        if (typeof stages === 'string') {
          stages = JSON.parse(stages);
        }

        if (Array.isArray(stages)) {
          // Removendo o objeto do array
          const updatedStages = stages.filter((stage) => stage.id !== id);

          // Atualizando no banco com a nova lista sem o id removido
          await this.prisma.product.update({
            where: { id: product.id },
            data: {
              productionStages: updatedStages as any,
            },
          });
        }
      }

      // Inativar categorias relacionadas ao setor quando o setor for inativado
      await this.prisma.category.updateMany({
        where: {
          sectorId: id,
          isActive: true, // Só inativa categorias que estão ativas
        },
        data: {
          isActive: false,
        },
      });
    }

    return await this.prisma.companySector.update({
      where: { id: id },
      data: updateSectorDto,
    });
  }

  async remove(id: string) {
    // Inativar categorias relacionadas ao setor quando o setor for removido
    await this.prisma.category.updateMany({
      where: {
        sectorId: id,
        isActive: true, // Só inativa categorias que estão ativas
      },
      data: {
        isActive: false,
      },
    });

    return this.prisma.companySector.update({
      where: { id: id },
      data: { isActive: false },
    });
  }
}
