import { BadRequestException, Injectable } from '@nestjs/common';
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
        code: createNatureDto.code,
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
    const { page, limit, level1, level2, search, companyId } = filterDto;
    const take = parseInt(limit, 10) || 10;
    const skip = (parseInt(page, 10) - 1) * take || 0;

    // Mapeamento para o nome do level2
    const level2TitleMap: Record<string, string> = {
      '01': 'Administrativo',
      '02': 'Operacional',
      '03': 'Não operacional',
    };

    // Buscar subcategorias com informações das naturezas
    const subCategoryWhere: any = {
      isActive: true,
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
      isActive: true,
      subCategory: {
        none: {
          isActive: true,
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

    // Aplicar paginação
    const paginatedGroupedArray = groupedArray.slice(skip, skip + take);

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
        subCategories: nature.subCategories.map((subCategory) => ({
          id: subCategory.id,
          description: subCategory.description,
          code: subCategory.code,
          isActive: subCategory.isActive,
        })),
      })),
    }));

    return {
      data: result,
      total: groupedArray.length,
      page: parseInt(page, 10) || 1,
      lastPage: Math.ceil(groupedArray.length / take),
    };
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
    return this.prisma.nature.findUnique({
      where: { id },
    });
  }

  async update(id: string, updateNatureDto: UpdateNatureDto) {
    return this.prisma.nature.update({
      where: { id },
      data: updateNatureDto,
    });
  }

  async remove(id: string) {
    return this.prisma.nature.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async createSubCategory(createSubCategoryDto: CreateSubCategoryDto) {
    const sub = await this.prisma.subCategory.findFirst({
      where: {
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

  async findOneSubCategory(id: string) {
    return this.prisma.subCategory.findUnique({
      where: { id },
    });
  }

  async updateSubCategory(
    id: string,
    updateSubCategoryDto: UpdateSubCategoryDto,
  ) {
    return this.prisma.subCategory.update({
      where: { id },
      data: updateSubCategoryDto,
    });
  }

  async removeSubCategory(id: string) {
    return this.prisma.subCategory.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
