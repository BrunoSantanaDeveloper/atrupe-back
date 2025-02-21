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
      data: createNatureDto,
    });
  }

  async findAll(filterDto: NatureFilterDto) {
    try {
      const { page, limit, level1, level2, search, companyId } = filterDto;
      const take = parseInt(limit, 10) || 10;

      // Mapeamento para o nome do level2
      const level2TitleMap: Record<string, string> = {
        '01': 'Administrativo',
        '02': 'Operacional',
        '03': 'Não operacional',
      };

      // Buscar subcategorias com informações das naturezas
      const subCategoryWhere: any = {
        // isActive: true,
        nature: {
          companyId,
          isActive: true,
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
      };

      const subCategories = await this.prisma.subCategory.findMany({
        where: subCategoryWhere,
        include: {
          nature: true,
        },
      });

      // Buscar naturezas que não possuem subcategorias
      const natureWhere: any = {
        companyId,
        // isActive: true,
        subCategory: {
          none: {
            // isActive: true,
            ...(search && {
              OR: [
                { description: { contains: search, mode: 'insensitive' } },
                { code: { contains: search, mode: 'insensitive' } },
              ],
            }),
          },
        },
        ...(level1 && { level1 }),
        ...(level2 && { level2 }),
        ...(search && {
          OR: [
            { description: { contains: search, mode: 'insensitive' } },
            { code: { contains: search, mode: 'insensitive' } },
          ],
        }),
      };

      const naturesWithoutSubCategories = await this.prisma.nature.findMany({
        where: natureWhere,
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
      naturesWithoutSubCategories.forEach((nature) => {
        if (!groupedByNature[nature.id]) {
          groupedByNature[nature.id] = {
            ...nature,
            subCategories: [],
          };
        }
      });

      // Agrupar por level2
      const groupedByLevel2 = Object.values(groupedByNature).reduce<
        Record<string, (Nature & { subCategories: SubCategory[] })[]>
      >((acc, nature) => {
        const level2Key = nature.level2 || 'undefined';
        if (!acc[level2Key]) {
          acc[level2Key] = [];
        }
        acc[level2Key].push(nature);
        return acc;
      }, {});

      // Converter para array e ordenar corretamente
      const groupedArray = Object.entries(groupedByLevel2)
        .map(([level2, natures]) => ({
          level2,
          natures: natures.sort((a, b) => {
            if (a.level1 !== b.level1) {
              return (a.level1 || '').localeCompare(b.level1 || '');
            }
            if (a.level2 !== b.level2) {
              return (a.level2 || '').localeCompare(b.level2 || '');
            }
            return a.code.localeCompare(b.code);
          }),
        }))
        .sort((a, b) => a.level2.localeCompare(b.level2));

      // Garantir que todos os level2 estejam presentes
      const allLevel2 = ['01', '02', '03']; // Define todos os códigos level2 possíveis
      allLevel2.forEach((level2) => {
        if (!groupedArray.some((group) => group.level2 === level2)) {
          groupedArray.push({
            level2,
            natures: [],
          });
        }
      });

      // Ordenar novamente para manter a ordem correta dos level2
      groupedArray.sort((a, b) => a.level2.localeCompare(b.level2));

      // Paginar grupos considerando a quantidade total de subcategorias
      const paginatedGroupedArray: typeof groupedArray = [];
      let subCategoryCount = 0;

      for (const group of groupedArray) {
        // Contar o número total de subcategorias dentro do grupo
        const groupSubCategoryCount = group.natures.reduce(
          (acc, nature) => acc + nature.subCategories.length,
          0,
        );

        // Verificar se ainda há espaço no take para incluir o grupo completo
        if (subCategoryCount + groupSubCategoryCount <= take) {
          paginatedGroupedArray.push(group);
          subCategoryCount += groupSubCategoryCount;
        } else {
          // Caso o grupo ultrapasse o limite, verificar individualmente as naturezas
          const remainingTake = take - subCategoryCount;
          const natures: typeof group.natures = [];
          let remainingSubCategoryCount = 0;

          for (const nature of group.natures) {
            const natureSubCategoryCount = nature.subCategories.length;

            // Incluir a natureza se ainda couber no take
            if (
              remainingSubCategoryCount + natureSubCategoryCount <=
              remainingTake
            ) {
              natures.push(nature);
              remainingSubCategoryCount += natureSubCategoryCount;
            } else {
              // Caso a natureza ultrapasse o limite, cortar as subcategorias
              const slicedSubCategories = nature.subCategories.slice(
                0,
                remainingTake - remainingSubCategoryCount,
              );

              natures.push({
                ...nature,
                subCategories: slicedSubCategories,
              });

              remainingSubCategoryCount = remainingTake; // Take completo
              break;
            }
          }

          // Adicionar o grupo parcial se houver naturezas válidas
          if (natures.length > 0) {
            paginatedGroupedArray.push({
              ...group,
              natures,
            });
          }
          break; // Atingiu o limite do take, interromper
        }
      }

      // Calcular o total de subcategorias para a paginação
      const totalSubCategories = groupedArray.reduce(
        (acc, group) =>
          acc +
          group.natures.reduce(
            (subAcc, nature) => subAcc + nature.subCategories.length,
            0,
          ),
        0,
      );

      // Reduzir os dados de acordo com o formato solicitado
      const result = paginatedGroupedArray.map((group) => ({
        name: `${level2TitleMap[group.level2] || 'Desconhecido'}`,
        code: group.level2,
        natures: group.natures.map((nature) => ({
          id: nature.id,
          description: nature.description,
          level1: nature.level1,
          level2: nature.level2,
          code: nature.code,
          isActive: nature.isActive,
          subCategories: nature.subCategories
            .sort((a, b) => a.code.localeCompare(b.code))
            .map((subCategory) => ({
              id: subCategory.id,
              description: subCategory.description,
              code: subCategory.code,
              isActive: subCategory.isActive,
            })),
        })),
      }));

      return {
        data: result,
        total: totalSubCategories,
        page: parseInt(page, 10) || 1,
        lastPage: Math.ceil(totalSubCategories / take),
      };
    } catch (error) {
      // Log the error for debugging
      console.error('Error in findAll:', error);

      // Throw a more specific error that can be handled by the controller
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
    if (updateNatureDto.code) {
      const sub = await this.prisma.nature.findFirst({
        where: {
          level1: nature.level1,
          level2: nature.level2,
          code: updateNatureDto.code,
          companyId: nature.companyId,
        },
      });

      if (sub) {
        throw new BadRequestException('Código já existe!');
      }
    }
    return await this.prisma.nature.update({
      where: { id },
      data: updateNatureDto,
    });
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
    try {
      return await this.prisma.subCategory.create({
        data: createSubCategoryDto,
      });
    } catch (error) {
      console.error(error);
    }
  }

  async findAllNatures(companyId: string) {
    return this.prisma.nature.findMany({
      where: { isActive: true, companyId },
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
      return await this.prisma.subCategory.update({
        where: { id: subCategory.id },
        data: { ...updateSubCategoryDto, natureId: nature.id },
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
