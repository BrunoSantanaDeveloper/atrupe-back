import { Injectable } from '@nestjs/common';
import { CreateMethodDto } from './dto/create-method.dto';
import { UpdateMethodDto } from './dto/update-method.dto';
import { PrismaService } from 'nestjs-prisma';

@Injectable()
export class MethodService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateMethodDto) {
    return this.prisma.paymentMethod.create({
      data: {
        ...dto,
      },
    });
  }

  findAll() {
    return this.prisma.paymentMethod.findMany();
  }

  findOne(id: string) {
    return this.prisma.paymentMethod.findUnique({
      where: {
        id,
      },
    });
  }

  update(id: string, updateMethodDto: UpdateMethodDto) {
    return this.prisma.paymentMethod.update({
      where: {
        id,
      },
      data: {
        ...updateMethodDto,
      },
    });
  }

  remove(id: string) {
    return this.prisma.paymentMethod.delete({
      where: {
        id,
      },
    });
  }
}
