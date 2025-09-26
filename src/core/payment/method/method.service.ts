import { Injectable, BadRequestException } from '@nestjs/common';
import { CreateMethodDto } from './dto/create-method.dto';
import { UpdateMethodDto } from './dto/update-method.dto';
import { PrismaService } from 'nestjs-prisma';
import { Prisma } from '@prisma/client';

@Injectable()
export class MethodService {
  constructor(private readonly prisma: PrismaService) {}
  async findAvailable(companyId: string, type: string) {
    if (!type) {
      throw new BadRequestException('Type is required');
    }
    if (type !== 'receivable' && type !== 'payable') {
      throw new BadRequestException('Invalid type');
    }
    const typePayment = type === 'receivable' ? 'RECEIVABLE' : 'PAYABLE';
    if (typePayment !== 'RECEIVABLE' && typePayment !== 'PAYABLE') {
      throw new BadRequestException('Invalid type');
    }
    const where: Prisma.PaymentMethodWhereInput = {
      isActive: true,
      paymentCondition: {
        some: {
          companyId,
          isActive: true,
          bankAccountCashControls: {
            some: {
              ...(typePayment === 'RECEIVABLE' && { acceptIncomes: true }),
              ...(typePayment === 'PAYABLE' && { acceptPayments: true }),
              bankAccount: {
                isActive: true,
              },
            },
          },
        },
      },
    };

    try {
      const methods = await this.prisma.paymentMethod.findMany({
        where: where,
      });
      return methods;
    } catch (error) {
      console.error(error);
      throw new Error('Error on find payment method');
    }
  }
  async create(dto: CreateMethodDto) {
    // Verificar se o código já existe
    const existingMethod = await this.prisma.paymentMethod.findFirst({
      where: { code: dto.code },
    });

    if (existingMethod) {
      throw new BadRequestException(
        `Payment method with code '${dto.code}' already exists`,
      );
    }

    return this.prisma.paymentMethod.create({
      data: {
        ...dto,
      },
    });
  }

  async findAll(filter) {
    try {
      const where = {
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

  findByCode(code: string) {
    return this.prisma.paymentMethod.findUnique({
      where: {
        code,
      },
    });
  }

  async update(id: string, updateMethodDto: UpdateMethodDto) {
    // Se estiver tentando atualizar o código, verificar se não há conflito
    if (updateMethodDto.code) {
      const existingMethod = await this.prisma.paymentMethod.findFirst({
        where: {
          code: updateMethodDto.code,
          id: { not: id }, // Excluir o próprio registro
        },
      });

      if (existingMethod) {
        throw new BadRequestException(
          `Payment method with code '${updateMethodDto.code}' already exists`,
        );
      }
    }

    return this.prisma.paymentMethod.update({
      where: {
        id,
      },
      data: {
        ...updateMethodDto,
      },
    });
  }

  async findWithConditions(companyId: string) {
    try {
      const methods = await this.prisma.paymentMethod.findMany({
        where: {
          isActive: true,
          paymentCondition: {
            some: {
              companyId,
              isActive: true,
            },
          },
        },
        include: {
          _count: {
            select: {
              paymentCondition: {
                where: {
                  companyId,
                  isActive: true,
                },
              },
            },
          },
        },
        orderBy: {
          name: 'asc',
        },
      });
      return methods;
    } catch (error) {
      console.error(error);
      throw new Error('Error on find payment methods with conditions');
    }
  }

  async remove(id: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.paymentMethod.update({
          where: {
            id,
          },
          data: {
            isActive: false,
          },
        });

        return { message: 'Payment method removed successfully' };
      });
    } catch (error) {
      console.error(error);
      throw new BadRequestException('Error removing payment method');
    }
  }
}
