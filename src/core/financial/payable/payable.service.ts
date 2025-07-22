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
import { add, endOfDay } from 'date-fns';
import { CompensateDto } from '../receivable/dto/create-receivable.dto';

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
              subCategory: { select: { id: true, description: true } },
              // supplier: { select: { id: true, name: true } },
              nature: { select: { id: true, description: true } },
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
              type: 'payable',
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
                    name: inst.payable.subCategory.description,
                  }
                : null,
              nature: inst.payable?.nature
                ? {
                    id: inst.payable.nature.id,
                    name: inst.payable.nature.description,
                  }
                : null,
              installmentsQuantity: inst.payable?.installments?.length || 0,
              period: inst.payable?.referenceDate || null,
              notes: inst.payable?.notes || '',
              status: inst.payable?.status || 'UNKNOWN',
              // Na listagem, retornamos apenas a parcela atual (correspondente à data da linha)
              currentInstallment: (() => {
                const currentInst = inst.payable?.installments?.find(
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
      include: {
        supplier: true,
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

  async payInstallment(
    installmentId: string,
    payInstallmentDto: PayInstallmentDto,
  ) {
    const {
      paymentMethodId,
      bankAccountId,
      amount,
      paidDate,
      difference,
      differenceNatureId,
      differenceCategoryId,
    } = payInstallmentDto;

    // Validação dos campos de diferença
    if (difference && difference !== 0) {
      if (!differenceNatureId || !differenceCategoryId) {
        throw new BadRequestException(
          'Natureza e categoria são obrigatórias quando há diferença no pagamento.',
        );
      }

      // Validar se a natureza existe e está ativa
      const nature = await this.prisma.nature.findFirst({
        where: {
          id: differenceNatureId,
          isActive: true,
        },
      });

      if (!nature) {
        throw new BadRequestException('Natureza não encontrada ou inativa.');
      }

      // CORREÇÃO: Validar tipo da natureza de forma mais rigorosa
      const expectedType = difference < 0 ? 'payable' : 'receivable';
      const expectedLevel1 = difference < 0 ? '02' : '01'; // negativo = payable, positivo = receivable

      if (nature.level1 !== expectedLevel1) {
        throw new BadRequestException(
          `Para diferença ${difference < 0 ? 'negativa' : 'positiva'}, selecione uma natureza do tipo '${expectedType}'.`,
        );
      }

      // NOVO: Validar se subcategoria existe, está ativa e pertence à natureza
      const subCategory = await this.prisma.subCategory.findFirst({
        where: {
          id: differenceCategoryId,
          isActive: true,
        },
      });

      if (!subCategory) {
        throw new BadRequestException('Categoria não encontrada ou inativa.');
      }

      if (subCategory.natureId !== differenceNatureId) {
        throw new BadRequestException(
          'A categoria selecionada não pertence à natureza escolhida.',
        );
      }

      // Validar se natureza e subcategoria pertencem à mesma empresa
      if (nature.companyId !== subCategory.companyId) {
        throw new BadRequestException(
          'Natureza e categoria devem pertencer à mesma empresa.',
        );
      }
    }

    const bankAccountData = await this.prisma.bankAccountCashControl.findFirst({
      where: {
        bankAccountId: bankAccountId,
        paymentMethodId: paymentMethodId,
      },
    });

    if (!bankAccountData) {
      throw new BadRequestException(
        'Configuração de conta bancária não encontrada para os dados fornecidos.',
      );
    }

    const installmentData = await this.prisma.payableInstallment.findFirst({
      where: {
        id: installmentId,
      },
    });

    if (!installmentData) {
      throw new NotFoundException('Parcela não encontrada.');
    }

    if (
      installmentData.status !== 'PENDING' &&
      installmentData.status !== 'PROVISIONED' &&
      installmentData.status !== 'OVERDUE'
    ) {
      throw new BadRequestException(
        'Parcela deve estar pendente, vencida ou provisionada para ser paga.',
      );
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const data: any = {
          status:
            bankAccountData.paymentType === 'PROVISION'
              ? 'PROVISIONED'
              : 'PAID',
          paidAmount: amount,
          paymentMethodId,
          bankAccountId,
        };
        if (bankAccountData.paymentType === 'PROVISION') {
          data['provisionDate'] = new Date(paidDate);
        } else {
          data['paidDate'] = new Date(paidDate);
        }

        const installment = await tx.payableInstallment.update({
          where: { id: installmentId },
          data: data,
        });

        // Criar lançamento para diferença se necessário
        if (difference && difference !== 0) {
          const originalPayable = await tx.payable.findUnique({
            where: { id: installmentData.payableId },
            select: {
              companyId: true,
              clientId: true,
              supplierId: true,
              referenceDate: true,
              description: true,
            },
          });

          const transactionType = difference < 0 ? 'payable' : 'receivable';
          const differenceDescription = `Diferença no pagamento da parcela ${installmentData.installmentNumber} - ${originalPayable.description || 'Sem descrição'}`;

          if (transactionType === 'payable') {
            // Criar conta a pagar para diferença negativa
            const newPayable = await tx.payable.create({
              data: {
                referenceDate: originalPayable.referenceDate, // Herdar data de referência da transação original
                description: differenceDescription,
                companyId: originalPayable.companyId,
                clientId: originalPayable.clientId, // Herdar clientId da transação original
                supplierId: originalPayable.supplierId, // Herdar supplierId da transação original
                natureId: differenceNatureId,
                subCategoryId: differenceCategoryId,
                totalAmount: Math.abs(difference),
                installmentQty: 1,
              },
            });

            // CORREÇÃO: Diferença segue o mesmo padrão da transação original
            const differenceStatus =
              bankAccountData.paymentType === 'PROVISION'
                ? 'PROVISIONED'
                : 'PAID';
            const dateField =
              bankAccountData.paymentType === 'PROVISION'
                ? 'provisionDate'
                : 'paidDate';

            const newPayableInstallment = await tx.payableInstallment.create({
              data: {
                installmentNumber: 1,
                dueDate: new Date(paidDate),
                amount: Math.abs(difference),
                paidAmount: Math.abs(difference),
                status: differenceStatus,
                [dateField]: new Date(paidDate),
                paymentMethodId,
                bankAccountId,
                payableId: newPayable.id,
              },
            });

            // NOVO: Só impacta o caixa se não for PROVISION
            if (bankAccountData.paymentType !== 'PROVISION') {
              // Fazer compensação dentro da mesma transação
              const amount = newPayableInstallment.paidAmount || 0;

              // Busca o caixa aberto
              const openCashRegister = await tx.cashRegister.findFirst({
                where: {
                  bankAccountId,
                  status: 'OPEN',
                  openingDate: {
                    lte: new Date(paidDate),
                  },
                },
                orderBy: {
                  openingDate: 'desc',
                },
              });

              if (openCashRegister) {
                await tx.transaction.create({
                  data: {
                    type: 'OUTCOME',
                    amount: amount,
                    description: differenceDescription,
                    transactionDate: new Date(paidDate),
                    payableInstallment: {
                      connect: { id: newPayableInstallment.id },
                    },
                    cashRegister: { connect: { id: openCashRegister.id } },
                  },
                });

                // Atualiza o valor total do caixa
                await tx.cashRegister.update({
                  where: { id: openCashRegister.id },
                  data: { totalOutcomes: { increment: amount } },
                });
              }
            }
          } else {
            // Criar conta a receber para diferença positiva
            const newReceivable = await tx.receivable.create({
              data: {
                referenceDate: originalPayable.referenceDate, // Herdar data de referência da transação original
                description: differenceDescription,
                companyId: originalPayable.companyId,
                clientId: originalPayable.clientId, // Herdar clientId da transação original
                supplierId: originalPayable.supplierId, // Herdar supplierId da transação original
                natureId: differenceNatureId,
                subCategoryId: differenceCategoryId,
                totalAmount: Math.abs(difference),
                installmentQty: 1,
              },
            });

            // CORREÇÃO: Diferença segue o mesmo padrão da transação original
            const differenceStatus =
              bankAccountData.paymentType === 'PROVISION'
                ? 'PROVISIONED'
                : 'PAID';
            const dateField =
              bankAccountData.paymentType === 'PROVISION'
                ? 'provisionDate'
                : 'paidDate';

            const newReceivableInstallment =
              await tx.receivableInstallment.create({
                data: {
                  installmentNumber: 1,
                  dueDate: new Date(paidDate),
                  amount: Math.abs(difference),
                  paidAmount: Math.abs(difference),
                  status: differenceStatus,
                  [dateField]: new Date(paidDate),
                  paymentMethodId,
                  bankAccountId,
                  receivableId: newReceivable.id,
                },
              });

            // NOVO: Só impacta o caixa se não for PROVISION
            if (bankAccountData.paymentType !== 'PROVISION') {
              // Fazer compensação dentro da mesma transação
              const amount = newReceivableInstallment.paidAmount || 0;

              // Busca o caixa aberto
              const openCashRegister = await tx.cashRegister.findFirst({
                where: {
                  bankAccountId,
                  status: 'OPEN',
                  openingDate: {
                    lte: new Date(paidDate),
                  },
                },
                orderBy: {
                  openingDate: 'desc',
                },
              });

              if (openCashRegister) {
                await tx.transaction.create({
                  data: {
                    type: 'INCOME',
                    amount: amount,
                    description: differenceDescription,
                    transactionDate: new Date(paidDate),
                    receivableInstallment: {
                      connect: { id: newReceivableInstallment.id },
                    },
                    cashRegister: { connect: { id: openCashRegister.id } },
                  },
                });

                // Atualiza o valor total do caixa
                await tx.cashRegister.update({
                  where: { id: openCashRegister.id },
                  data: { totalIncomes: { increment: amount } },
                });
              }
            }
          }
        }

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

      // Chama compensateInstallment após atualizar a parcela
      if (bankAccountData.paymentType !== 'PROVISION') {
        await this.compensateInstallment(installmentId, {
          paidDate,
        });
      }

      // Buscar dados completos da parcela atualizada para retornar
      const updatedInstallment =
        await this.prisma.payableInstallment.findUnique({
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
    }
  }

  async compensateInstallment(
    installmentId: string,
    compensateDto: CompensateDto,
  ): Promise<void> {
    const { paidDate } = compensateDto;
    const paidDateFormatted = add(new Date(paidDate), { days: 0 });
    await this.prisma.$transaction(async (tx) => {
      const installment = await tx.payableInstallment.findFirst({
        where: { id: installmentId },
      });
      if (!installment) {
        throw new BadRequestException('Parcela não encontrada.');
      }
      const amount = installment.paidAmount || 0;
      const bankAccountId = installment.bankAccountId;

      if (!bankAccountId) {
        throw new BadRequestException(
          'Conta bancária não definida na parcela.',
        );
      }

      // Busca o caixa aberto
      const openCashRegister = await tx.cashRegister.findFirst({
        where: {
          bankAccountId,
          status: 'OPEN',
          openingDate: {
            lte: endOfDay(new Date(paidDateFormatted)),
          },
        },
        orderBy: {
          openingDate: 'desc',
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
          transactionDate: new Date(paidDateFormatted),
          payableInstallment: { connect: { id: installment.id } },
          cashRegister: { connect: { id: openCashRegister.id } },
        },
      });

      // Atualiza o valor total do caixa
      await tx.cashRegister.update({
        where: { id: openCashRegister.id },
        data: { totalOutcomes: { increment: amount } },
      });

      await tx.payableInstallment.update({
        where: { id: installmentId },
        data: { status: 'PAID', paidDate: new Date(paidDate) },
      });
    });
  }

  async undoPaymentInstallment(installmentId: string) {
    try {
      const installmentData = await this.prisma.payableInstallment.findFirst({
        where: { id: installmentId },
      });

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
        // NOVO: Cancelar lançamentos de diferença criados para essa parcela
        const originalPayable = await tx.payable.findUnique({
          where: { id: installmentData.payableId },
          select: { description: true },
        });

        const differenceDescriptionPattern = `Diferença no pagamento da parcela ${installmentData.installmentNumber} - ${originalPayable?.description || 'Sem descrição'}`;

        // Encontrar e cancelar payables de diferença
        await tx.payable.updateMany({
          where: {
            description: differenceDescriptionPattern,
            status: { not: 'CANCELED' },
          },
          data: { status: 'CANCELED' },
        });

        // Encontrar e cancelar receivables de diferença
        await tx.receivable.updateMany({
          where: {
            description: differenceDescriptionPattern,
            status: { not: 'CANCELED' },
          },
          data: { status: 'CANCELED' },
        });

        // Reverte o status da parcela e remove os dados de pagamento/provisionamento
        // MANTÉM paymentMethodId e bankAccountId para facilitar novo pagamento
        await tx.payableInstallment.update({
          where: { id: installmentId },
          data: {
            status: 'PENDING',
            paidAmount: null,
            paidDate: null,
            provisionDate: null,
            // paymentMethodId e bankAccountId são mantidos
          },
        });

        if (installmentData.status === 'PAID') {
          // Busca o caixa aberto relacionado ao pagamento original
          const relatedTransaction = await tx.transaction.findFirst({
            where: {
              payableInstallment: {
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
                  totalOutcomes: { decrement: paymentAmount },
                },
              });
            }
          }
        }
      });

      await this.updatePayableStatus(installmentData.payableId);

      // Buscar dados completos da parcela atualizada para retornar
      const updatedInstallment =
        await this.prisma.payableInstallment.findUnique({
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
