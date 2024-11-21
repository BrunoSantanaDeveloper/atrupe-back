import { Injectable } from '@nestjs/common';
import { CreateCashControlDto } from './dto/create-cash-control.dto';
import { UpdateCashControlDto } from './dto/update-cash-control.dto';
import { PrismaService } from 'nestjs-prisma';

@Injectable()
export class CashControlService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateCashControlDto) {
    return this.prisma.cashControl.create({
      data: {
        ...dto,
      },
    });
  }

  findAll() {
    return this.prisma.cashControl.findMany();
  }

  findOne(id: string) {
    return this.prisma.cashControl.findUnique({
      where: {
        id,
      },
    });
  }

  update(id: string, updateCashControlDto: UpdateCashControlDto) {
    return this.prisma.cashControl.update({
      where: {
        id,
      },
      data: {
        ...updateCashControlDto,
      },
    });
  }

  remove(id: string) {
    return this.prisma.cashControl.delete({
      where: {
        id,
      },
    });
  }
}
