import { Injectable } from '@nestjs/common';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CategoryFilterDTO } from './dto/filter.dto';
import { PrismaService } from 'nestjs-prisma';
import { BadRequestException } from '@nestjs/common';

@Injectable()
export class CategoryService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createCategoryDto: CreateCategoryDto) {
    try {
      return await this.prisma.category.create({ data: createCategoryDto });
    } catch (error) {
      console.log(error);
      throw new Error('Error on create category');
    }
  }

  async findAllQuantity(companyId: string) {
    const result = await this.prisma.category.groupBy({
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

  async findAllWithProducts(companyId: string) {
    return this.prisma.category.findMany({
      where: { companyId, products: { some: {} }, isActive: true },
    });
  }

  async findAllBySector(filter: CategoryFilterDTO): Promise<any> {
    const { page = 1, limit = 10 } = filter;
    let where = {};

    if (filter.companyId) {
      where = {
        ...where,
        company: { id: filter.companyId },
      };
    } else {
      where = {
        ...where,
        isStandard: true,
      };
    }

    if (filter.sectorId) {
      where = { ...where, sectorId: filter.sectorId };
    }
    if (filter.kind) {
      where = { ...where, kind: filter.kind };
    }
    if (filter.status) {
      where = { ...where, isActive: filter.status === 'ACTIVE' };
    }

    const [total, categories] = await Promise.all([
      this.prisma.category.count({ where }),
      this.prisma.category.findMany({
        where,
        orderBy: [{ sector: { name: 'asc' } }, { name: 'asc' }],
        take: +limit,
        skip: (+page - 1) * +limit,
        include: {
          sector: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
    ]);

    const groupedData = categories.reduce((acc, category) => {
      const sectorName = category.sector?.name || 'Sem Setor Definido';
      const sectorId = category.sector?.id || null;
      let sectorGroup = acc.find((group) => group.sector === sectorName);
      if (!sectorGroup) {
        sectorGroup = {
          sector: sectorName,
          sectorId: sectorId,
          groups: [],
        };
        acc.push(sectorGroup);
      }
      sectorGroup.groups.push(category);
      return acc;
    }, []);

    const lastPage = Math.ceil(total / +limit);

    return {
      total,
      lastPage,
      data: groupedData,
    };
  }

  async findAll(filter: CategoryFilterDTO): Promise<any> {
    const { page = 1, limit = 10 } = filter;
    let where = {};

    if (filter.companyId) {
      where = {
        ...where,
        company: { id: filter.companyId },
      };
    } else {
      where = {
        ...where,
        isStandard: true,
      };
    }

    if (filter.sectorId) {
      where = { ...where, sectorId: filter.sectorId };
    }

    if (filter.kind) {
      where = { ...where, kind: filter.kind };
    }
    if (filter.status) {
      if (filter.status === 'ACTIVE') {
        where = { ...where, isActive: true };
      } else if (filter.status === 'INACTIVE') {
        where = { ...where, isActive: false };
      }
    }
    const [total, data] = await Promise.all([
      this.prisma.category.count({
        where,
      }),
      this.prisma.category.findMany({
        where,

        take: +limit,
        skip: (+page - 1) * +limit,
      }),
    ]);
    const lastPage = Math.ceil(total / +limit);

    return {
      total,
      lastPage,
      data,
    };
  }

  findOne(id: string) {
    return this.prisma.category.findUnique({ where: { id } });
  }

  async update(id: string, updateCategoryDto: UpdateCategoryDto) {
    // Verificar se está tentando ativar uma categoria
    if (updateCategoryDto.isActive === true) {
      // Buscar a categoria atual para verificar se ela tem um setor associado
      const currentCategory = await this.prisma.category.findUnique({
        where: { id },
        include: {
          sector: {
            select: {
              id: true,
              isActive: true,
            },
          },
        },
      });

      if (!currentCategory) {
        throw new BadRequestException('Categoria não encontrada');
      }

      // Se a categoria tem um setor associado, verificar se o setor está ativo
      if (currentCategory.sectorId && currentCategory.sector) {
        if (!currentCategory.sector.isActive) {
          throw new BadRequestException(
            'Não é possível ativar uma categoria quando o setor está inativo',
          );
        }
      }
    }

    return this.prisma.category.update({
      data: updateCategoryDto,
      where: { id },
    });
  }

  remove(id: string) {
    return this.prisma.category.delete({ where: { id } });
  }
}
