import { Injectable } from '@nestjs/common';
import { CreateConditionDto } from './dto/create-condition.dto';
import { UpdateConditionDto } from './dto/update-condition.dto';
import { PrismaService } from 'nestjs-prisma';
import { ConditionFilterDto } from './dto/filter.dto';

@Injectable()
export class ConditionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateConditionDto) {
    try {
      const condition = {
        ...dto,
        operatorFeeRate: +dto.operatorFeeRate,
        operatorFeeTransfer: +dto.operatorFeeTransfer,
        minInstallments: +dto.minInstallments,
        maxInstallments: +dto.maxInstallments,
        installments: dto.installments
          ? dto.installments.map((installment) => ({
              installment: +installment.installment,
              operatorFeeRate: +installment.operatorFeeRate,
              operatorFeeTransfer: +installment.operatorFeeTransfer,
            }))
          : [],
      };

      return await this.prisma.paymentCondition.create({
        data: condition,
      });
    } catch (error) {
      console.error(error);
    }
  }

  async findAll(filter: ConditionFilterDto) {
    try {
      const where = {};

      if (filter.clientId) where['clientId'] = filter.clientId;
      if (filter.companyId) where['companyId'] = filter.companyId;

      const conditions = await this.prisma.paymentCondition.findMany({
        where,
        include: {
          company: {
            select: {
              id: true,
              name: true,
            },
          },
          paymentMethod: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        take: +filter.limit,
        skip: (+filter.page - 1) * +filter.limit,
      });

      // Agrupando as condições por método de pagamento
      const groupedByPaymentMethod: any = conditions.reduce(
        (acc, condition) => {
          const { paymentMethod } = condition;
          // Utiliza o ID do método de pagamento como chave para agrupar
          if (!acc[paymentMethod.id]) {
            acc[paymentMethod.id] = {
              paymentMethod,
              conditions: [],
            };
          }
          acc[paymentMethod.id].conditions.push(condition);

          return acc;
        },
        {},
      );

      // Convertendo o objeto agrupado para a estrutura de array desejada
      const result = Object.values(groupedByPaymentMethod).map(
        (group: any) => ({
          paymentMethod: group.paymentMethod,
          conditions: group.conditions.map(({ company, ...rest }) => ({
            ...rest,
            company,
          })),
        }),
      );

      return result;
    } catch (error) {
      console.error(error);
      throw new Error('Error fetching conditions');
    }
  }

  findOne(id: string) {
    return this.prisma.paymentCondition.findUnique({
      where: {
        id,
      },
    });
  }

  update(id: string, updateConditionDto: UpdateConditionDto) {
    return this.prisma.paymentCondition.update({
      where: {
        id,
      },
      data: {
        ...updateConditionDto,
        installments: updateConditionDto.installments.map((installment) => ({
          ...installment,
        })),
      },
    });
  }

  remove(id: string) {
    return this.prisma.paymentCondition.delete({
      where: {
        id,
      },
    });
  }
}
