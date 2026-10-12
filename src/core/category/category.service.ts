import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CategoryFilterDTO } from './dto/filter.dto';
import { PrismaService } from 'nestjs-prisma';
import { BadRequestException } from '@nestjs/common';

const CATEGORY_NOT_FOUND = 'Categoria não encontrada.';

@Injectable()
export class CategoryService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createCategoryDto: CreateCategoryDto) {
    await this.assertSectorOfCompany(
      createCategoryDto.sectorId,
      createCategoryDto.companyId,
    );

    try {
      return await this.prisma.category.create({ data: createCategoryDto });
    } catch (error) {
      console.log(error);
      throw new Error('Error on create category');
    }
  }

  async findAllQuantity(filter: CategoryFilterDTO) {
    let where: any = { companyId: filter.companyId };

    if (filter.kind) {
      where = { ...where, kind: filter.kind };
    }

    const result = await this.prisma.category.groupBy({
      by: ['isActive'],
      where,
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
        OR: [{ company: { id: filter.companyId } }, { isStandard: true }],
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
      let sectorGroup = acc.find((group) => group.sectorId === sectorId);
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
        OR: [{ company: { id: filter.companyId } }, { isStandard: true }],
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

  /**
   * Leitura por id: categoria da empresa ou padrão do sistema, as mesmas que
   * as listas mostram. A de outra empresa responde 404, como um id que não
   * existe.
   */
  async findOne(id: string, companyId: string) {
    const category = await this.prisma.category.findFirst({
      where: { id, OR: [{ companyId }, { isStandard: true }] },
    });

    if (!category) {
      throw new NotFoundException(CATEGORY_NOT_FOUND);
    }

    return category;
  }

  /**
   * A categoria que a empresa pode alterar ou excluir: a dela. A padrão do
   * sistema aparece para todas as empresas, e mudar uma muda a de todas.
   */
  async findOwn(id: string, companyId: string) {
    const category = await this.findOne(id, companyId);

    if (category.isStandard || category.companyId !== companyId) {
      throw new UnprocessableEntityException({
        code: 'STANDARD_CATEGORY',
        message:
          'Este grupo é padrão do sistema e não pode ser alterado nem excluído.',
      });
    }

    return category;
  }

  async update(
    id: string,
    companyId: string,
    updateCategoryDto: UpdateCategoryDto,
  ) {
    await this.findOwn(id, companyId);
    await this.assertSectorOfCompany(updateCategoryDto.sectorId, companyId);

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

  async remove(id: string, companyId: string) {
    await this.findOwn(id, companyId);

    const productsUsingCategory = await this.prisma.product.count({
      where: { categoryId: id },
    });

    const scheduledExpensesUsingCategory =
      await this.prisma.scheduledExpense.count({
        where: { categoryId: id },
      });

    const clientsUsingCategory = await this.prisma.client.count({
      where: { categoryId: id },
    });

    const suppliersUsingCategory = await this.prisma.supplier.count({
      where: { categoryId: id },
    });

    if (
      productsUsingCategory > 0 ||
      scheduledExpensesUsingCategory > 0 ||
      clientsUsingCategory > 0 ||
      suppliersUsingCategory > 0
    ) {
      throw new BadRequestException('Não é possível excluir um grupo em uso');
    }

    return this.prisma.category.delete({ where: { id } });
  }

  /** O setor do grupo é da mesma empresa. */
  private async assertSectorOfCompany(
    sectorId: string | null | undefined,
    companyId: string,
  ) {
    if (!sectorId) return;

    const sector = await this.prisma.companySector.findFirst({
      where: { id: sectorId, companyId },
      select: { id: true },
    });
    if (!sector) {
      throw new NotFoundException('Setor não encontrado.');
    }
  }
}
