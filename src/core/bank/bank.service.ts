import { Injectable } from '@nestjs/common';
import { CreateBankDto } from './dto/create-bank.dto';
import { UpdateBankDto } from './dto/update-bank.dto';
import { PrismaService } from 'nestjs-prisma';

@Injectable()
export class BankService {
  constructor(private readonly prisma: PrismaService) {}

  create(createBankDto: CreateBankDto) {
    return this.prisma.bank.create({
      data: {
        ...createBankDto,
      },
    });
  }

  findAll() {
    return this.prisma.bank.findMany({
      where: {
        isActive: true,
      },
      orderBy: {
        name: 'asc',
      },
    });
  }

  findOne(id: string) {
    return this.prisma.bank.findUnique({ where: { id } });
  }

  update(id: string, updateBankDto: UpdateBankDto) {
    return this.prisma.bank.update({ data: updateBankDto, where: { id } });
  }

  remove(id: string) {
    return this.prisma.bank.update({
      where: { id },
      data: {
        isActive: false,
      },
    });
  }
}
