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
  UndoCancelPayableDto,
} from './dto/update-payable.dto';
import { PrismaService } from 'nestjs-prisma';
import { PaymentStatus, TransactionType } from '@prisma/client';
import { ReceivableFilterDto } from '../receivable/dto/receivable-filter.dto';
import { add, endOfDay } from 'date-fns';
import { CompensateDto } from '../receivable/dto/create-receivable.dto';
import { FinancialHistoryService } from '../history/history.service';

@Injectable()
export class PayableService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly historyService: FinancialHistoryService,
  ) {}

  private getActualStatus(installment: any): string {
    if (
      installment.status === 'PENDING' &&
      new Date(installment.dueDate) < new Date()
    ) {
      return 'OVERDUE';
    }
    return installment.status;
  }

  private applyDynamicStatus(installment: any): any {
    return {
      ...installment,
      status: this.getActualStatus(installment),
    };
  }

  async create(dto: CreatePayableDto, userId?: string, userName?: string) {
    const { installments, bankAccountId, ...payableData } = dto;
    if (installments.length === 0) {
      throw new Error('At least one installment is required.');
    }
    try {
      const payable = await this.prisma.$transaction(async (tx) => {
        const totalAmount = installments
          .reduce((sum, installment) => {
            const additionalFee = installment.additionalFee ?? 0;
            return sum + installment.amount + additionalFee;
          }, 0)
          .toFixed(2);

        // Converter strings vazias em null para campos de relacionamento
        const sanitizedPayableData = {
          ...payableData,
          supplierId:
            payableData.supplierId === '' ? null : payableData.supplierId,
          employeeId:
            payableData.employeeId === '' ? null : payableData.employeeId,
        };

        const payable = await tx.payable.create({
          data: {
            ...sanitizedPayableData,
            referenceDate: new Date(payableData.referenceDate),
            totalAmount: parseFloat(totalAmount),
            installmentQty: installments.length,
          },
        });

        // Buscar conta bancária padrão se não informada
        let defaultBankAccountId = bankAccountId;
        if (!defaultBankAccountId) {
          const firstBankAccount = await tx.bankAccount.findFirst({
            where: {
              companyId: payableData.companyId,
              isActive: true,
            },
            orderBy: {
              createdAt: 'asc',
            },
          });

          if (firstBankAccount) {
            defaultBankAccountId = firstBankAccount.id;
          }
        }

        // Cria as parcelas vinculadas e coleta IDs das parcelas PAID
        const installmentsData = installments.map((installment, index) => ({
          ...installment,
          installmentNumber: index + 1,
          dueDate: new Date(installment.dueDate),
          paidDate: installment.paidDate
            ? new Date(installment.paidDate)
            : null,
          status: installment.status || 'PENDING',
          // Se status é PAID, preenche paidAmount com o valor do amount
          paidAmount: installment.status === 'PAID' ? installment.amount : null,
          payableId: payable.id,
          bankAccountId:
            installment.bankAccountId || defaultBankAccountId || null,
        }));

        await tx.payableInstallment.createMany({
          data: installmentsData,
        });

        // Buscar as parcelas criadas para obter seus IDs
        const createdInstallments = await tx.payableInstallment.findMany({
          where: { payableId: payable.id },
          orderBy: { installmentNumber: 'asc' },
        });

        // Para cada parcela criada como PAID, fazer a compensação no caixa
        for (let i = 0; i < createdInstallments.length; i++) {
          const createdInstallment = createdInstallments[i];
          const originalInstallment = installments[i];

          if (
            originalInstallment.status === 'PAID' &&
            originalInstallment.paidDate &&
            createdInstallment.bankAccountId
          ) {
            const amount =
              createdInstallment.paidAmount || createdInstallment.amount || 0;
            const paidDate = new Date(originalInstallment.paidDate);

            // Busca o caixa aberto
            const openCashRegister = await tx.cashRegister.findFirst({
              where: {
                bankAccountId: createdInstallment.bankAccountId,
                status: 'OPEN',
                openingDate: {
                  lte: paidDate,
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
                  description: `Pagamento da parcela ${createdInstallment.installmentNumber} - ${payableData.description || 'Sem descrição'}`,
                  transactionDate: paidDate,
                  payableInstallment: {
                    connect: { id: createdInstallment.id },
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
        }

        return payable;
      });

      // Atualizar status do payable após criação
      await this.updatePayableStatus(payable.id);

      // Registrar no histórico
      if (userId) {
        const supplier = payableData.supplierId
          ? await this.prisma.supplier.findUnique({
              where: { id: payableData.supplierId },
              select: { name: true },
            })
          : null;

        const employee = payableData.employeeId
          ? await this.prisma.employee.findUnique({
              where: { id: payableData.employeeId },
              select: { name: true },
            })
          : null;

        await this.historyService.createPayableHistory({
          payableId: payable.id,
          action: 'CREATE',
          description: this.historyService.getCreateDescription(),
          metadata: {
            totalAmount: payable.totalAmount,
            installmentQty: installments.length,
            supplierName: supplier?.name || null,
            employeeName: employee?.name || null,
            expenseSource: payableData.expenseSource,
          },
          createdBy: userId,
          createdByName: userName,
        });
      }

      return payable;
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
              employee: {
                select: {
                  id: true,
                  name: true,
                },
              },
              subCategory: { select: { id: true, description: true } },
              nature: { select: { id: true, description: true } },
              expenseSource: true,
              installments: {
                select: {
                  id: true,
                  installmentNumber: true,
                  status: true,
                  paymentCondition: {
                    select: { id: true, name: true },
                  },
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
              employee: inst.payable?.employee
                ? {
                    id: inst.payable.employee.id,
                    name: inst.payable.employee.name,
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
              expenseSource: inst.payable?.expenseSource || null,
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
                      status: this.getActualStatus(currentInst),
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
        employee: true,
        nature: true,
        subCategory: true,
        installments: {
          include: {
            paymentCondition: true,
            bankAccount: { include: { bank: true } },
          },
          orderBy: { installmentNumber: 'asc' },
        },
      },
    });
    if (!payable) throw new NotFoundException('Conta a pagar não encontrada.');

    // Aplicar status dinâmico nas parcelas
    return {
      ...payable,
      installments: payable.installments.map((installment) =>
        this.applyDynamicStatus(installment),
      ),
    };
  }

  async updateTitle(
    id: string,
    dto: UpdatePayableDto,
    userId?: string,
    userName?: string,
  ) {
    try {
      // Capturar estado anterior
      const before = await this.prisma.payable.findUnique({
        where: { id },
        select: {
          description: true,
          totalAmount: true,
          referenceDate: true,
          supplierId: true,
          employeeId: true,
          natureId: true,
          subCategoryId: true,
        },
      });

      // Converter strings vazias em null para campos de relacionamento
      const sanitizedDto = {
        ...dto,
        supplierId: dto.supplierId === '' ? null : dto.supplierId,
        employeeId: dto.employeeId === '' ? null : dto.employeeId,
      };

      const updatedPayable = await this.prisma.payable.update({
        where: { id },
        data: sanitizedDto,
      });

      // Registrar no histórico
      if (userId) {
        const changedFields = Object.keys(sanitizedDto).filter(
          (key) => sanitizedDto[key] !== before[key],
        );

        if (changedFields.length > 0) {
          await this.historyService.createPayableHistory({
            payableId: id,
            action: 'UPDATE_TITLE',
            description: this.historyService.getUpdateTitleDescription({
              after: sanitizedDto,
            }),
            changes: {
              before,
              after: sanitizedDto,
            },
            createdBy: userId,
            createdByName: userName,
          });
        }
      }

      return updatedPayable;
    } catch (error) {
      console.error('Error updating payable title:', error);
      throw new Error('Failed to update payable title.');
    }
  }

  async cancel(
    id: string,
    dto: CancelPayableDto,
    userId?: string,
    userName?: string,
  ) {
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
    await this.prisma.$transaction([
      ...updates,
      this.prisma.payable.update({
        where: { id },
        data: {
          status: 'CANCELED',
          ...dto,
        },
      }),
    ]);

    // Registrar no histórico
    if (userId) {
      await this.historyService.createPayableHistory({
        payableId: id,
        action: 'CANCEL',
        description: this.historyService.getCancelDescription(dto.cancelReason),
        metadata: {
          cancelReason: dto.cancelReason,
          cancelNotes: dto.cancelNotes,
        },
        createdBy: userId,
        createdByName: userName,
      });
    }

    // Cancela títulos relacionados se for um título principal da venda
    if (payable.quotationId && payable.financialType === 'MAIN') {
      await this.cancelRelatedFinancials(payable.quotationId);
    }

    return { message: 'Conta a pagar cancelada com sucesso.' };
  }

  async undoCancel(
    id: string,
    dto: UndoCancelPayableDto,
    userId?: string,
    userName?: string,
  ) {
    const payable = await this.findOne(id);

    // Verifica se o título está cancelado
    if (payable.status !== 'CANCELED') {
      throw new BadRequestException('A conta a pagar não está cancelada.');
    }

    // Atualiza o status de todas as parcelas com status "CANCELED" para "PENDING"
    const updates = payable.installments
      .filter((installment) => installment.status === 'CANCELED')
      .map((installment) =>
        this.prisma.payableInstallment.update({
          where: { id: installment.id },
          data: { status: 'PENDING' },
        }),
      );

    // Realiza a transação
    await this.prisma.$transaction([
      ...updates,
      this.prisma.payable.update({
        where: { id },
        data: {
          status: 'PENDING',
          changeNotes: dto.undoCancelNotes,
          changeReason: dto.undoCancelReason,
          cancelReason: null,
          cancelNotes: null,
        },
      }),
    ]);

    // Registrar no histórico
    if (userId) {
      await this.historyService.createPayableHistory({
        payableId: id,
        action: 'UNDO_CANCEL',
        description: this.historyService.getUndoCancelDescription(),
        metadata: {
          undoCancelReason: dto.undoCancelReason,
          undoCancelNotes: dto.undoCancelNotes,
        },
        createdBy: userId,
        createdByName: userName,
      });
    }

    // Reativa títulos relacionados se for um título principal da venda
    if (payable.quotationId && payable.financialType === 'MAIN') {
      await this.reactivateRelatedFinancials(payable.quotationId);
    }

    return { message: 'Cancelamento da conta a pagar desfeito com sucesso.' };
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

  async getHistory(id: string) {
    return this.historyService.getPayableHistory(id);
  }

  async payInstallment(
    installmentId: string,
    payInstallmentDto: PayInstallmentDto,
    userId?: string,
    userName?: string,
  ) {
    const {
      paymentConditionId,
      bankAccountId,
      amount,
      paidDate,
      difference,
      differenceNatureId,
      differenceCategoryId,
    } = payInstallmentDto;

    // Buscar parcela e título associado para validar natureza e categoria
    const installmentData = await this.prisma.payableInstallment.findFirst({
      where: {
        id: installmentId,
      },
      include: {
        payable: {
          select: {
            natureId: true,
            subCategoryId: true,
          },
        },
      },
    });

    if (!installmentData) {
      throw new NotFoundException('Parcela não encontrada.');
    }

    // Validar se o título possui natureza e categoria configuradas
    if (
      !installmentData.payable.natureId ||
      !installmentData.payable.subCategoryId
    ) {
      throw new BadRequestException(
        'Natureza e categoria devem estar configuradas no título para realizar o pagamento.',
      );
    }

    // Validar status da parcela
    if (
      installmentData.status !== 'PENDING' &&
      installmentData.status !== 'PROVISIONED'
    ) {
      throw new BadRequestException(
        'Parcela deve estar pendente ou provisionada para ser paga.',
      );
    }

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

      // CORREÇÃO: Para PAYABLES - diferença positiva = despesa adicional, diferença negativa = receita (economia)
      const expectedType = difference > 0 ? 'payable' : 'receivable';
      const expectedLevel1 = difference > 0 ? '02' : '01'; // positivo = payable (despesa), negativo = receivable (receita)

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
        paymentCondition: {
          id: paymentConditionId,
        },
      },
    });

    if (!bankAccountData) {
      throw new BadRequestException(
        'Configuração de conta bancária não encontrada para os dados fornecidos.',
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
          paymentConditionId,
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

          // Para payables: difference > 0 = despesa adicional, difference < 0 = receita adicional (economia)
          const transactionType = difference < 0 ? 'receivable' : 'payable';
          const differenceDescription = `Diferença no pagamento da parcela ${installmentData.installmentNumber} - ${originalPayable.description || 'Sem descrição'}`;

          if (transactionType === 'payable') {
            // Criar conta a pagar para diferença positiva (paguei mais = despesa adicional)
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
                paymentConditionId: paymentConditionId,
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
            // Criar conta a receber para diferença negativa (paguei menos = receita adicional)
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
                  paymentConditionId,
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

      // Se expenseSource for EMPLOYEE e financialType for MAIN, fechar a folha de pagamento
      // Isso ocorre tanto para pagamento (PAID) quanto para provisionamento (PROVISIONED)
      const payableData = await this.prisma.payable.findUnique({
        where: { id: result.payableId },
        select: {
          expenseSource: true,
          financialType: true,
          employeeId: true,
          referenceDate: true,
        },
      });

      if (
        payableData?.expenseSource === 'EMPLOYEE' &&
        payableData?.financialType === 'MAIN' &&
        payableData?.employeeId
      ) {
        // Extrair mês e ano da referenceDate
        const referenceDate = new Date(payableData.referenceDate);
        const month = referenceDate.getMonth();
        const year = referenceDate.getFullYear();

        // Buscar a folha de pagamento correspondente
        const payroll = await this.prisma.payroll.findFirst({
          where: {
            employeeId: payableData.employeeId,
            month,
            year,
          },
        });

        // Se encontrou a folha, atualizar o status para CLOSED
        // O status da parcela já foi definido como PAID ou PROVISIONED na transação acima
        if (payroll && payroll.status !== 'CLOSED') {
          await this.prisma.payroll.update({
            where: { id: payroll.id },
            data: { status: 'CLOSED' },
          });
        }
      }

      // Buscar dados completos da parcela atualizada para retornar
      const updatedInstallment =
        await this.prisma.payableInstallment.findUnique({
          where: { id: installmentId },
          include: {
            paymentCondition: true,
            bankAccount: { include: { bank: true } },
          },
        });

      // Registrar no histórico
      if (userId) {
        await this.historyService.createPayableHistory({
          payableId: result.payableId,
          action: 'PAY_INSTALLMENT',
          description: this.historyService.getPayInstallmentDescription(
            updatedInstallment.installmentNumber,
          ),
          metadata: {
            installmentNumber: updatedInstallment.installmentNumber,
            amount: updatedInstallment.amount,
            paidAmount: updatedInstallment.paidAmount,
            paidDate,
            paymentConditionId: updatedInstallment.paymentConditionId,
            paymentConditionName: updatedInstallment.paymentCondition?.name,
            bankAccountId: updatedInstallment.bankAccountId,
            bankAccountName: updatedInstallment.bankAccount?.name,
          },
          createdBy: userId,
          createdByName: userName,
        });
      }

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

  async undoPaymentInstallment(
    installmentId: string,
    userId?: string,
    userName?: string,
  ) {
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
      const previousStatus = installmentData.status;
      const previousPaidDate = installmentData.paidDate;
      const previousPaidAmount = installmentData.paidAmount;

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
        // MANTÉM paymentConditionId e bankAccountId para facilitar novo pagamento
        await tx.payableInstallment.update({
          where: { id: installmentId },
          data: {
            status: 'PENDING',
            paidAmount: null,
            paidDate: null,
            provisionDate: null,
            // paymentConditionId e bankAccountId são mantidos
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

      // Registrar no histórico
      if (userId) {
        await this.historyService.createPayableHistory({
          payableId: installmentData.payableId,
          action: 'UNDO_PAYMENT',
          description: this.historyService.getUndoPaymentDescription(
            installmentData.installmentNumber,
          ),
          changes: {
            before: {
              status: previousStatus,
              paidAmount: previousPaidAmount,
              paidDate: previousPaidDate,
            },
            after: {
              status: 'PENDING',
              paidAmount: null,
              paidDate: null,
            },
          },
          metadata: {
            installmentNumber: installmentData.installmentNumber,
            revertedAmount: previousPaidAmount,
          },
          createdBy: userId,
          createdByName: userName,
        });
      }

      // Buscar dados completos da parcela atualizada para retornar
      const updatedInstallment =
        await this.prisma.payableInstallment.findUnique({
          where: { id: installmentId },
          include: {
            paymentCondition: true,
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
    userId?: string,
    userName?: string,
  ): Promise<any> {
    try {
      const { installments, totalAmount, changeNotes, changeReason } = dto;
      // let totalAmount = 0;

      // Capturar estado antes da alteração (incluindo o totalAmount do payable)
      const payableBefore = await this.prisma.payable.findUnique({
        where: { id: payableId },
        select: { totalAmount: true },
      });

      const installmentsBefore = await this.prisma.payableInstallment.findMany({
        where: { payableId },
        select: {
          id: true,
          installmentNumber: true,
          amount: true,
          dueDate: true,
          status: true,
        },
      });

      const updatedPayable = await this.prisma.$transaction(async (prisma) => {
        // Buscar o payable para obter o companyId
        const payable = await prisma.payable.findUnique({
          where: { id: payableId },
          select: { companyId: true },
        });

        if (!payable) {
          throw new NotFoundException('Payable não encontrado.');
        }

        // Buscar conta bancária padrão para novas parcelas
        let defaultBankAccountId: string | null = null;
        const firstBankAccount = await prisma.bankAccount.findFirst({
          where: {
            companyId: payable.companyId,
            isActive: true,
          },
          orderBy: {
            createdAt: 'asc',
          },
        });

        if (firstBankAccount) {
          defaultBankAccountId = firstBankAccount.id;
        }

        const updatedInstallments = [];
        for (const installmentDto of installments) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { id, originalId, ...rest } = installmentDto;

          if (id) {
            const updateData: Record<string, any> = { ...rest };
            if (updateData.dueDate) {
              updateData.dueDate = new Date(updateData.dueDate);
              if (updateData.status === 'PENDING') {
                updateData.status = 'PENDING';
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
                status: 'PENDING',
                paymentConditionId: installmentDto.paymentConditionId,
                installmentNumber: installments.indexOf(installmentDto) + 1,
                bankAccountId:
                  installmentDto.bankAccountId || defaultBankAccountId || null,
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

        // Atualiza a quantidade de parcelas
        updateData.installmentQty = allInstallments.length;

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

      // Capturar estado depois da alteração
      const installmentsAfter = await this.prisma.payableInstallment.findMany({
        where: { payableId },
        select: {
          id: true,
          installmentNumber: true,
          amount: true,
          dueDate: true,
          status: true,
        },
      });

      // Registrar no histórico
      if (userId) {
        // Contar parcelas adicionadas (que existem em after mas não em before)
        const addedCount = installmentsAfter.filter(
          (after) =>
            !installmentsBefore.some((before) => before.id === after.id),
        ).length;

        // Contar parcelas removidas (que existem em before mas não em after)
        const removedCount = installmentsBefore.filter(
          (before) =>
            !installmentsAfter.some((after) => after.id === before.id),
        ).length;
        const modifiedCount = installmentsAfter.filter((after) => {
          const before = installmentsBefore.find((b) => b.id === after.id);
          return (
            before &&
            (before.amount !== after.amount ||
              before.dueDate.getTime() !== after.dueDate.getTime())
          );
        }).length;

        await this.historyService.createPayableHistory({
          payableId,
          action: 'UPDATE_INSTALLMENTS',
          description: this.historyService.getUpdateInstallmentsDescription(
            addedCount,
            modifiedCount,
            removedCount,
          ),
          changes: {
            before: installmentsBefore,
            after: installmentsAfter,
          },
          metadata: {
            totalInstallmentsBefore: installmentsBefore.length,
            totalInstallmentsAfter: installmentsAfter.length,
            addedCount,
            modifiedCount,
            removedCount,
            changeReason,
            changeNotes,
            totalAmountBefore: payableBefore?.totalAmount,
            totalAmountAfter: totalAmount,
          },
          createdBy: userId,
          createdByName: userName,
        });
      }

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
    const hasPending = installments.some(
      (inst) => inst.status === PaymentStatus.PENDING,
    );
    const allPaid = installments.every(
      (inst) => inst.status === PaymentStatus.PAID,
    );

    let newStatus: PaymentStatus;

    if (hasCancelled) {
      newStatus = PaymentStatus.CANCELED;
    } else if (hasPending) {
      // Se tem pendentes, salva como PENDING no banco
      // O status OVERDUE será calculado dinamicamente nas queries quando necessário
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

  private async cancelRelatedFinancials(quotationId: string): Promise<void> {
    try {
      let canceledCount = 0;

      // 1. Cancela comissões através do relacionamento Commission -> Payable
      const commissions = await this.prisma.commission.findMany({
        where: {
          quotationPayment: {
            quotationId,
          },
          payable: {
            status: { not: 'CANCELED' },
          },
        },
        include: {
          payable: {
            include: {
              installments: true,
            },
          },
        },
      });

      for (const commission of commissions) {
        if (!commission.payable) continue;
        await this.cancelPayableWithInstallments(
          commission.payable,
          'Cancelamento automático - título da venda cancelado',
        );
        canceledCount++;
      }

      // 2. Cancela entradas (receivables de entrada)
      const downPaymentReceivables = await this.prisma.receivable.findMany({
        where: {
          quotationId,
          status: { not: 'CANCELED' },
          financialType: 'DOWN_PAYMENT',
        },
        include: {
          installments: true,
        },
      });

      for (const receivable of downPaymentReceivables) {
        await this.cancelReceivableWithInstallments(
          receivable,
          'Cancelamento automático - título da venda cancelado',
        );
        canceledCount++;
      }

      // 3. Cancela entregas (payables de entrega)
      const deliveryPayables = await this.prisma.payable.findMany({
        where: {
          quotationId,
          status: { not: 'CANCELED' },
          financialType: 'DELIVERY',
        },
        include: {
          installments: true,
        },
      });

      for (const payable of deliveryPayables) {
        await this.cancelPayableWithInstallments(
          payable,
          'Cancelamento automático - título da venda cancelado',
        );
        canceledCount++;
      }

      console.log(
        `${canceledCount} títulos relacionados cancelados para a venda ${quotationId}`,
      );
    } catch (error) {
      console.error('Erro ao cancelar títulos relacionados:', error);
    }
  }

  private async reactivateRelatedFinancials(
    quotationId: string,
  ): Promise<void> {
    try {
      let reactivatedCount = 0;

      // 1. Reativa comissões canceladas automaticamente
      const commissions = await this.prisma.commission.findMany({
        where: {
          quotationPayment: {
            quotationId,
          },
          payable: {
            status: 'CANCELED',
            cancelReason: 'Cancelamento automático - título da venda cancelado',
          },
        },
        include: {
          payable: {
            include: {
              installments: true,
            },
          },
        },
      });

      for (const commission of commissions) {
        if (!commission.payable) continue;
        await this.reactivatePayableWithInstallments(
          commission.payable,
          'Reativação automática - título da venda reativado',
        );
        reactivatedCount++;
      }

      // 2. Reativa entradas (receivables de entrada)
      const downPaymentReceivables = await this.prisma.receivable.findMany({
        where: {
          quotationId,
          status: 'CANCELED',
          cancelReason: 'Cancelamento automático - título da venda cancelado',
          financialType: 'DOWN_PAYMENT',
        },
        include: {
          installments: true,
        },
      });

      for (const receivable of downPaymentReceivables) {
        await this.reactivateReceivableWithInstallments(
          receivable,
          'Reativação automática - título da venda reativado',
        );
        reactivatedCount++;
      }

      // 3. Reativa entregas (payables de entrega)
      const deliveryPayables = await this.prisma.payable.findMany({
        where: {
          quotationId,
          status: 'CANCELED',
          cancelReason: 'Cancelamento automático - título da venda cancelado',
          financialType: 'DELIVERY',
        },
        include: {
          installments: true,
        },
      });

      for (const payable of deliveryPayables) {
        await this.reactivatePayableWithInstallments(
          payable,
          'Reativação automática - título da venda reativado',
        );
        reactivatedCount++;
      }

      console.log(
        `${reactivatedCount} títulos relacionados reativados para a venda ${quotationId}`,
      );
    } catch (error) {
      console.error('Erro ao reativar títulos relacionados:', error);
    }
  }

  private async cancelReceivableWithInstallments(
    receivable: any,
    reason: string,
  ): Promise<void> {
    const installmentUpdates = receivable.installments
      .filter((installment: any) => installment.status === 'PENDING')
      .map((installment: any) =>
        this.prisma.receivableInstallment.update({
          where: { id: installment.id },
          data: { status: 'CANCELED' },
        }),
      );

    await this.prisma.$transaction([
      ...installmentUpdates,
      this.prisma.receivable.update({
        where: { id: receivable.id },
        data: {
          status: 'CANCELED',
          cancelReason: reason,
          cancelNotes: `Título cancelado em ${new Date().toLocaleDateString()}`,
        },
      }),
    ]);
  }

  private async cancelPayableWithInstallments(
    payable: any,
    reason: string,
  ): Promise<void> {
    const installmentUpdates = payable.installments
      .filter((installment: any) => installment.status === 'PENDING')
      .map((installment: any) =>
        this.prisma.payableInstallment.update({
          where: { id: installment.id },
          data: { status: 'CANCELED' },
        }),
      );

    await this.prisma.$transaction([
      ...installmentUpdates,
      this.prisma.payable.update({
        where: { id: payable.id },
        data: {
          status: 'CANCELED',
          cancelReason: reason,
          cancelNotes: `Título cancelado em ${new Date().toLocaleDateString()}`,
        },
      }),
    ]);
  }

  private async reactivateReceivableWithInstallments(
    receivable: any,
    reason: string,
  ): Promise<void> {
    const installmentUpdates = receivable.installments
      .filter((installment: any) => installment.status === 'CANCELED')
      .map((installment: any) =>
        this.prisma.receivableInstallment.update({
          where: { id: installment.id },
          data: { status: 'PENDING' },
        }),
      );

    await this.prisma.$transaction([
      ...installmentUpdates,
      this.prisma.receivable.update({
        where: { id: receivable.id },
        data: {
          status: 'PENDING',
          changeReason: reason,
          changeNotes: `Título reativado em ${new Date().toLocaleDateString()}`,
          cancelReason: null,
          cancelNotes: null,
        },
      }),
    ]);
  }

  private async reactivatePayableWithInstallments(
    payable: any,
    reason: string,
  ): Promise<void> {
    const installmentUpdates = payable.installments
      .filter((installment: any) => installment.status === 'CANCELED')
      .map((installment: any) =>
        this.prisma.payableInstallment.update({
          where: { id: installment.id },
          data: { status: 'PENDING' },
        }),
      );

    await this.prisma.$transaction([
      ...installmentUpdates,
      this.prisma.payable.update({
        where: { id: payable.id },
        data: {
          status: 'PENDING',
          changeReason: reason,
          changeNotes: `Título reativado em ${new Date().toLocaleDateString()}`,
          cancelReason: null,
          cancelNotes: null,
        },
      }),
    ]);
  }
}
