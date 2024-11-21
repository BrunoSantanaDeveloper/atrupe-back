import { Injectable } from '@nestjs/common';
import { CreatePayableDto } from './dto/create-payable.dto';
import { UpdatePayableDto } from './dto/update-payable.dto';
import { PrismaService } from 'nestjs-prisma';

@Injectable()
export class PayableService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePayableDto) {
    try {
      const payable = await this.prisma.payable.create({
        data: {
          ...dto,
          amount: parseFloat(dto.amount.toString()),
        },
      });

      return payable;
    } catch (error) {
      console.error(error);
      throw new Error('Error creating payable');
    }
  }

  async count() {
    return this.prisma.payable.count();
  }

  findAll() {
    return this.prisma.payable.findMany();
  }

  findOne(id: string) {
    return this.prisma.payable.findUnique({
      where: {
        id,
      },
    });
  }

  update(id: string, updatePayableDto: UpdatePayableDto) {
    return this.prisma.payable.update({
      where: {
        id,
      },
      data: {
        ...updatePayableDto,
      },
    });
  }

  remove(id: string) {
    return this.prisma.payable.delete({
      where: {
        id,
      },
    });
  }
}
