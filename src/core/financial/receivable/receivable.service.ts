import { Injectable } from '@nestjs/common';
import { CreateReceivableDto } from './dto/create-receivable.dto';
import { UpdateReceivableDto } from './dto/update-receivable.dto';
import { PrismaService } from 'nestjs-prisma';

@Injectable()
export class ReceivableService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateReceivableDto) {
    try {
      return await this.prisma.receivable.create({
        data: {
          ...dto,
          amount: parseFloat(dto.amount.toString()),
        },
      });
    } catch (error) {
      console.error(error);
      throw error;
    }
  }

  async count() {
    return this.prisma.receivable.count();
  }

  findAll() {
    return this.prisma.receivable.findMany();
  }

  findOne(id: string) {
    return this.prisma.receivable.findUnique({
      where: {
        id,
      },
    });
  }

  update(id: string, updateReceivableDto: UpdateReceivableDto) {
    return this.prisma.receivable.update({
      where: {
        id,
      },
      data: {
        ...updateReceivableDto,
      },
    });
  }

  remove(id: string) {
    return this.prisma.receivable.delete({
      where: {
        id,
      },
    });
  }
}
