import {
  BadRequestException,
  Injectable,
  Logger,
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
  UndoCancelReceivableDto,
} from './dto/update-receivable.dto';
import { ReceivableFilterDto } from './dto/receivable-filter.dto';
import { ReceiptDataResponseDto } from './dto/receipt-data.dto';
import { PaymentStatus, Prisma, TransactionType } from '@prisma/client';
import { endOfDay, add, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { FinancialHistoryService } from '../history/history.service';
import { FinancialNotesUtil } from '../utils/financial-notes.util';
import { BaseTransactionService } from '../utils/base-transaction.service';
import { InstallmentStatusCheck } from '../utils/financial.types';

@Injectable()
export class ReceivableService {
  private readonly logger = new Logger(ReceivableService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly historyService: FinancialHistoryService,
    private readonly baseService: BaseTransactionService,
  ) {}

  private getActualStatus(installment: InstallmentStatusCheck): string {
    return this.baseService.getActualStatus(installment);
  }

  private applyDynamicStatus<T extends InstallmentStatusCheck>(installment: T): T & { status: string } {
    return this.baseService.applyDynamicStatus(installment);
  }

  async create(dto: CreateReceivableDto, userId?: string, userName?: string) {
    const { installments, bankAccountId, ...receivableData } = dto;

    if (installments.length === 0) {
      throw new Error('At least one installment is required.');
    }
    try {
      const receivable = await this.prisma.$transaction(async (tx) => {
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

        // Buscar conta bancária padrão se não informada
        let defaultBankAccountId = bankAccountId;
        if (!defaultBankAccountId) {
          const firstBankAccount = await tx.bankAccount.findFirst({
            where: {
              companyId: receivableData.companyId,
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
          receivableId: receivable.id,
          bankAccountId:
            installment.bankAccountId || defaultBankAccountId || null,
        }));

        await tx.receivableInstallment.createMany({
          data: installmentsData,
        });

        // Buscar as parcelas criadas para obter seus IDs
        const createdInstallments = await tx.receivableInstallment.findMany({
          where: { receivableId: receivable.id },
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
                  type: 'INCOME',
                  amount: amount,
                  description: `Recebimento da parcela ${createdInstallment.installmentNumber} - ${receivableData.description || 'Sem descrição'}`,
                  transactionDate: paidDate,
                  receivableInstallment: {
                    connect: { id: createdInstallment.id },
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

        return receivable;
      });

      // Atualizar status do receivable após criação
      await this.updateReceivableStatus(receivable.id);

      // Registrar no histórico
      if (userId) {
        const client = await this.prisma.client.findUnique({
          where: { id: receivableData.clientId },
          select: { name: true },
        });

        await this.historyService.createReceivableHistory({
          receivableId: receivable.id,
          action: 'CREATE',
          description: this.historyService.getCreateDescription(),
          metadata: {
            totalAmount: receivable.totalAmount,
            installmentQty: installments.length,
            clientName: client?.name || null,
          },
          createdBy: userId,
          createdByName: userName,
        });
      }

      return receivable;
    } catch (error) {
      this.logger.error('Erro ao criar conta a receber', error.stack);
      throw new Error('Error creating receivable' + error.message);
    }
  }

  async findAll(paginationDto: ReceivableFilterDto) {
    if (!paginationDto.companyId) {
      throw new BadRequestException('companyId is required');
    }

    const { page = 1, limit = 10, search, dueDate } = paginationDto;

    const filters: Prisma.ReceivableInstallmentWhereInput = {
      receivable: {
        companyId: paginationDto.companyId,
      } as Prisma.ReceivableWhereInput,
    };

    // Filtro de data baseado em dueDate
    if (dueDate) {
      filters.dueDate = {
        gt: new Date(dueDate),
      };
    }

    // Filtro de pesquisa para cliente, categoria ou subcategoria
    if (search) {
      (filters.receivable as Prisma.ReceivableWhereInput).OR = [
        { client: { name: { contains: search, mode: 'insensitive' } } },
        { nature: { name: { contains: search, mode: 'insensitive' } } },
        { subCategory: { name: { contains: search, mode: 'insensitive' } } },
      ] as Prisma.ReceivableWhereInput[];
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
            paymentCondition: true,
            bankAccount: { include: { bank: true } },
          },
          orderBy: { installmentNumber: 'asc' },
        },
      },
    });
    if (!receivable)
      throw new NotFoundException('Conta a receber não encontrada.');

    // Aplicar status dinâmico nas parcelas
    return {
      ...receivable,
      installments: receivable.installments.map((installment) =>
        this.applyDynamicStatus(installment),
      ),
    };
  }

  async updateTitle(
    id: string,
    dto: UpdateReceivableDto,
    userId?: string,
    userName?: string,
  ) {
    try {
      // Capturar estado anterior
      const before = await this.prisma.receivable.findUnique({
        where: { id },
        select: {
          description: true,
          totalAmount: true,
          referenceDate: true,
          clientId: true,
          supplierId: true,
          natureId: true,
          subCategoryId: true,
          notes: true,
        },
      });

      // Gerar notas automáticas para as alterações
      const notesToAdd: string[] = [];

      // Verificar alteração no valor total
      if (
        dto.totalAmount !== undefined &&
        before.totalAmount !== dto.totalAmount
      ) {
        notesToAdd.push(
          FinancialNotesUtil.generateTotalAmountChangeNote(
            before.totalAmount,
            dto.totalAmount,
          ),
        );
      }

      // Adicionar as notas ao DTO se houver alterações
      let dataToUpdate = { ...dto };
      if (notesToAdd.length > 0) {
        const updatedNotes = FinancialNotesUtil.appendNote(
          before.notes,
          FinancialNotesUtil.generateMultipleChangesNote(notesToAdd),
        );
        dataToUpdate = { ...dataToUpdate, notes: updatedNotes };
      }

      const updatedReceivable = await this.prisma.receivable.update({
        where: { id },
        data: dataToUpdate,
      });

      // Registrar no histórico
      if (userId) {
        const changedFields = Object.keys(dto).filter(
          (key) => dto[key] !== before[key],
        );

        if (changedFields.length > 0) {
          await this.historyService.createReceivableHistory({
            receivableId: id,
            action: 'UPDATE_TITLE',
            description: this.historyService.getUpdateTitleDescription({
              after: dto,
            }),
            changes: {
              before,
              after: dto,
            },
            createdBy: userId,
            createdByName: userName,
          });
        }
      }

      return updatedReceivable;
    } catch (error) {
      this.logger.error('Erro ao atualizar título da conta a receber', error.stack);
      throw new Error('Failed to update receivable title.');
    }
  }

  async cancel(
    id: string,
    dto: CancelReceivableDto,
    userId?: string,
    userName?: string,
  ) {
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
      await this.prisma.$transaction([
        ...updates,
        this.prisma.receivable.update({
          where: { id },
          data: {
            status: 'CANCELED',
            ...dto,
          },
        }),
      ]);

      // Registrar no histórico
      if (userId) {
        await this.historyService.createReceivableHistory({
          receivableId: id,
          action: 'CANCEL',
          description: this.historyService.getCancelDescription(
            dto.cancelReason,
          ),
          metadata: {
            cancelReason: dto.cancelReason,
            cancelNotes: dto.cancelNotes,
          },
          createdBy: userId,
          createdByName: userName,
        });
      }

      // Cancela títulos relacionados se for um título principal da venda
      if (receivable.quotationId && receivable.financialType === 'MAIN') {
        await this.baseService.cancelRelatedFinancials(receivable.quotationId);
      }

      return { message: 'Conta a receber cancelada com sucesso.' };
    } catch (error) {
      this.logger.error('Erro ao cancelar conta a receber', error.stack);
    }
  }

  async undoCancel(
    id: string,
    dto: UndoCancelReceivableDto,
    userId?: string,
    userName?: string,
  ) {
    try {
      const receivable = await this.findOne(id);

      // Verifica se o título está cancelado
      if (receivable.status !== 'CANCELED') {
        throw new BadRequestException('A conta a receber não está cancelada.');
      }

      // Atualiza o status de todas as parcelas com status "CANCELED" para "PENDING"
      const updates = receivable.installments
        .filter((installment) => installment.status === 'CANCELED')
        .map((installment) =>
          this.prisma.receivableInstallment.update({
            where: { id: installment.id },
            data: { status: 'PENDING' },
          }),
        );

      // Realiza a transação
      await this.prisma.$transaction([
        ...updates,
        this.prisma.receivable.update({
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
        await this.historyService.createReceivableHistory({
          receivableId: id,
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
      if (receivable.quotationId && receivable.financialType === 'MAIN') {
        await this.baseService.reactivateRelatedFinancials(receivable.quotationId);
      }

      return {
        message: 'Cancelamento da conta a receber desfeito com sucesso.',
      };
    } catch (error) {
      this.logger.error('Erro ao desfazer cancelamento da conta a receber', error.stack);
      throw error;
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

  async getHistory(id: string) {
    return this.historyService.getReceivableHistory(id);
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
    const installmentData = await this.prisma.receivableInstallment.findFirst({
      where: {
        id: installmentId,
      },
      include: {
        receivable: {
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
      !installmentData.receivable.natureId ||
      !installmentData.receivable.subCategoryId
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

      // CORREÇÃO: Para RECEIVABLES - diferença positiva = receita adicional, diferença negativa = despesa (desconto)
      const expectedType = difference > 0 ? 'receivable' : 'payable';
      const expectedLevel1 = difference > 0 ? '01' : '02'; // positivo = receivable (receita), negativo = payable (despesa)

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
        // Atualiza o status da parcela para "PAGO" e adiciona a data do pagamento
        const data: Prisma.ReceivableInstallmentUncheckedUpdateInput = {
          status:
            bankAccountData.incomeType === 'PROVISION' ? 'PROVISIONED' : 'PAID',
          paidAmount: amount,
          paymentConditionId,
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

        // Criar lançamento para diferença se necessário
        if (difference && difference !== 0) {
          const originalReceivable = await tx.receivable.findUnique({
            where: { id: installmentData.receivableId },
            select: {
              companyId: true,
              clientId: true,
              supplierId: true,
              referenceDate: true,
              description: true,
            },
          });

          // Para receivables: difference > 0 = receita adicional, difference < 0 = despesa adicional
          const transactionType = difference < 0 ? 'payable' : 'receivable';
          const differenceDescription = `Diferença no pagamento da parcela ${installmentData.installmentNumber} - ${originalReceivable.description || 'Sem descrição'}`;

          if (transactionType === 'payable') {
            // Criar conta a pagar para diferença negativa (recebi menos = despesa adicional)
            const newPayable = await tx.payable.create({
              data: {
                referenceDate: originalReceivable.referenceDate, // Herdar data de referência da transação original
                description: differenceDescription,
                companyId: originalReceivable.companyId,
                clientId: originalReceivable.clientId, // Herdar clientId da transação original
                supplierId: originalReceivable.supplierId, // Herdar supplierId da transação original
                natureId: differenceNatureId,
                subCategoryId: differenceCategoryId,
                totalAmount: Math.abs(difference),
                installmentQty: 1,
              },
            });

            // CORREÇÃO: Diferença segue o mesmo padrão da transação original
            const differenceStatus =
              bankAccountData.incomeType === 'PROVISION'
                ? 'PROVISIONED'
                : 'PAID';
            const dateField =
              bankAccountData.incomeType === 'PROVISION'
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
                paymentConditionId,
                bankAccountId,
                payableId: newPayable.id,
              },
            });

            // NOVO: Só impacta o caixa se não for PROVISION
            if (bankAccountData.incomeType !== 'PROVISION') {
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
            // Criar conta a receber para diferença positiva (recebi mais = receita adicional)
            const newReceivable = await tx.receivable.create({
              data: {
                referenceDate: originalReceivable.referenceDate, // Herdar data de referência da transação original
                description: differenceDescription,
                companyId: originalReceivable.companyId,
                clientId: originalReceivable.clientId, // Herdar clientId da transação original
                supplierId: originalReceivable.supplierId, // Herdar supplierId da transação original
                natureId: differenceNatureId,
                subCategoryId: differenceCategoryId,
                totalAmount: Math.abs(difference),
                installmentQty: 1,
              },
            });

            // CORREÇÃO: Diferença segue o mesmo padrão da transação original
            const differenceStatus =
              bankAccountData.incomeType === 'PROVISION'
                ? 'PROVISIONED'
                : 'PAID';
            const dateField =
              bankAccountData.incomeType === 'PROVISION'
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
            if (bankAccountData.incomeType !== 'PROVISION') {
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

        return installment;
      });

      await this.updateReceivableStatus(result.receivableId);

      // Chama compensateInstallment após atualizar a parcela
      if (bankAccountData.incomeType !== 'PROVISION') {
        await this.compensateInstallment(installmentId, {
          paidDate,
        });
      }

      // Buscar dados completos da parcela atualizada para retornar
      const updatedInstallment =
        await this.prisma.receivableInstallment.findUnique({
          where: { id: installmentId },
          include: {
            paymentCondition: true,
            bankAccount: { include: { bank: true } },
          },
        });

      // Registrar no histórico
      if (userId) {
        await this.historyService.createReceivableHistory({
          receivableId: result.receivableId,
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
      this.logger.error('Erro ao pagar parcela', error.stack);
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

  async undoPaymentInstallment(
    installmentId: string,
    userId?: string,
    userName?: string,
  ) {
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
      const previousStatus = installmentData.status;
      const previousPaidDate = installmentData.paidDate;
      const previousPaidAmount = installmentData.paidAmount;

      await this.prisma.$transaction(async (tx) => {
        // NOVO: Cancelar lançamentos de diferença criados para essa parcela
        const originalReceivable = await tx.receivable.findUnique({
          where: { id: installmentData.receivableId },
          select: { description: true },
        });

        const differenceDescriptionPattern = `Diferença no pagamento da parcela ${installmentData.installmentNumber} - ${originalReceivable?.description || 'Sem descrição'}`;

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
        await tx.receivableInstallment.update({
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
          // Busca a transação usando o transactionId da parcela (direto via FK)
          // ou fallback via relação reversa com `some`
          let relatedTransaction = null;
          if (installmentData.transactionId) {
            relatedTransaction = await tx.transaction.findUnique({
              where: { id: installmentData.transactionId },
            });
          }
          if (!relatedTransaction) {
            relatedTransaction = await tx.transaction.findFirst({
              where: {
                receivableInstallment: {
                  some: {
                    id: installmentId,
                  },
                },
              },
            });
          }

          if (relatedTransaction) {
            // Remove a transação de pagamento
            await tx.transaction.delete({
              where: { id: relatedTransaction.id },
            });

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
        }
      });

      await this.updateReceivableStatus(installmentData.receivableId);

      // Registrar no histórico
      if (userId) {
        await this.historyService.createReceivableHistory({
          receivableId: installmentData.receivableId,
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
        await this.prisma.receivableInstallment.findUnique({
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
      this.logger.error('Erro ao desfazer pagamento de parcela', error.stack);
      throw new BadRequestException(error.message);
    }
  }

  async updateInstallments(
    receivableId: string,
    dto: UpdateReceivableInstallmentsDto,
    userId?: string,
    userName?: string,
  ): Promise<any> {
    try {
      const { installments, totalAmount, changeNotes, changeReason } = dto;
      // let totalAmount = 0;

      // Capturar estado antes da alteração (incluindo o totalAmount do receivable)
      const receivableBefore = await this.prisma.receivable.findUnique({
        where: { id: receivableId },
        select: { totalAmount: true },
      });

      const installmentsBefore =
        await this.prisma.receivableInstallment.findMany({
          where: { receivableId },
          select: {
            id: true,
            installmentNumber: true,
            amount: true,
            dueDate: true,
            status: true,
          },
        });

      const updatedReceivable = await this.prisma.$transaction(
        async (prisma) => {
          // Buscar o receivable para obter o companyId
          const receivable = await prisma.receivable.findUnique({
            where: { id: receivableId },
            select: { companyId: true },
          });

          if (!receivable) {
            throw new NotFoundException('Receivable não encontrado.');
          }

          // Buscar conta bancária padrão para novas parcelas
          let defaultBankAccountId: string | null = null;
          const firstBankAccount = await prisma.bankAccount.findFirst({
            where: {
              companyId: receivable.companyId,
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
                const updatedInstallment =
                  await prisma.receivableInstallment.update({
                    where: { id: installmentDto.id },
                    data: updateData,
                  });
                updatedInstallments.push(updatedInstallment);
              } catch (error) {
                this.logger.error('Erro ao atualizar parcela', error.stack);
              }
            } else {
              const newInstallment = await prisma.receivableInstallment.create({
                data: {
                  receivableId,
                  amount: installmentDto.amount,
                  dueDate: new Date(installmentDto.dueDate),
                  status: 'PENDING',
                  paymentConditionId: installmentDto.paymentConditionId,
                  installmentNumber: installments.indexOf(installmentDto) + 1,
                  bankAccountId:
                    installmentDto.bankAccountId ||
                    defaultBankAccountId ||
                    null,
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

          // Atualiza a quantidade de parcelas
          updateData.installmentQty = allInstallments.length;

          if (Object.keys(updateData).length > 0) {
            await this.prisma.receivable.update({
              where: { id: receivableId },
              data: updateData,
            });
          }
        },
      );

      await this.updateReceivableStatus(receivableId);

      // Capturar estado depois da alteração
      const installmentsAfter =
        await this.prisma.receivableInstallment.findMany({
          where: { receivableId },
          select: {
            id: true,
            installmentNumber: true,
            amount: true,
            dueDate: true,
            status: true,
          },
        });

      // Gerar notas automáticas para as alterações
      const notesToAdd: string[] = [];

      // Verificar alterações individuais nas parcelas
      installmentsAfter.forEach((after) => {
        const before = installmentsBefore.find((b) => b.id === after.id);
        if (before) {
          // Verificar mudança de valor
          if (before.amount !== after.amount) {
            notesToAdd.push(
              FinancialNotesUtil.generateInstallmentValueChangeNote(
                after.installmentNumber,
                before.amount,
                after.amount,
              ),
            );
          }
          // Verificar mudança de data de vencimento
          if (before.dueDate.getTime() !== after.dueDate.getTime()) {
            notesToAdd.push(
              FinancialNotesUtil.generateInstallmentDueDateChangeNote(
                after.installmentNumber,
                before.dueDate,
                after.dueDate,
              ),
            );
          }
        }
      });

      // Verificar alteração no valor total
      if (
        totalAmount !== undefined &&
        receivableBefore?.totalAmount !== totalAmount
      ) {
        notesToAdd.push(
          FinancialNotesUtil.generateTotalAmountChangeNote(
            receivableBefore.totalAmount,
            totalAmount,
          ),
        );
      }

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

        // Adicionar nota sobre quantidade de parcelas alteradas
        // Só adiciona o resumo se houver parcelas adicionadas ou removidas
        // Modificações individuais já foram registradas acima
        if (addedCount > 0 || removedCount > 0) {
          const changeNote = FinancialNotesUtil.generateInstallmentChangesNote(
            addedCount,
            removedCount,
          );
          if (changeNote) {
            notesToAdd.push(changeNote);
          }
        }

        await this.historyService.createReceivableHistory({
          receivableId,
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
            totalAmountBefore: receivableBefore?.totalAmount,
            totalAmountAfter: totalAmount,
          },
          createdBy: userId,
          createdByName: userName,
        });
      }

      // Atualizar o campo notes com as alterações registradas
      if (notesToAdd.length > 0) {
        const currentReceivable = await this.prisma.receivable.findUnique({
          where: { id: receivableId },
          select: { notes: true },
        });

        const updatedNotes = FinancialNotesUtil.appendNote(
          currentReceivable.notes,
          FinancialNotesUtil.generateMultipleChangesNote(notesToAdd),
        );

        await this.prisma.receivable.update({
          where: { id: receivableId },
          data: { notes: updatedNotes },
        });
      }

      return updatedReceivable;
    } catch (error) {
      this.logger.error('Erro ao compensar parcela', error.stack);
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
      this.logger.warn(
        `Nenhuma parcela encontrada para a movimentação ${receivableId}`,
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
      this.logger.error(
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

  async getReceiptData(installmentId: string): Promise<ReceiptDataResponseDto> {
    // Buscar a parcela com todas as informações necessárias
    const installment = await this.prisma.receivableInstallment.findUnique({
      where: { id: installmentId },
      include: {
        paymentCondition: true,
        receivable: {
          include: {
            client: true,
          },
        },
      },
    });

    if (!installment) {
      throw new NotFoundException('Parcela não encontrada.');
    }

    // Buscar dados da empresa
    const company = await this.prisma.company.findUnique({
      where: { id: installment.receivable.companyId },
      select: {
        name: true,
        cnpj: true,
        email: true,
        phone: true,
        siteUrl: true,
        logoUrl: true,
        instagram: true,
        facebook: true,
        linkedin: true,
        address: {
          where: {
            type: 'Principal',
          },
          select: {
            street: true,
            number: true,
            complement: true,
            neighborhood: true,
            city: true,
            state: true,
            zipcode: true,
          },
        },
      },
    });

    if (!company) {
      throw new NotFoundException('Empresa não encontrada.');
    }

    // Calcular o valor total da parcela
    const totalValue =
      (installment.amount || 0) + (installment.additionalFee || 0);

    // Formatar data do recibo (usar data de pagamento se existir, senão data de vencimento)
    const receiptDate =
      installment.paidDate || installment.dueDate || new Date();

    const day = format(receiptDate, 'dd', { locale: ptBR });
    const month = format(receiptDate, 'MMMM', { locale: ptBR });
    const year = format(receiptDate, 'yyyy', { locale: ptBR });

    // Nome do cliente
    const clientName = installment.receivable.client?.name || 'Cliente';

    // Obter endereço principal da empresa
    const principalAddress = company.address?.[0];

    // Retornar dados do recibo (mesmo formato do PDF de orçamento)
    return {
      company: {
        name: company.name,
        cnpj: company.cnpj || '',
        email: company.email || '',
        siteUrl: company.siteUrl || undefined,
        address: principalAddress
          ? {
              street: principalAddress.street || '',
              number: principalAddress.number || '',
              complement: principalAddress.complement || undefined,
              neighborhood: principalAddress.neighborhood || '',
              city: principalAddress.city || '',
              state: principalAddress.state || '',
              zipCode: principalAddress.zipcode || '',
            }
          : {
              street: '',
              number: '',
              neighborhood: '',
              city: '',
              state: '',
              zipCode: '',
            },
        logo: company.logoUrl || undefined,
        socialNetworks: {
          instagram: company.instagram || undefined,
          facebook: company.facebook || undefined,
          linkedin: company.linkedin || undefined,
        },
      },
      clientName,
      totalValue,
      day,
      month,
      year,
      items: [
        {
          reference: String(installment.installmentNumber || 1).padStart(
            2,
            '0',
          ),
          description:
            installment.receivable.description || 'Descrição do serviço',
          date: format(installment.dueDate, 'dd/MM/yyyy', { locale: ptBR }),
          paymentMethod: installment.paymentCondition?.name || 'N/D',
          value: totalValue,
        },
      ],
    };
  }
}
