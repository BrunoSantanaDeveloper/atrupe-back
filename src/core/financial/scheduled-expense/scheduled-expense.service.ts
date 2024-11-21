import { Injectable } from '@nestjs/common';
import { CreateScheduledExpenseDto } from './dto/create-scheduled-expense.dto';
import { UpdateScheduledExpenseDto } from './dto/update-scheduled-expense.dto';
import { PrismaService } from 'nestjs-prisma';

@Injectable()
export class ScheduledExpenseService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateScheduledExpenseDto) {
    return this.prisma.scheduledExpense.create({
      data: {
        ...dto,
      },
    });
  }

  findAll() {
    return this.prisma.scheduledExpense.findMany();
  }

  findOne(id: string) {
    return this.prisma.scheduledExpense.findUnique({
      where: {
        id,
      },
    });
  }

  update(id: string, updateScheduledExpenseDto: UpdateScheduledExpenseDto) {
    return this.prisma.scheduledExpense.update({
      where: {
        id,
      },
      data: {
        ...updateScheduledExpenseDto,
      },
    });
  }

  remove(id: string) {
    return this.prisma.scheduledExpense.delete({
      where: {
        id,
      },
    });
  }
}
