import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateConditionDto } from './dto/create-condition.dto';
import { UpdateConditionDto } from './dto/update-condition.dto';
import { PrismaService } from 'nestjs-prisma';
import { ConditionFilterDto } from './dto/filter.dto';

@Injectable()
export class ConditionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateConditionDto) {
    try {
      const { installments, ...conditionData } = dto;

      // Cria a condição de pagamento com as parcelas relacionadas
      const paymentCondition = await this.prisma.paymentCondition.create({
        data: {
          ...conditionData,
          minInstallments: +dto.minInstallments,
          maxInstallments: +dto.maxInstallments,
          installments: {
            create: installments.map((installment, index) => ({
              installment: index + 1,
              operatorFeeRate: +installment.operatorFeeRate,
              operatorFeeTransfer: +installment.operatorFeeTransfer,
            })),
          },
        },
        include: {
          installments: true,
        },
      });

      return paymentCondition;
    } catch (error) {
      console.error(error);
      throw new BadRequestException('You shall not pass!');
    }
  }

  async findAll(filter: ConditionFilterDto) {
    try {
      const where = {};

      if (filter.clientId) where['clientId'] = filter.clientId;
      if (filter.companyId) where['companyId'] = filter.companyId;

      // Obter o total de condições para paginação
      const total = await this.prisma.paymentCondition.count({
        where,
      });

      // Calcular o número da última página
      const limit = +filter.limit || 10; // Limite padrão de 10 se não for fornecido
      const page = +filter.page || 1; // Página padrão 1 se não for fornecida
      const lastPage = Math.ceil(total / limit);

      const conditions = await this.prisma.paymentCondition.findMany({
        where,
        include: {
          installments: true, // Inclui as parcelas
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
        take: limit,
        skip: (page - 1) * limit,
      });

      const groupedByPaymentMethod = conditions.reduce((acc, condition) => {
        const { paymentMethod } = condition;
        if (!acc[paymentMethod.id]) {
          acc[paymentMethod.id] = {
            paymentMethod,
            conditions: [],
          };
        }
        acc[paymentMethod.id].conditions.push(condition);
        return acc;
      }, {});

      const result = Object.values(groupedByPaymentMethod).map(
        (group: any) => ({
          paymentMethod: group.paymentMethod,
          conditions: group.conditions.map(({ company, ...rest }) => ({
            ...rest,
            company,
          })),
        }),
      );

      return {
        total,
        lastPage,
        data: result,
      };
    } catch (error) {
      console.error(error);
      throw new Error('Error fetching conditions');
    }
  }

  async findOne(id: string) {
    return this.prisma.paymentCondition.findUnique({
      where: {
        id,
      },
      include: {
        installments: true,
      },
    });
  }

  async update(id: string, dto: UpdateConditionDto) {
    try {
      const { installments, ...conditionData } = dto;

      // Atualiza a condição de pagamento
      const updatedCondition = await this.prisma.paymentCondition.update({
        where: { id },
        data: {
          ...conditionData,
          installments: {
            deleteMany: {},
            create: installments.map((installment, index) => ({
              installment: index + 1,
              operatorFeeRate: +installment.operatorFeeRate,
              operatorFeeTransfer: +installment.operatorFeeTransfer,
            })),
          },
        },
        include: {
          installments: true,
        },
      });

      return updatedCondition;
    } catch (error) {
      console.error(error);
      throw new Error('Error updating payment condition');
    }
  }

  async remove(id: string) {
    try {
      return await this.prisma.paymentCondition.update({
        where: { id },
        data: { isActive: false },
      });
    } catch (error) {
      console.error(error);
      throw new Error('Error removing payment condition');
    }
  }
}
