import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateScheduledExpenseDto } from './dto/create-scheduled-expense.dto';
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

  async findAll(companyId: string) {
    try {
      return await this.prisma.scheduledExpense.findMany({
        where: {
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
}
