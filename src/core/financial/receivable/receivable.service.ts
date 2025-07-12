import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import {
  CompensateDto,
  CreateReceivableDto,
  UpdateReceivableInstallmentsDto,
} from './dto/create-receivable.dto';
import {
  CancelReceivableDto,
  PayInstallmentDto,
  UpdateReceivableDto,
} from './dto/update-receivable.dto';
import { ReceivableFilterDto } from './dto/receivable-filter.dto';
import { PaymentStatus, TransactionType } from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';
import { startOfDay, endOfDay, add } from 'date-fns';

@Injectable()
export class ReceivableService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateReceivableDto) {
    //TODO: ajustar o status da parcela para OVERDUE caso a data tiver velha
    const { installments, ...receivableData } = dto;

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

        const receivable = await tx.receivable.create({
          data: {
            ...receivableData,
            referenceDate: new Date(receivableData.referenceDate),
            totalAmount: parseFloat(totalAmount),
            installmentQty: installments.length,
          },
        });

        // Cria as parcelas vinculadas
        await tx.receivableInstallment.createMany({
          data: installments.map((installment, index) => ({
            ...installment,
            installmentNumber: index + 1,
            dueDate: new Date(installment.dueDate),
            receivableId: receivable.id,
          })),
        });

        return receivable;
      });
    } catch (error) {
      console.error(error);
      throw new Error('Error creating receivable' + error.message);
    }
  }

  async findAll(paginationDto: ReceivableFilterDto) {
    if (!paginationDto.companyId) {
      throw new BadRequestException('companyId is required');
    }

    const { page = 1, limit = 10, search, dueDate } = paginationDto;

    const filters: any = {
      receivable: {
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
      filters.receivable.OR = [
        { client: { name: { contains: search, mode: 'insensitive' } } },
        { nature: { name: { contains: search, mode: 'insensitive' } } },
        { subCategory: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    // 1. Agrupamento no banco de dados com somatório e paginação
    const grouped = await this.prisma.receivableInstallment.groupBy({
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
    // const totalGroups = await this.prisma.receivableInstallment.groupBy({
    //   by: ['dueDate'],
    //   where: filters,
    //   _count: true,
    // });
    const totalInstallments = await this.prisma.receivableInstallment.count();

    const total = totalInstallments;
    const lastPage = Math.ceil(total / +limit);

    // 3. Buscar os detalhes das parcelas apenas para os grupos retornados
    const dueDates = grouped.map((g) => g.dueDate);

    const installments = await this.prisma.receivableInstallment.findMany({
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
        receivable: {
          select: {
            id: true,
            totalAmount: true,
            totalValue: true,
            mainAdditionalFee: true,
            description: true,
            notes: true,
            status: true,
            referenceDate: true,
            client: { select: { id: true, name: true } },
            // supplier: { select: { id: true, name: true } },
            nature: { select: { id: true, description: true } },
            subCategory: { select: { id: true, description: true } },
            installments: {
              select: {
                id: true,
                installmentNumber: true,
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
            inst.receivable?.status !== 'CANCELED',
        )
        .reduce(
          (sum, inst) => sum + (inst.amount || 0) + (inst.additionalFee || 0),
          0,
        );

      const receivables = installments
        .filter(
          (inst) => inst.dueDate.toISOString() === group.dueDate.toISOString(),
        )
        .map((inst) => {
          return {
            type: 'receivable',
            id: inst.receivable?.id || null,
            totalValue: inst.receivable?.totalValue || 0,
            totalAdditionalFee: inst.receivable?.mainAdditionalFee || 0,
            totalAmount: inst.receivable?.totalAmount || 0,
            totalPaid: (inst.receivable?.installments || []).reduce(
              (sum, item) => {
                return sum + (item.paidAmount ?? 0);
              },
              0,
            ),
            description: inst.receivable?.description || '',
            client: inst.receivable?.client
              ? {
                  id: inst.receivable.client.id,
                  name: inst.receivable.client.name,
                }
              : null,
            subCategory: inst.receivable?.subCategory
              ? {
                  id: inst.receivable.subCategory.id,
                  name: inst.receivable.subCategory.description,
                }
              : null,
            nature: inst.receivable?.nature
              ? {
                  id: inst.receivable.nature.id,
                  name: inst.receivable.nature.description,
                }
              : null,
            installmentsQuantity: inst.receivable?.installments?.length || 0,
            period: inst.receivable?.referenceDate || null,
            notes: inst.receivable?.notes || '',
            status: inst.receivable?.status || 'UNKNOWN',
            // Na listagem, retornamos apenas a parcela atual (correspondente à data da linha)
            currentInstallment: (() => {
              const currentInst = inst.receivable?.installments?.find(
                (i) => i.id === inst.id,
              );
              return currentInst
                ? {
                    id: currentInst.id,
                    installmentNumber: currentInst.installmentNumber || 1,
                    status: currentInst.status || 'UNKNOWN',
                    paymentMethod: {
                      id: currentInst.paymentMethod?.id || null,
                      name: currentInst.paymentMethod?.name || null,
                    },
                    value: currentInst.amount || 0,
                    additionalFee: currentInst.additionalFee || 0,
                    dueDate: currentInst.dueDate || null,
                    paidValue: currentInst.paidAmount || 0,
                    paymentDate: currentInst.paidDate || null,
                  }
                : null;
            })(),
          };
        });

      return {
        date: group.dueDate || null,
        expectedRevenue,
        transactions: receivables,
      };
    });
    return {
      total,
      lastPage,
      data: groupedByDate,
    };
  }

  async findOne(id: string) {
    const receivable = await this.prisma.receivable.findUnique({
      where: { id },
      include: {
        client: true,
        nature: true,
        subCategory: true,
        installments: {
          include: {
            paymentMethod: true,
            bankAccount: { include: { bank: true } },
          },
          orderBy: { installmentNumber: 'asc' },
        },
      },
    });
    if (!receivable)
      throw new NotFoundException('Conta a receber não encontrada.');
    return receivable;
  }

  async updateTitle(id: string, dto: UpdateReceivableDto) {
    try {
      const updatedReceivable = await this.prisma.receivable.update({
        where: { id },
        data: dto,
      });

      return updatedReceivable;
    } catch (error) {
      console.error('Error updating receivable title:', error);
      throw new Error('Failed to update receivable title.');
    }
  }

  async cancel(id: string, dto: CancelReceivableDto) {
    try {
      const receivable = await this.findOne(id);

      // Verifica se o título já está cancelado
      if (receivable.status === 'CANCELED') {
        throw new Error('A conta a receber já foi cancelada.');
      }

      // Atualiza o status de todas as parcelas com status "PENDING" para "CANCELED"
      const updates = receivable.installments
        .filter((installment) => installment.status === 'PENDING')
        .map((installment) =>
          this.prisma.receivableInstallment.update({
            where: { id: installment.id },
            data: { status: 'CANCELED' },
          }),
        );

      // Realiza a transação
      await this.prisma.$transaction(updates);
      await this.prisma.receivable.update({
        where: { id },
        data: {
          status: 'CANCELED',
          ...dto,
        },
      });
      return { message: 'Conta a receber cancelada com sucesso.' };
    } catch (error) {
      console.error('Error canceling receivable:', error);
    }
  }

  async remove(id: string) {
    await this.prisma.receivableInstallment.deleteMany({
      where: { receivableId: id },
    });
    await this.prisma.receivableHistory.deleteMany({
      where: { receivableId: id },
    });
    return await this.prisma.receivable.delete({ where: { id } });
  }

  async count() {
    return this.prisma.receivable.count();
  }

  async payInstallment(installmentId, payInstallmentDto: PayInstallmentDto) {
    const { paymentMethodId, bankAccountId, amount, paidDate } =
      payInstallmentDto;

    const bankAccountData = await this.prisma.bankAccountCashControl.findFirst({
      where: {
        bankAccountId: bankAccountId,
        paymentMethodId: paymentMethodId,
      },
    });

    const installmentData = await this.prisma.receivableInstallment.findFirst({
      where: {
        id: installmentId,
      },
    });
    if (installmentData.status !== 'PENDING') {
      throw new BadRequestException('Parcela não está pendente.');
    }

    // const handleNegativeBalance = async (tx, finalValue) => {};

    // const handlePositiveBalance = async (tx, finalValue) => {};
    if (bankAccountData.incomeType !== 'PROVISION') {
      await this.compensateInstallment(installmentId, {
        paidDate,
      });
    }
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // Atualiza o status da parcela para "PAGO" e adiciona a data do pagamento
        const data: any = {
          status:
            bankAccountData.incomeType === 'PROVISION' ? 'PROVISIONED' : 'PAID',
          paidAmount: amount,
          paymentMethodId,
          bankAccountId,
        };
        if (bankAccountData.incomeType === 'PROVISION') {
          data['provisionDate'] = new Date(paidDate);
        } else {
          data['paidDate'] = new Date(paidDate);
        }

        const installment = await tx.receivableInstallment.update({
          where: { id: installmentId },
          data,
        });
        const finalValue = installment.paidAmount - installmentData.amount;

        if (finalValue < 0) {
          // await handleNegativeBalance(tx, finalValue);
        } else if (finalValue > 0) {
          // await handlePositiveBalance(tx, finalValue);
        }

        // FIM DA COMPENSSAÇÃO

        // const updatedTotal = await tx.receivableInstallment.aggregate({
        //   where: { receivableId: installment.receivableId },
        //   _sum: { amount: true },
        // });
        // const receivable = await tx.receivable.update({
        //   where: { id: installment.receivableId },
        //   data: { totalAmount: updatedTotal._sum.amount },
        // });
        return installment;
      });

      await this.updateReceivableStatus(result.receivableId);

      // Buscar dados completos da parcela atualizada para retornar
      const updatedInstallment =
        await this.prisma.receivableInstallment.findUnique({
          where: { id: installmentId },
          include: {
            paymentMethod: true,
            bankAccount: { include: { bank: true } },
          },
        });

      return {
        message: 'Parcela paga com sucesso.',
        installment: {
          id: updatedInstallment.id,
          installmentNumber: updatedInstallment.installmentNumber,
          status: updatedInstallment.status,
          amount: updatedInstallment.amount,
          paidAmount: updatedInstallment.paidAmount,
          dueDate: updatedInstallment.dueDate,
          paidDate: updatedInstallment.paidDate,
          paymentMethod: updatedInstallment.paymentMethod,
          bankAccount: updatedInstallment.bankAccount,
        },
      };
    } catch (error) {
      console.error(error);
      throw new BadRequestException(error.message);
    }
  }

  async compensateInstallment(
    installmentId: string,
    compensateDto: CompensateDto,
  ): Promise<void> {
    const { paidDate } = compensateDto;
    const paidDateFormatted = add(new Date(paidDate), { days: 0 });

    await this.prisma.$transaction(async (tx) => {
      const installment = await tx.receivableInstallment.findFirst({
        where: { id: installmentId },
      });
      if (!installment) {
        throw new BadRequestException('Parcela não encontrada.');
      }

      const amount = installment.paidAmount;
      const bankAccountId = installment.bankAccountId;

      // Busca o caixa aberto
      const openCashRegister = await tx.cashRegister.findFirst({
        where: {
          bankAccountId,
          status: 'OPEN',
          openingDate: {
            gte: startOfDay(new Date(paidDateFormatted)),
            lt: endOfDay(new Date(paidDateFormatted)),
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
          type: TransactionType.INCOME,
          amount: amount,
          description: `Pagamento da parcela ${installment.id}`,
          transactionDate: new Date(paidDateFormatted),
          receivableInstallment: { connect: { id: installment.id } },
          cashRegister: { connect: { id: openCashRegister.id } },
        },
      });

      // Atualiza o valor total do caixa
      await tx.cashRegister.update({
        where: { id: openCashRegister.id },
        data: { totalIncomes: { increment: amount } },
      });

      await tx.receivableInstallment.update({
        where: { id: installmentId },
        data: {
          status: 'PAID',
          paidDate: new Date(paidDate),
        },
      });
    });
  }

  async undoPaymentInstallment(installmentId: string) {
    try {
      const installmentData = await this.prisma.receivableInstallment.findFirst(
        {
          where: { id: installmentId },
        },
      );

      if (!installmentData) {
        throw new BadRequestException('Parcela não encontrada.');
      }

      if (
        installmentData.status !== 'PAID' &&
        installmentData.status !== 'PROVISIONED'
      ) {
        throw new BadRequestException(
          'A parcela não está paga ou provisionada.',
        );
      }

      const paymentAmount = installmentData.paidAmount;

      await this.prisma.$transaction(async (tx) => {
        // Reverte o status da parcela e remove os dados de pagamento/provisionamento
        await tx.receivableInstallment.update({
          where: { id: installmentId },
          data: {
            status: 'PENDING',
            paidAmount: null,
            paidDate: null,
            provisionDate: null,
            paymentMethodId: null,
            bankAccountId: null,
          },
        });

        if (installmentData.status === 'PAID') {
          // Busca o caixa aberto relacionado ao pagamento original
          const relatedTransaction = await tx.transaction.findFirst({
            where: {
              receivableInstallment: {
                every: {
                  id: installmentId,
                },
              },
            },
          });

          if (!relatedTransaction) {
            throw new BadRequestException(
              'Nenhuma transação relacionada encontrada para desfazer o pagamento.',
            );
          }

          // Remove a transação de pagamento
          await tx.transaction.delete({ where: { id: relatedTransaction.id } });

          // Atualiza o valor total do caixa se houver um caixa aberto
          if (relatedTransaction.cashRegisterId) {
            const cashRegister = await tx.cashRegister.findUnique({
              where: { id: relatedTransaction.cashRegisterId },
            });
            if (cashRegister.status !== 'OPEN') {
              throw new BadRequestException(
                'Caixa não está aberto para desfazer o pagamento.',
              );
            }

            if (cashRegister) {
              await tx.cashRegister.update({
                where: { id: cashRegister.id },
                data: {
                  totalIncomes: { decrement: paymentAmount },
                },
              });
            }
          }
        }
      });

      await this.updateReceivableStatus(installmentData.receivableId);

      // Buscar dados completos da parcela atualizada para retornar
      const updatedInstallment =
        await this.prisma.receivableInstallment.findUnique({
          where: { id: installmentId },
          include: {
            paymentMethod: true,
            bankAccount: { include: { bank: true } },
          },
        });

      return {
        message: 'Pagamento da parcela desfeito com sucesso.',
        installment: {
          id: updatedInstallment.id,
          installmentNumber: updatedInstallment.installmentNumber,
          status: updatedInstallment.status,
          amount: updatedInstallment.amount,
          paidAmount: updatedInstallment.paidAmount,
          dueDate: updatedInstallment.dueDate,
          paidDate: updatedInstallment.paidDate,
          paymentMethod: updatedInstallment.paymentMethod,
          bankAccount: updatedInstallment.bankAccount,
        },
      };
    } catch (error) {
      console.error(error);
      throw new BadRequestException(error.message);
    }
  }

  async updateInstallments(
    receivableId: string,
    dto: UpdateReceivableInstallmentsDto,
  ): Promise<any> {
    try {
      const { installments, totalAmount, changeNotes, changeReason } = dto;
      const currentDate = new Date();
      // let totalAmount = 0;

      const updatedReceivable = await this.prisma.$transaction(
        async (prisma) => {
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
                const updatedInstallment =
                  await prisma.receivableInstallment.update({
                    where: { id: installmentDto.id },
                    data: updateData,
                  });
                updatedInstallments.push(updatedInstallment);
              } catch (error) {
                console.error('Error updating installment:', error);
              }
            } else {
              const newInstallment = await prisma.receivableInstallment.create({
                data: {
                  receivableId,
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
          const existingInstallments =
            await prisma.receivableInstallment.findMany({
              where: { receivableId },
            });

          const installmentIdsToKeep = updatedInstallments.map(
            (inst) => inst.id,
          );

          // Filtra parcelas a serem deletadas
          const installmentsToDelete = existingInstallments
            .filter((inst) => !installmentIdsToKeep.includes(inst.id))
            .map((inst) => inst.id);

          // Deleta parcelas que não estão no array de entrada
          await prisma.receivableInstallment.deleteMany({
            where: {
              id: { in: installmentsToDelete },
              receivableId,
            },
          });

          // Rearranja os números das parcelas restantes
          const allInstallments = await prisma.receivableInstallment.findMany({
            where: { receivableId },
            orderBy: { installmentNumber: 'asc' }, // Ordena por data de vencimento para manter a sequência lógica
          });

          for (const [index, installment] of allInstallments.entries()) {
            await prisma.receivableInstallment.update({
              where: { id: installment.id },
              data: { installmentNumber: index + 1 },
            });
          }
          const updateData: Record<string, any> = {};
          if (totalAmount !== undefined) updateData.totalAmount = totalAmount;
          if (changeReason !== undefined)
            updateData.changeReason = changeReason;
          if (changeNotes !== undefined) updateData.changeNotes = changeNotes;

          if (Object.keys(updateData).length > 0) {
            await this.prisma.receivable.update({
              where: { id: receivableId },
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
          //   const updatedReceivable = await prisma.receivable.update({
          //     where: { id: receivableId },
          //     data: { totalAmount },
          //   });
          //   return updatedReceivable;
          // } catch (error) {
          //   console.error(error.message);
          // }
        },
      );

      await this.updateReceivableStatus(receivableId);

      return updatedReceivable;
    } catch (error) {
      console.error(error);
    }
  }

  async updateReceivableStatus(receivableId: string): Promise<void> {
    // Busca as parcelas vinculadas à movimentação
    const installments = await this.prisma.receivableInstallment.findMany({
      where: { receivableId },
      select: {
        status: true,
        dueDate: true,
      },
    });

    if (!installments || installments.length === 0) {
      console.warn(
        `Nenhuma parcela encontrada para a movimentação ${receivableId}`,
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
        `Não foi possível determinar o status para a movimentação ${receivableId}`,
      );
      return;
    }

    // Atualiza o status da movimentação
    await this.prisma.receivable.update({
      where: { id: receivableId },
      data: { status: newStatus },
    });
  }

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async checkOverdueInstallments(): Promise<void> {
    const currentDate = new Date();

    // Busca parcelas pendentes vencidas
    const overdueInstallments =
      await this.prisma.receivableInstallment.findMany({
        where: {
          status: PaymentStatus.PENDING,
          dueDate: {
            lt: currentDate,
          },
        },
        select: {
          id: true,
          receivableId: true,
        },
      });

    if (overdueInstallments.length === 0) {
      return;
    }

    // Atualiza o status das parcelas para OVERDUE
    const updatePromises = overdueInstallments.map((installment) =>
      this.prisma.receivableInstallment.update({
        where: { id: installment.id },
        data: { status: PaymentStatus.OVERDUE },
      }),
    );

    await Promise.all(updatePromises);

    const receivableIds = Array.from(
      new Set(overdueInstallments.map((inst) => inst.receivableId)),
    );

    const receivableUpdatePromises = receivableIds.map((id) =>
      this.updateReceivableStatus(id),
    );

    await Promise.all(receivableUpdatePromises);
  }
}
