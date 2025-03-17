import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateNatureDto, CreateSubCategoryDto } from './dto/create-nature.dto';
import { UpdateNatureDto, UpdateSubCategoryDto } from './dto/update-nature.dto';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { NatureFilterDto } from './dto/nature-filter.dto';
import { Nature, SubCategory } from '@prisma/client';

@Injectable()
export class NatureService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createNatureDto: CreateNatureDto) {
    const sub = await this.prisma.nature.findFirst({
      where: {
        level1: createNatureDto.level1,
        level2: createNatureDto.level2,
        code: createNatureDto.code,
        companyId: createNatureDto.companyId,
      },
    });

    if (sub) {
      throw new BadRequestException('Código já existe!');
    }

    return await this.prisma.nature.create({
      data: {
        ...createNatureDto,
      },
    });
  }

  async findAll(filterDto: NatureFilterDto) {
    try {
      const { page, limit, level1, level2, search, status, companyId } =
        filterDto;
      const take = parseInt(limit, 10) || 10;

      // Mapeamento para o nome do level1
      const level1TitleMap: Record<string, string> = {
        '01': 'Receitas',
        '02': 'Despesas',
      };

      // Mapeamento para o nome do level2
      const level2TitleMap: Record<string, string> = {
        '01': 'Administrativo',
        '02': 'Operacional',
        '03': 'Não operacional',
      };

      // Buscar subcategorias com informações das naturezas
      const subCategories = await this.prisma.subCategory.findMany({
        where: {
          nature: {
            companyId,
            ...(level1 && { level1 }),
            ...(level2 && { level2 }),
            ...(search && {
              OR: [
                { description: { contains: search, mode: 'insensitive' } },
                { code: { contains: search, mode: 'insensitive' } },
              ],
            }),
          },
          ...(search && {
            OR: [
              { description: { contains: search, mode: 'insensitive' } },
              { code: { contains: search, mode: 'insensitive' } },
            ],
          }),
        },
        include: {
          nature: true,
        },
      });

      // Buscar naturezas
      const natures = await this.prisma.nature.findMany({
        where: {
          companyId,
          ...(status === 'ACTIVES' || !status ? { isActive: true } : {}),
          ...(level1 && { level1 }),
          ...(level2 && { level2 }),
          ...(search && {
            OR: [
              { description: { contains: search, mode: 'insensitive' } },
              { code: { contains: search, mode: 'insensitive' } },
            ],
          }),
        },
      });

      // Agrupar subcategorias por natureza
      const groupedByNature = subCategories.reduce<
        Record<number, Nature & { subCategories: SubCategory[] }>
      >((acc, subCategory) => {
        const natureId = subCategory.nature.id;
        if (!acc[natureId]) {
          acc[natureId] = {
            ...subCategory.nature,
            subCategories: [],
          };
        }
        acc[natureId].subCategories.push({
          id: subCategory.id,
          description: subCategory.description,
          code: subCategory.code,
          isActive: subCategory.isActive,
        });
        return acc;
      }, {});

      // Adicionar naturezas sem subcategorias
      natures.forEach((nature) => {
        if (!groupedByNature[nature.id]) {
          groupedByNature[nature.id] = {
            ...nature,
            subCategories: [],
          };
        }
      });

      // Filtrar naturezas conforme a nova regra
      const filteredNatures = Object.values(groupedByNature).filter(
        (nature) => {
          // Se for filtro de ativos ou não houver filtro, inclui todas as naturezas
          if (status === 'ACTIVES' || !status) {
            return true;
          }

          // Se não houver subcategorias, não incluir a natureza
          if (nature.subCategories.length === 0) {
            return false;
          }

          // Filtrar subcategorias baseado no status
          const filteredSubCategories = nature.subCategories.filter((sub) => {
            if (status === 'ACTIVES' || !status) {
              return sub.isActive;
            }
            if (status === 'INACTIVES') {
              return !sub.isActive;
            }
            return true;
          });

          // Só incluir a natureza se tiver subcategorias após o filtro
          return filteredSubCategories.length > 0;
        },
      );

      // Filtrar subcategorias conforme status
      filteredNatures.forEach((nature) => {
        if (status === 'ACTIVES' || !status) {
          nature.subCategories = nature.subCategories.filter(
            (sub) => sub.isActive,
          );
        } else if (status === 'INACTIVES') {
          nature.subCategories = nature.subCategories.filter(
            (sub) => !sub.isActive,
          );
        }
      });

      // Agrupar por level2
      const groupedByLevel2 = Object.keys(level2TitleMap).reduce<
        Record<string, (Nature & { subCategories: SubCategory[] })[]>
      >((acc, level2Key) => {
        acc[level2Key] = filteredNatures.filter(
          (nature) => nature.level2 === level2Key,
        );
        return acc;
      }, {});

      // Converter level2 para array e garantir que todos os level2 existam
      const level2Array = Object.entries(level2TitleMap)
        .map(([level2, name]) => ({
          name,
          code: level2,
          natures: groupedByLevel2[level2] || [],
        }))
        // Se houver filtro de level2, remove os arrays vazios apenas se não for ACTIVES
        .filter(
          (group) =>
            !level2 ||
            group.natures.length > 0 ||
            status === 'ACTIVES' ||
            !status,
        );

      // Agrupar level2 por level1
      const groupedByLevel1 = Object.keys(level1TitleMap).reduce<
        Record<string, typeof level2Array>
      >((acc, level1Key) => {
        acc[level1Key] = level2Array
          .map((level2Group) => ({
            ...level2Group,
            natures: level2Group.natures.filter(
              (nature) => nature.level1 === level1Key,
            ),
          }))
          // Se houver filtro de level1, remove os arrays vazios apenas se não for ACTIVES
          .filter(
            (group) =>
              group.natures.length > 0 || status === 'ACTIVES' || !status,
          );
        return acc;
      }, {});

      // Converter para array final com level1
      const finalArray = Object.entries(level1TitleMap)
        .map(([level1, name]) => ({
          name,
          code: level1,
          level2: groupedByLevel1[level1] || [],
        }))
        // Se houver filtro de level1, remove os arrays vazios apenas se não for ACTIVES
        .filter(
          (group) =>
            !level1 ||
            group.level2.length > 0 ||
            status === 'ACTIVES' ||
            !status,
        );

      return {
        data: finalArray,
        total: filteredNatures.length,
        page: parseInt(page, 10) || 1,
        lastPage: Math.ceil(filteredNatures.length / take),
      };
    } catch (error) {
      console.error('Error in findAll:', error);
      throw new Error('Failed to fetch nature data: ' + error.message);
    }
  }

  async findAllQuantity(companyId: string) {
    const result = await this.prisma.subCategory.groupBy({
      by: ['isActive'],
      where: { companyId },
      _count: true,
    });

    // Inicializa os contadores com zero
    const statusCount = {
      actives: 0,
      inactives: 0,
    };

    // Mapeia os resultados para os contadores
    result.forEach((cur) => {
      if (cur.isActive) {
        statusCount.actives = cur._count;
      } else {
        statusCount.inactives = cur._count;
      }
    });

    // Calcula o total
    const total = statusCount.actives + statusCount.inactives;

    return {
      ACTIVES: statusCount.actives,
      INACTIVES: statusCount.inactives,
      TOTAL: total,
    };
  }

  async findOne(id: string) {
    return await this.prisma.nature.findUnique({
      where: { id },
    });
  }

  async update(id: string, updateNatureDto: UpdateNatureDto) {
    const nature = await this.prisma.nature.findUnique({
      where: { id },
    });
    if (!nature) {
      throw new NotFoundException('Natureza não encontrada!');
    }
    if (updateNatureDto.code && updateNatureDto.code !== nature.code) {
      const sub = await this.prisma.nature.findFirst({
        where: {
          level1: nature.level1,
          level2: nature.level2,
          code: updateNatureDto.code,
          companyId: nature.companyId,
        },
        include: {
          subCategory: true,
        },
      });

      if (sub) {
        throw new BadRequestException('Código já existe!');
      }
    }
    const data: any = {
      ...updateNatureDto,
    };
    try {
      if (
        updateNatureDto.hasOwnProperty('isActive') &&
        typeof updateNatureDto.isActive === 'boolean'
      ) {
        await this.prisma.subCategory.updateMany({
          where: { natureId: nature.id },
          data: { isActive: updateNatureDto.isActive },
        });

        delete updateNatureDto.isActive;
      }

      return await this.prisma.nature.update({
        where: { id },
        data: data,
      });
    } catch (error) {
      console.log('error: ', error);
    }
  }

  async remove(id: string) {
    try {
      const nature = await this.prisma.nature.findUnique({
        where: { id },
      });

      if (!nature) {
        throw new NotFoundException('Natureza não encontrada!');
      }

      await this.prisma.$transaction(async (prisma) => {
        await prisma.subCategory.updateMany({
          where: {
            natureId: nature.id,
          },
          data: { isActive: false },
        });

        await prisma.nature.update({
          where: { id },
          data: { isActive: false },
        });
      });
    } catch (error) {
      throw new BadRequestException(
        error.message || 'Erro ao remover a natureza!',
      );
    }
  }

  async createSubCategory(createSubCategoryDto: CreateSubCategoryDto) {
    const sub = await this.prisma.subCategory.findFirst({
      where: {
        nature: {
          id: createSubCategoryDto.natureId,
        },
        code: createSubCategoryDto.code,
      },
    });

    if (sub) {
      throw new BadRequestException('Código já existe!');
    }
    const data = {
      ...createSubCategoryDto,
    };
    try {
      return await this.prisma.subCategory.create({
        data,
      });
    } catch (error) {
      console.error(error);
    }
  }

  async findAllNatures(companyId: string, level1: string) {
    const lvl1 = level1 === 'receivable' ? '01' : '02';
    return this.prisma.nature.findMany({
      where: { isActive: true, companyId, level1: lvl1 },
      select: {
        id: true,
        code: true,
        description: true,
      },
      orderBy: {
        code: 'asc',
      },
    });
  }

  async findAllSubCategoryByNature(natureId: string) {
    return await this.prisma.subCategory.findMany({
      where: { isActive: true, natureId },
      select: {
        id: true,
        code: true,
        description: true,
      },
      orderBy: {
        code: 'asc',
      },
    });
  }

  async findOneSubCategory(id: string) {
    return this.prisma.subCategory.findUnique({
      where: { id },
    });
  }

  async updateSubCategory(
    id: string,
    updateSubCategoryDto: UpdateSubCategoryDto,
    companyId: string,
  ) {
    try {
      const subCategory = await this.prisma.subCategory.findFirst({
        where: { id },
      });

      const nature = await this.prisma.nature.findFirst({
        where: {
          code: updateSubCategoryDto.level3,
          companyId: companyId,
        },
      });
      if (!nature) {
        throw new NotFoundException('Natureza nao encontrada');
      }
      if (!subCategory) {
        throw new NotFoundException('Subcategoria nao encontrada');
      }

      if (updateSubCategoryDto.code) {
        const sub = await this.prisma.subCategory.findFirst({
          where: {
            nature: {
              id: nature.id,
            },
            code: updateSubCategoryDto.code,
          },
        });

        if (sub) {
          throw new BadRequestException('Código já existe!');
        }
      }
      if (updateSubCategoryDto.level3) {
        delete updateSubCategoryDto.level3;
      }

      const data: any = {
        ...updateSubCategoryDto,
      };
      return await this.prisma.subCategory.update({
        where: { id: subCategory.id },
        data,
      });
    } catch (error) {
      // If error is already a known exception (NotFoundException or BadRequestException), rethrow it
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      // Log the error for debugging
      console.error('Error in updateSubCategory:', error);

      // Throw a generic error for unexpected cases
      throw new Error('Failed to update subcategory: ' + error.message);
    }
  }

  async removeSubCategory(id: string) {
    return this.prisma.subCategory.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
