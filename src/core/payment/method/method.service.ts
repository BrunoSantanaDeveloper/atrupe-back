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

  async findAll(filter) {
    try {
      const where = {
        companyId: filter.companyId,
        isActive: true,
      };

      const [total, data] = await Promise.all([
        this.prisma.paymentMethod.count({ where }),
        this.prisma.paymentMethod.findMany({
          where,
          take: +filter.limit,
          skip: ((+filter.page || 1) - 1) * +filter.limit,
          orderBy: {
            name: 'asc',
          },
        }),
      ]);
      return {
        total,
        lastPage: Math.ceil(total / +filter.limit),
        data,
      };
    } catch (error) {
      console.error(error);
      throw new Error('Error on find payment method');
    }
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
    return this.prisma.paymentMethod.update({
      where: {
        id,
      },
      data: {
        isActive: false,
      },
    });
  }
}
