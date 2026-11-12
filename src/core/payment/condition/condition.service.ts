import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateConditionDto } from './dto/create-condition.dto';
import { UpdateConditionDto } from './dto/update-condition.dto';
import { PrismaService } from 'nestjs-prisma';
import { ConditionFilterDto } from './dto/filter.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class ConditionService {
  constructor(private readonly prisma: PrismaService) {}

  async findInUse(companyId: string) {
    try {
      const conditions = await this.prisma.paymentCondition.findMany({
        where: {
          companyId,
          OR: [
            {
              payableInstallments: {
                some: {},
              },
            },
            {
              receivableInstallments: {
                some: {},
              },
            },
          ],
        },
        include: {
          paymentMethod: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
          _count: {
            select: {
              payableInstallments: true,
              receivableInstallments: true,
            },
          },
        },
        orderBy: {
          name: 'asc',
        },
      });
      return conditions;
    } catch (error) {
      console.error(error);
      throw new Error('Error on find payment conditions in use');
    }
  }

  async findAvailable(companyId: string, type: string) {
    if (!type) {
      throw new BadRequestException('Type is required');
    }
    if (type !== 'receivable' && type !== 'payable') {
      throw new BadRequestException('Invalid type');
    }
    const typePayment = type === 'receivable' ? 'RECEIVABLE' : 'PAYABLE';

    const where: Prisma.PaymentConditionWhereInput = {
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
    };

    try {
      const conditions = await this.prisma.paymentCondition.findMany({
        where: where,
        include: {
          paymentMethod: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
        },
      });
      return conditions;
    } catch (error) {
      console.error(error);
      throw new Error('Error on find payment conditions');
    }
  }

  async findDownPayment(companyId: string) {
    try {
      const conditions = await this.prisma.paymentCondition.findMany({
        where: {
          companyId,
          OR: [
            {
              acceptInstallments: false,
              paymentMethod: {
                name: { not: 'Boleto' },
              },
            },
            {
              acceptInstallments: true,
              minInstallments: 1,
              maxInstallments: 1,
              paymentMethod: {
                name: { not: 'Boleto' },
              },
            },
          ],
        },
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

      const data = Object.values(groupedByPaymentMethod).map((group: any) => ({
        paymentMethod: group.paymentMethod,
        conditions: group.conditions.map(({ company, ...rest }) => ({
          ...rest,
          company,
        })),
      }));

      return { data };
    } catch (error) {
      console.error(error);
      throw new Error('Error fetching down payment conditions');
    }
  }

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
      if (filter.paymentMethodId)
        where['paymentMethodId'] = filter.paymentMethodId;
      if (filter.isActive !== undefined) where['isActive'] = filter.isActive;

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

      // Se grouped for true, agrupa por método de pagamento
      if (filter.grouped === true) {
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
      }

      // Comportamento padrão: lista simples
      return {
        total,
        lastPage,
        data: conditions,
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
      return await this.prisma.$transaction(async (tx) => {
        const updatedCondition = await tx.paymentCondition.update({
          where: { id },
          data: { isActive: false },
        });

        // Remover controles de caixa associados à condição desativada
        await tx.bankAccountCashControl.deleteMany({
          where: {
            paymentConditionId: updatedCondition.id,
          },
        });

        return updatedCondition;
      });
    } catch (error) {
      console.error(error);
      throw new Error('Error removing payment condition');
    }
  }
}
