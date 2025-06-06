import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CreateScheduledExpenseDto,
  ScheduledExpenseFilterDto,
} from './dto/create-scheduled-expense.dto';
import { UpdateScheduledExpenseDto } from './dto/update-scheduled-expense.dto';
import { PrismaService } from 'nestjs-prisma';

@Injectable()
export class ScheduledExpenseService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateScheduledExpenseDto, companyId: string) {
    try {
      return await this.prisma.scheduledExpense.create({
        data: {
          amount: dto.amount,
          description: dto.description,
          dueDay: dto.dueDay,
          recurringType: dto.recurringType,
          supplierId: dto.supplierId,
          categoryId: dto.categoryId,
          subCategoryId: dto.subCategoryId,
          isActive: dto.isActive ?? true,
          companyId,
        },
        include: {
          supplier: true,
          company: true,
          subCategory: true,
        },
      });
    } catch (error) {
      throw new BadRequestException(
        `Error creating scheduled expense: ${error.message}`,
      );
    }
  }

  async findAll(filter: ScheduledExpenseFilterDto, companyId: string) {
    try {
      const {
        page = 1,
        limit = 10,
        search,
        supplierId,
        categoryId,
        recurringType,
      } = filter;

      const where: any = {
        companyId,
      };

      // Filtro de busca por descrição
      if (search) {
        where.description = {
          contains: search,
          mode: 'insensitive',
        };
      }

      // Filtro por fornecedor
      if (supplierId) {
        where.supplierId = supplierId;
      }

      // Filtro por categoria
      if (categoryId) {
        where.categoryId = categoryId;
      }

      // Filtro por tipo de recorrência
      if (recurringType) {
        where.recurringType = recurringType;
      }

      const [total, data] = await Promise.all([
        this.prisma.scheduledExpense.count({ where }),
        this.prisma.scheduledExpense.findMany({
          where,
          include: {
            supplier: true,
            company: true,
            subCategory: true,
          },
          take: +limit,
          skip: (+page - 1) * +limit,
          orderBy: { description: 'asc' },
        }),
      ]);

      return {
        total,
        totalPages: Math.ceil(total / +limit),
        data,
      };
    } catch (error) {
      throw new BadRequestException(
        `Error finding scheduled expenses: ${error.message}`,
      );
    }
  }

  async findOne(id: string, companyId: string) {
    try {
      const expense = await this.prisma.scheduledExpense.findFirst({
        where: {
          id,
          companyId,
        },
        include: {
          supplier: true,
          company: true,
          subCategory: true,
        },
      });

      if (!expense) {
        throw new NotFoundException(
          `Scheduled expense with ID ${id} not found`,
        );
      }

      return expense;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(
        `Error finding scheduled expense: ${error.message}`,
      );
    }
  }

  async update(id: string, dto: UpdateScheduledExpenseDto, companyId: string) {
    try {
      const expense = await this.findOne(id, companyId);

      return await this.prisma.scheduledExpense.update({
        where: {
          id: expense.id,
        },
        data: {
          amount: dto.amount,
          description: dto.description,
          dueDay: dto.dueDay,
          recurringType: dto.recurringType,
          supplierId: dto.supplierId,
          categoryId: dto.categoryId,
          subCategoryId: dto.subCategoryId,
          isActive: dto.isActive,
        },
        include: {
          supplier: true,
          company: true,
          subCategory: true,
        },
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(
        `Error updating scheduled expense: ${error.message}`,
      );
    }
  }

  async remove(id: string, companyId: string) {
    try {
      const expense = await this.findOne(id, companyId);

      return await this.prisma.scheduledExpense.delete({
        where: {
          id: expense.id,
        },
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(
        `Error removing scheduled expense: ${error.message}`,
      );
    }
  }

  async count(companyId: string) {
    try {
      const allStatuses = ['ACTIVE', 'INACTIVE'];

      const result = await this.prisma.scheduledExpense.groupBy({
        by: ['isActive'],
        where: { companyId },
        _count: true,
      });

      const statusCount = allStatuses.reduce(
        (acc, status) => {
          acc[status] = 0;
          return acc;
        },
        {} as { [key: string]: number },
      );

      result.forEach((cur) => {
        const status = cur.isActive ? 'ACTIVE' : 'INACTIVE';
        statusCount[status] = cur._count;
      });

      const total = Object.values(statusCount).reduce(
        (acc, cur) => acc + cur,
        0,
      );

      return {
        ...statusCount,
        TOTAL: total,
      };
    } catch (error) {
      throw new BadRequestException(
        `Error counting scheduled expenses: ${error.message}`,
      );
    }
  }
}
