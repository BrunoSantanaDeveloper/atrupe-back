import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CreatePayableDto,
  UpdatePayableInstallmentsDto,
} from './dto/create-payable.dto';
import {
  CancelPayableDto,
  PayInstallmentDto,
  UpdatePayableDto,
} from './dto/update-payable.dto';
import { PrismaService } from 'nestjs-prisma';
import { PaymentStatus, TransactionType } from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReceivableFilterDto } from '../receivable/dto/receivable-filter.dto';
import { endOfDay, startOfDay } from 'date-fns';

@Injectable()
export class PayableService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePayableDto) {
    const { installments, ...payableData } = dto;
    const currentDate = new Date();
    if (installments.length === 0) {
      throw new Error('At least one installment is required.');
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const totalAmount = installments
          .reduce((sum, installment) => {
            const additionalFee = installment.additionalFee ?? 0;
            return sum + installment.amount + additionalFee;
          }, 0)
          .toFixed(2);

        const payable = await tx.payable.create({
          data: {
            ...payableData,
            referenceDate: new Date(payableData.referenceDate),
            totalAmount: parseFloat(totalAmount),
            installmentQty: installments.length,
          },
        });

        // Cria as parcelas vinculadas
        await tx.payableInstallment.createMany({
          data: installments.map((installment, index) => ({
            ...installment,
            installmentNumber: index + 1,
            dueDate: new Date(installment.dueDate),
            status:
              new Date(installment.dueDate) < currentDate
                ? 'OVERDUE'
                : 'PENDING',
            payableId: payable.id,
          })),
        });

        return payable;
      });
    } catch (error) {
      console.error(error);
      throw new Error('Error creating payable' + error.message);
    }
  }

  async findAll(paginationDto: ReceivableFilterDto) {
    try {
      if (!paginationDto.companyId) {
        throw new BadRequestException('companyId is required');
      }

      const { page = 1, limit = 10, search, dueDate } = paginationDto;

      const filters: any = {
        payable: {
          companyId: paginationDto.companyId,
        },
      };

      // Filtro de data baseado em dueDate
      if (dueDate) {
        filters.dueDate = {
          gt: new Date(dueDate),
        };
      }

      // Filtro de pesquisa para cliente, categoria ou subcategoria
      if (search) {
        filters.payable.OR = [
          { client: { name: { contains: search, mode: 'insensitive' } } },
          { category: { name: { contains: search, mode: 'insensitive' } } },
          { subCategory: { name: { contains: search, mode: 'insensitive' } } },
        ];
      }

      // 1. Agrupamento no banco de dados com somatório e paginação
      const grouped = await this.prisma.payableInstallment.groupBy({
        by: ['dueDate'],
        where: filters,
        orderBy: { dueDate: 'desc' },
        skip: (+page - 1) * +limit,
        take: +limit,
        _sum: {
          amount: true,
          additionalFee: true,
        },
        _count: true,
      });

      // // 2. Calcular o total e as últimas páginas
      // const totalGroups = await this.prisma.payableInstallment.groupBy({
      //   by: ['dueDate'],
      //   where: filters,
      //   _count: true,
      // });
      const totalInstallments = await this.prisma.payableInstallment.count();

      const total = totalInstallments;
      const lastPage = Math.ceil(total / +limit);

      // 3. Buscar os detalhes das parcelas apenas para os grupos retornados
      const dueDates = grouped.map((g) => g.dueDate);

      const installments = await this.prisma.payableInstallment.findMany({
        where: {
          dueDate: { in: dueDates },
          ...filters,
        },
        orderBy: { dueDate: 'desc' },
        select: {
          id: true,
          status: true,
          amount: true,
          additionalFee: true,
          paidDate: true,
          dueDate: true,
          payable: {
            select: {
              id: true,
              totalAmount: true,
              description: true,
              notes: true,
              status: true,
              referenceDate: true,
              supplier: { select: { id: true, name: true } },
              subCategory: { select: { id: true, name: true } },
              // supplier: { select: { id: true, name: true } },
              nature: { select: { id: true, name: true } },
              installments: {
                select: {
                  id: true,
                  status: true,
                  paymentMethod: { select: { id: true, name: true } },
                  amount: true,
                  paidAmount: true,
                  additionalFee: true,
                  dueDate: true,
                  paidDate: true,
                },
                orderBy: { dueDate: 'desc' },
              },
            },
          },
        },
      });

      const groupedByDate = grouped.map((group) => {
        const expectedRevenue = installments
          .filter(
            (inst) =>
              inst.dueDate.toISOString() === group.dueDate.toISOString() &&
              inst.payable?.status !== 'CANCELED', // Filtro por status
          )
          .reduce(
            (sum, inst) => sum + (inst.amount || 0) + (inst.additionalFee || 0),
            0,
          );
        const payableList = installments
          .filter(
            (inst) =>
              inst.dueDate.toISOString() === group.dueDate.toISOString(),
          )
          .map((inst) => {
            return {
              id: inst.payable?.id || null,
              totalValue: inst.payable?.totalAmount || 0,
              totalPaid: (inst.payable?.installments || []).reduce(
                (sum, item) => {
                  return sum + (item.paidAmount ?? 0);
                },
                0,
              ),
              description: inst.payable?.description || '',
              supplier: inst.payable?.supplier
                ? {
                    id: inst.payable.supplier.id,
                    name: inst.payable.supplier.name,
                  }
                : null,
              subCategory: inst.payable?.subCategory
                ? {
                    id: inst.payable.subCategory.id,
                    name: inst.payable.subCategory.name,
                  }
                : null,
              nature: inst.payable?.nature
                ? {
                    id: inst.payable.nature.id,
                    name: inst.payable.nature.name,
                  }
                : null,
              installmentsQuantity: inst.payable?.installments?.length || 0,
              period: inst.payable?.referenceDate || null,
              notes: inst.payable?.notes || '',
              status: inst.payable?.status || 'UNKNOWN',
              installments: (inst.payable?.installments || [])
                .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime()) // Ordenando as parcelas pela data de vencimento
                .map((installment) => ({
                  id: installment.id || null,
                  status: installment.status || 'UNKNOWN',
                  paymentMethod: {
                    id: installment.paymentMethod?.id || null,
                    name: installment.paymentMethod?.name || null,
                  },
                  value: installment.amount || 0,
                  additionalFee: installment.additionalFee || 0,
                  dueDate: installment.dueDate || null,
                  paidValue: installment.paidAmount || 0, // Ajuste baseado nos requisitos.
                  paymentDate: installment.paidDate || null,
                  current: installment.id === inst.id, // Definindo se a parcela é a atual
                })),
            };
          });

        return {
          date: group.dueDate || null,
          expectedRevenue,
          transactions: payableList,
        };
      });
      return {
        total,
        lastPage,
        data: groupedByDate,
      };
    } catch (error) {
      console.error(error);
    }
  }

  async findOne(id: string) {
    const payable = await this.prisma.payable.findUnique({
      where: { id },
      include: { installments: true },
    });
    if (!payable) throw new NotFoundException('Conta a pagar não encontrada.');
    return payable;
  }

  async updateTitle(id: string, dto: UpdatePayableDto) {
    try {
      const updatedPayable = await this.prisma.payable.update({
        where: { id },
        data: dto,
      });

      return updatedPayable;
    } catch (error) {
      console.error('Error updating payable title:', error);
      throw new Error('Failed to update payable title.');
    }
  }

  async cancel(id: string, dto: CancelPayableDto) {
    const payable = await this.findOne(id);

    // Verifica se o título já está cancelado
    if (payable.status === 'CANCELED') {
      throw new Error('A conta a pagar já foi cancelada.');
    }

    // Atualiza o status de todas as parcelas com status "PENDING" para "CANCELED"
    const updates = payable.installments
      .filter((installment) => installment.status === 'PENDING')
      .map((installment) =>
        this.prisma.payableInstallment.update({
          where: { id: installment.id },
          data: { status: 'CANCELED' },
        }),
      );

    // Realiza a transação
    await this.prisma.$transaction(updates);
    await this.prisma.payable.update({
      where: { id },
      data: {
        status: 'CANCELED',
        ...dto,
      },
    });
    return { message: 'Conta a pagar cancelada com sucesso.' };
  }

  async remove(id: string) {
    await this.prisma.payableInstallment.deleteMany({
      where: { payableId: id },
    });
    await this.prisma.payableHistory.deleteMany({
      where: { payableId: id },
    });
    return await this.prisma.payable.delete({ where: { id } });
  }

  async count() {
    return this.prisma.payable.count();
  }

  async payInstallment(installmentId, payInstallmentDto: PayInstallmentDto) {
    const { paymentMethodId, bankAccountId, amount, paidDate } =
      payInstallmentDto;
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const installment = await tx.payableInstallment.update({
          where: { id: installmentId },
          data: {
            status: 'PAID',
            paidDate: new Date(paidDate),
            paidAmount: amount,
            paymentMethodId,
            bankAccountId,
          },
        });

        // Busca o caixa aberto
        const openCashRegister = await tx.cashRegister.findFirst({
          where: {
            bankAccountId,
            status: 'OPEN',
            openingDate: {
              gte: startOfDay(new Date(paidDate)),
              lt: endOfDay(new Date(paidDate)),
            },
          },
        });

        if (!openCashRegister) {
          throw new BadRequestException(
            'Nenhum caixa aberto encontrado para esta data.',
          );
        }

        await tx.transaction.create({
          data: {
            type: TransactionType.OUTCOME,
            amount: amount,
            description: `Pagamento da parcela ${installment.id}`,
            transactionDate: new Date(paidDate),
            payableInstallment: {
              connect: { id: installment.id },
            },
            cashRegister: {
              connect: { id: openCashRegister.id },
            },
          },
        });

        // // Atualiza o valor total do título
        // const updatedTotal = await tx.payableInstallment.aggregate({
        //   where: { payableId: installment.payableId },
        //   _sum: { amount: true },
        // });

        // await tx.payable.update({
        //   where: { id: installment.payableId },
        //   data: { totalAmount: updatedTotal._sum.amount },
        // });

        return installment;
      });
      await this.updatePayableStatus(result.payableId);

      return { message: 'Parcela paga com sucesso.' };
    } catch (error) {
      console.error(error);
    }
  }

  async updateInstallments(
    payableId: string,
    dto: UpdatePayableInstallmentsDto,
  ): Promise<any> {
    try {
      const { installments, totalAmount, changeNotes, changeReason } = dto;
      const currentDate = new Date();
      // let totalAmount = 0;

      const updatedPayable = await this.prisma.$transaction(async (prisma) => {
        const updatedInstallments = [];
        for (const installmentDto of installments) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { id, originalId, ...rest } = installmentDto;

          if (id) {
            const updateData: Record<string, any> = { ...rest };
            if (updateData.dueDate) {
              updateData.dueDate = new Date(updateData.dueDate);
              if (updateData.status === 'PENDING') {
                updateData.status =
                  updateData.dueDate < currentDate ? 'OVERDUE' : 'PENDING';
              }
            }

            // Se a parcela existe, atualiza
            try {
              const updatedInstallment = await prisma.payableInstallment.update(
                {
                  where: { id: installmentDto.id },
                  data: updateData,
                },
              );
              updatedInstallments.push(updatedInstallment);
            } catch (error) {
              console.error('Error updating installment:', error);
            }
          } else {
            const newInstallment = await prisma.payableInstallment.create({
              data: {
                payableId,
                amount: installmentDto.amount,
                dueDate: new Date(installmentDto.dueDate),
                status:
                  new Date(installmentDto.dueDate) < currentDate
                    ? 'OVERDUE'
                    : 'PENDING',
                paymentMethodId: installmentDto.paymentMethodId,
                installmentNumber: installments.indexOf(installmentDto) + 1,
              },
            });
            updatedInstallments.push(newInstallment);
          }
          // totalAmount += installmentDto.amount;
        }

        // Busca parcelas existentes no banco
        const existingInstallments = await prisma.payableInstallment.findMany({
          where: { payableId },
        });

        const installmentIdsToKeep = updatedInstallments.map((inst) => inst.id);

        // Filtra parcelas a serem deletadas
        const installmentsToDelete = existingInstallments
          .filter((inst) => !installmentIdsToKeep.includes(inst.id))
          .map((inst) => inst.id);

        // Deleta parcelas que não estão no array de entrada
        await prisma.payableInstallment.deleteMany({
          where: {
            id: { in: installmentsToDelete },
            payableId,
          },
        });

        // Rearranja os números das parcelas restantes
        const allInstallments = await prisma.payableInstallment.findMany({
          where: { payableId },
          orderBy: { installmentNumber: 'asc' }, // Ordena por data de vencimento para manter a sequência lógica
        });

        for (const [index, installment] of allInstallments.entries()) {
          await prisma.payableInstallment.update({
            where: { id: installment.id },
            data: { installmentNumber: index + 1 },
          });
        }
        const updateData: Record<string, any> = {};
        if (totalAmount !== undefined) updateData.totalAmount = totalAmount;
        if (changeReason !== undefined) updateData.changeReason = changeReason;
        if (changeNotes !== undefined) updateData.changeNotes = changeNotes;

        if (Object.keys(updateData).length > 0) {
          await this.prisma.payable.update({
            where: { id: payableId },
            data: updateData,
          });
        }

        // // Recalcula o totalAmount, incluindo taxas
        // totalAmount = allInstallments.reduce(
        //   (sum, installment) =>
        //     sum + installment.amount + (installment.additionalFee || 0),
        //   0,
        // );

        // // Atualiza o totalAmount no título principal
        // try {
        //   const updatedPayable = await prisma.payable.update({
        //     where: { id: payableId },
        //     data: { totalAmount },
        //   });
        //   return updatedPayable;
        // } catch (error) {
        //   console.error(error.message);
        // }
      });

      await this.updatePayableStatus(payableId);

      return updatedPayable;
    } catch (error) {
      console.error(error);
    }
  }

  async updatePayableStatus(payableId: string): Promise<void> {
    // Busca as parcelas vinculadas à movimentação
    const installments = await this.prisma.payableInstallment.findMany({
      where: { payableId },
      select: {
        status: true,
        dueDate: true,
      },
    });

    if (!installments || installments.length === 0) {
      console.warn(
        `Nenhuma parcela encontrada para a movimentação ${payableId}`,
      );
      return;
    }

    // Define as condições para os diferentes status da movimentação
    const hasCancelled = installments.some(
      (inst) => inst.status === PaymentStatus.CANCELED,
    );
    const hasOverdue = installments.some(
      (inst) =>
        inst.status === PaymentStatus.PENDING && inst.dueDate < new Date(),
    );
    const hasPending = installments.some(
      (inst) => inst.status === PaymentStatus.PENDING,
    );
    const allPaid = installments.every(
      (inst) => inst.status === PaymentStatus.PAID,
    );

    let newStatus: PaymentStatus;

    if (hasCancelled) {
      newStatus = PaymentStatus.CANCELED;
    } else if (hasOverdue) {
      newStatus = PaymentStatus.OVERDUE;
    } else if (hasPending) {
      newStatus = PaymentStatus.PENDING;
    } else if (allPaid) {
      newStatus = PaymentStatus.PAID;
    } else {
      console.error(
        `Não foi possível determinar o status para a movimentação ${payableId}`,
      );
      return;
    }

    // Atualiza o status da movimentação
    await this.prisma.payable.update({
      where: { id: payableId },
      data: { status: newStatus },
    });
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async checkOverdueInstallments(): Promise<void> {
    const currentDate = new Date();

    // Busca parcelas pendentes vencidas
    const overdueInstallments = await this.prisma.payableInstallment.findMany({
      where: {
        status: PaymentStatus.PENDING,
        dueDate: {
          lt: currentDate,
        },
      },
      select: {
        id: true,
        payableId: true,
      },
    });

    if (overdueInstallments.length === 0) {
      return;
    }

    // Atualiza o status das parcelas para OVERDUE
    const updatePromises = overdueInstallments.map((installment) =>
      this.prisma.payableInstallment.update({
        where: { id: installment.id },
        data: { status: PaymentStatus.OVERDUE },
      }),
    );

    await Promise.all(updatePromises);

    const payableIds = Array.from(
      new Set(overdueInstallments.map((inst) => inst.payableId)),
    );

    const payableUpdatePromises = payableIds.map((id) =>
      this.updatePayableStatus(id),
    );

    await Promise.all(payableUpdatePromises);
  }
}
