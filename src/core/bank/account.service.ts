import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import {
  BankAccountCashControlDto,
  CreateBankAccountDto,
} from './dto/create-account.dto';
import { BankAccountFilterDTO } from './dto/filter-account.dto';
import { BankAccount, BankAccountKind, Prisma } from '@prisma/client';
import { UpdateBankAccountDto } from './dto/update-bank.dto';
import { endOfDay, startOfDay } from 'date-fns';
import { assertBelongsToCompany } from 'src/shared/tenant/company-scope';
import { CashDayService } from '../financial/cash-control/cash-day.service';
import { toCents, toReais } from '../financial/cash-control/cash-ledger';

const ACCOUNT_NOT_FOUND = 'Conta não encontrada';

/** O "banco" das contas de operadora de cartão. */
const CARD_OPERATOR_BANK = { code: 'CARD', name: 'Operadora de cartão' };

const bad = (message: string): never => {
  throw new BadRequestException(message);
};

const dateColumn = (day: string) => new Date(`${day}T00:00:00.000Z`);

/**
 * As contas bancárias. O caixa do dia (Fase 7.1) acrescenta o tipo (CASH,
 * BANK, CARD), a contagem às cegas e a tolerância da gaveta, o saldo
 * inicial com a data, a conta padrão por forma e o saldo calculado. Os
 * valores novos vão em centavos na API; no banco, reais, como o caixa.
 */
@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cashDay: CashDayService,
  ) {}

  /**
   * As regras do caixa da conta (CX-3): a operadora não tem controle; a
   * contagem às cegas e a tolerância só valem na gaveta com controle.
   */
  private accountRules(
    dto: Partial<CreateBankAccountDto>,
    stored?: { kind: string; cashControl: boolean },
  ) {
    const kind = (dto.kind ?? stored?.kind ?? 'BANK') as BankAccountKind;
    const cashControl =
      kind === 'CARD'
        ? false
        : (dto.cashControl ?? stored?.cashControl ?? false);
    const drawer = kind === 'CASH' && cashControl;
    return {
      kind,
      cashControl,
      ...(dto.blindCount !== undefined || !drawer
        ? { blindCount: drawer && !!dto.blindCount }
        : {}),
      ...(dto.shortageTolerance !== undefined || !drawer
        ? {
            shortageTolerance:
              drawer &&
              dto.shortageTolerance !== null &&
              dto.shortageTolerance !== undefined
                ? toReais(dto.shortageTolerance)
                : null,
          }
        : {}),
    };
  }

  /** A data do saldo inicial vem junto com o saldo (CX-2). */
  private openingOf(dto: Partial<CreateBankAccountDto>) {
    if (dto.openingBalance === undefined && dto.openingDate === undefined) {
      return {};
    }
    if (dto.openingBalance && !dto.openingDate) {
      bad('Informe a data do saldo inicial');
    }
    return {
      ...(dto.openingBalance !== undefined
        ? { openingBalance: toReais(dto.openingBalance) }
        : {}),
      ...(dto.openingDate !== undefined
        ? { openingDate: dto.openingDate ? dateColumn(dto.openingDate) : null }
        : {}),
    };
  }

  /**
   * O banco genérico da operadora de cartão (código CARD), como o 000 da
   * gaveta: a conta CARD não escolhe banco. A migration o cria; aqui ele
   * nasce se faltar (o seed do homolog pode ter rodado antes).
   */
  private async cardOperatorBankId() {
    const existing = await this.prisma.bank.findFirst({
      where: { code: CARD_OPERATOR_BANK.code },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await this.prisma.bank.create({
      data: CARD_OPERATOR_BANK,
      select: { id: true },
    });
    return created.id;
  }

  /** A padrão só vale onde a conta recebe (CX-2). */
  private ruleDefault(rule: BankAccountCashControlDto) {
    return !!rule.isDefault && rule.acceptIncomes !== false;
  }

  /**
   * Conta padrão única por forma: marcar esta desmarca a mesma forma nas
   * outras contas da empresa (CX-2).
   */
  private async clearOtherDefaults(
    tx: Prisma.TransactionClient,
    companyId: string,
    accountId: string,
    rules: BankAccountCashControlDto[] | undefined,
  ) {
    const conditions = (rules ?? [])
      .filter((rule) => this.ruleDefault(rule))
      .map((rule) => rule.paymentConditionId);
    if (!conditions.length) return;
    await tx.bankAccountCashControl.updateMany({
      where: {
        paymentConditionId: { in: conditions },
        bankAccountId: { not: accountId },
        bankAccount: { companyId },
      },
      data: { isDefault: false },
    });
  }

  async create(dto: CreateBankAccountDto): Promise<BankAccount> {
    await assertBelongsToCompany(
      this.prisma.paymentCondition,
      dto.bankAccountCashControl?.map((item) => item.paymentConditionId),
      { companyId: dto.companyId },
      'Condição de pagamento não encontrada.',
    );
    if (!dto.name?.trim()) bad('Dê um nome para a conta');
    const rules = this.accountRules(dto);
    const opening = this.openingOf(dto);
    const bankId =
      dto.bankId ??
      (rules.kind === 'CARD'
        ? await this.cardOperatorBankId()
        : bad('Escolha o banco da conta'));

    const settlementAccountId =
      rules.kind === 'CARD'
        ? await this.settlementOf(dto.companyId, dto.settlementAccountId)
        : null;

    return this.prisma.$transaction(async (tx) => {
      const bankAccount = await tx.bankAccount.create({
        data: {
          name: dto.name.trim(),
          bankId,
          operator: rules.kind === 'CARD' ? dto.operator?.trim() || null : null,
          settlementAccountId,
          companyId: dto.companyId,
          description: dto.description,
          ...rules,
          ...opening,
          bankAccountCashControl: {
            createMany: {
              data: (dto.bankAccountCashControl ?? []).map((rule) => ({
                acceptPayments: rule.acceptPayments,
                paymentType: rule.paymentType,
                acceptIncomes: rule.acceptIncomes,
                incomeType: rule.incomeType,
                paymentConditionId: rule.paymentConditionId,
                isDefault: this.ruleDefault(rule),
              })),
            },
          },
        },
      });
      await this.clearOtherDefaults(
        tx,
        dto.companyId,
        bankAccount.id,
        dto.bankAccountCashControl,
      );
      return bankAccount;
    });
  }

  /** Tem lançamento, caixa do dia ou parcela baixada nela (CX-2). */
  private async historyOf(accountIds: string[]) {
    if (!accountIds.length) return new Set<string>();
    const [transactions, registers, receivables, payables] = await Promise.all([
      this.prisma.transaction.groupBy({
        by: ['bankAccountId'],
        where: { bankAccountId: { in: accountIds } },
      }),
      this.prisma.cashRegister.groupBy({
        by: ['bankAccountId'],
        where: { bankAccountId: { in: accountIds } },
      }),
      this.prisma.receivableInstallment.groupBy({
        by: ['bankAccountId'],
        where: { bankAccountId: { in: accountIds } },
      }),
      this.prisma.payableInstallment.groupBy({
        by: ['bankAccountId'],
        where: { bankAccountId: { in: accountIds } },
      }),
    ]);
    return new Set(
      [...transactions, ...registers, ...receivables, ...payables]
        .map((row) => row.bankAccountId)
        .filter((id): id is string => !!id),
    );
  }

  async findAll(filter: BankAccountFilterDTO, values = false) {
    const { cashControl } = filter;
    try {
      let where: Prisma.BankAccountWhereInput = {};
      // Sem o filtro, só as ativas, como sempre
      if (filter.isActive !== 'all') {
        where = { ...where, isActive: filter.isActive !== 'false' };
      }
      if (filter.companyId) {
        where = { ...where, companyId: filter.companyId };
      }
      if (filter.kind) {
        where = { ...where, kind: filter.kind };
      }

      if (filter.bankId) {
        where = { ...where, bankId: filter.bankId };
      }

      if (cashControl !== undefined) {
        where = {
          ...where,
          cashControl: cashControl,
        };
      }
      const bankAccountCashControlConditions = [];
      if (filter.acceptIncomes) {
        bankAccountCashControlConditions.push({
          acceptIncomes: filter.acceptIncomes,
        });
      }

      if (filter.acceptPayments) {
        bankAccountCashControlConditions.push({
          acceptPayments: filter.acceptPayments,
        });
      }

      if (bankAccountCashControlConditions.length > 0) {
        where = {
          ...where,
          bankAccountCashControl: {
            some: {
              OR: bankAccountCashControlConditions,
            },
          },
        };
      }

      const limit = Math.min(100, +filter.limit || 10);
      const page = +filter.page || 1;
      const [total, data, allPaymentMethods] = await Promise.all([
        this.prisma.bankAccount.count({ where: where }),
        this.prisma.bankAccount.findMany({
          where: where,
          include: {
            bank: {
              select: {
                id: true,
                name: true,
                code: true,
                icon: true,
              },
            },
            bankAccountCashControl: {
              include: {
                paymentCondition: {
                  select: {
                    id: true,
                    name: true,
                    paymentMethod: {
                      select: {
                        id: true,
                        name: true,
                      },
                    },
                  },
                },
              },
              orderBy: {
                paymentCondition: {
                  name: 'asc',
                },
              },
            },
            // A conta onde a operadora deposita (12/11/2026)
            settlementAccount: { select: { id: true, name: true } },
            cashRegister: {
              where: {
                status: 'OPEN',
                openingDate: {
                  gte: startOfDay(new Date()),
                  lt: endOfDay(new Date()),
                },
              },
              select: {
                id: true,
              },
            },
          },
          orderBy: { name: 'asc' },
          take: limit,
          skip: (page - 1) * limit,
        }),
        this.prisma.paymentCondition.findMany({
          where: {
            companyId: filter.companyId,
            isActive: true,
          },
          select: {
            id: true,
            name: true,
            paymentMethod: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        }),
      ]);
      const history = await this.historyOf(data.map((account) => account.id));

      const mappedData = await Promise.all(
        data.map(async (account) => {
          const existingPaymentConditionIds =
            account.bankAccountCashControl.map(
              (control) => control.paymentCondition.id,
            );

          const missingPaymentConditions = allPaymentMethods.filter(
            (condition) => !existingPaymentConditionIds.includes(condition.id),
          );

          const updatedBankAccountCashControl = [
            ...account.bankAccountCashControl.map((control) => ({
              ...control,
              paymentCondition: {
                ...control.paymentCondition,
              },
            })),
            ...missingPaymentConditions.map((condition) => ({
              paymentConditionId: condition.id,
              paymentCondition: condition,
              isDefault: false,
            })),
          ];

          return {
            ...account,
            // Os valores novos em centavos (contrato); no banco, reais
            shortageTolerance: toCents(account.shortageTolerance),
            openingBalance: toCents(account.openingBalance) ?? 0,
            openingDate: account.openingDate
              ? account.openingDate.toISOString().slice(0, 10)
              : null,
            hasHistory: history.has(account.id),
            // O saldo é informação financeira: sem ver valores, não sai
            ...(values
              ? { balance: await this.cashDay.accountBalance(account) }
              : {}),
            bankAccountCashControl: updatedBankAccountCashControl,
          };
        }),
      );

      return {
        total,
        page,
        lastPage: Math.ceil(total / limit),
        data: mappedData,
      };
    } catch (e) {
      console.error(e);
      throw new BadRequestException('Error on find bank accounts');
    }
  }

  async update(
    accountId: string,
    updateBankAccountDto: UpdateBankAccountDto,
  ): Promise<BankAccount> {
    // As condições dos controles de caixa precisam ser da empresa da conta
    const owner = await this.prisma.bankAccount.findUnique({
      where: { id: accountId },
      select: {
        companyId: true,
        kind: true,
        cashControl: true,
        openingDate: true,
        openingBalance: true,
      },
    });
    if (!owner) throw new NotFoundException(ACCOUNT_NOT_FOUND);
    await assertBelongsToCompany(
      this.prisma.paymentCondition,
      updateBankAccountDto.bankAccountCashControl?.map(
        (item) => item.paymentConditionId,
      ),
      { companyId: owner.companyId },
      'Condição de pagamento não encontrada.',
    );
    if (
      updateBankAccountDto.name !== undefined &&
      !updateBankAccountDto.name.trim()
    ) {
      bad('Dê um nome para a conta');
    }
    const opening = this.openingOf(updateBankAccountDto);
    // O saldo inicial (valor e data) não muda pela rota comum depois que a
    // conta tem lançamentos: muda a abertura de todos os caixas seguintes
    // (revisão de 23/10/2026). Mandar o mesmo valor não é troca
    const dateChanged =
      'openingDate' in opening &&
      (opening.openingDate?.getTime() ?? null) !==
        (owner.openingDate?.getTime() ?? null);
    const balanceChanged =
      'openingBalance' in opening &&
      updateBankAccountDto.openingBalance !== toCents(owner.openingBalance);
    if (
      (dateChanged || balanceChanged) &&
      (await this.historyOf([accountId])).has(accountId)
    ) {
      bad(
        dateChanged
          ? 'A data do saldo inicial não muda depois que a conta tem lançamentos'
          : 'O saldo inicial não muda depois que a conta tem lançamentos',
      );
    }
    const rules = this.accountRules(updateBankAccountDto, owner);

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const existingAccount = await tx.bankAccount.findUnique({
            where: { id: accountId },
            include: { bankAccountCashControl: true },
          });

          if (!existingAccount) {
            throw new NotFoundException(
              `Conta bancária com ID '${accountId}' não encontrada.`,
            );
          }

          const { bankAccountCashControl } = updateBankAccountDto;

          if (bankAccountCashControl !== undefined) {
            const itemsToUpdate = bankAccountCashControl.filter(
              (item) => item.id,
            );
            const itemsToCreate = bankAccountCashControl.filter(
              (item) => !item.id,
            );

            // Validate existing items in batch
            if (itemsToUpdate.length > 0) {
              // Só os controles desta conta: o de outra conta (de outra
              // empresa inclusive) conta como não encontrado
              const existingItems = await tx.bankAccountCashControl.findMany({
                where: {
                  id: { in: itemsToUpdate.map((item) => item.id) },
                  bankAccountId: accountId,
                },
              });

              if (existingItems.length !== itemsToUpdate.length) {
                const foundIds = existingItems.map((item) => item.id);
                const missingIds = itemsToUpdate
                  .map((item) => item.id)
                  .filter((id) => !foundIds.includes(id));
                throw new NotFoundException(
                  `Controles de caixa com IDs '${missingIds.join(', ')}' não encontrados.`,
                );
              }

              // Batch update existing items
              await Promise.all(
                itemsToUpdate.map((item) =>
                  tx.bankAccountCashControl.update({
                    where: { id: item.id },
                    data: {
                      acceptPayments: item.acceptPayments,
                      paymentType: item.paymentType,
                      acceptIncomes: item.acceptIncomes,
                      incomeType: item.incomeType,
                      paymentConditionId: item.paymentConditionId,
                      ...(item.isDefault !== undefined
                        ? { isDefault: this.ruleDefault(item) }
                        : {}),
                    },
                  }),
                ),
              );
            }

            // Batch create new items
            if (itemsToCreate.length > 0) {
              await tx.bankAccountCashControl.createMany({
                data: itemsToCreate.map((item) => ({
                  acceptPayments: item.acceptPayments,
                  paymentType: item.paymentType,
                  acceptIncomes: item.acceptIncomes,
                  incomeType: item.incomeType,
                  paymentConditionId: item.paymentConditionId,
                  bankAccountId: accountId,
                  isDefault: this.ruleDefault(item),
                })),
              });
            }
            await this.clearOtherDefaults(
              tx,
              owner.companyId,
              accountId,
              bankAccountCashControl,
            );
          }

          const updatedAccount = await tx.bankAccount.update({
            where: { id: accountId },
            data: {
              ...(updateBankAccountDto.name !== undefined
                ? { name: updateBankAccountDto.name.trim() }
                : {}),
              ...(updateBankAccountDto.bankId !== undefined
                ? { bankId: updateBankAccountDto.bankId }
                : {}),
              // O nome da operadora só vale na conta CARD
              ...(updateBankAccountDto.operator !== undefined ||
              (updateBankAccountDto.kind !== undefined && rules.kind !== 'CARD')
                ? {
                    operator:
                      rules.kind === 'CARD'
                        ? updateBankAccountDto.operator?.trim() || null
                        : null,
                  }
                : {}),
              // A conta onde cai só vale na CARD
              ...(updateBankAccountDto.settlementAccountId !== undefined ||
              (updateBankAccountDto.kind !== undefined && rules.kind !== 'CARD')
                ? {
                    settlementAccountId:
                      rules.kind === 'CARD'
                        ? await this.settlementOf(
                            owner.companyId,
                            updateBankAccountDto.settlementAccountId,
                            accountId,
                          )
                        : null,
                  }
                : {}),
              ...(updateBankAccountDto.description !== undefined
                ? { description: updateBankAccountDto.description }
                : {}),
              ...(updateBankAccountDto.kind !== undefined ||
              updateBankAccountDto.cashControl !== undefined
                ? { kind: rules.kind, cashControl: rules.cashControl }
                : {}),
              ...('blindCount' in rules
                ? { blindCount: rules.blindCount }
                : {}),
              ...('shortageTolerance' in rules
                ? { shortageTolerance: rules.shortageTolerance }
                : {}),
              ...opening,
            },
            include: { bankAccountCashControl: true },
          });

          return updatedAccount;
        },
        {
          timeout: 10000, // Increase timeout to 10 seconds
        },
      );
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      console.error(error);
      throw new BadRequestException('Error updating bank account');
    }
  }

  /**
   * Inativar exige saldo zero e nenhum caixa aberto (CX-2): o dinheiro não
   * pode sumir junto com a conta.
   */
  private async assertCanInactivate(accountId: string) {
    const account = await this.prisma.bankAccount.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        cashControl: true,
        kind: true,
        openingBalance: true,
        openingDate: true,
      },
    });
    if (!account) throw new NotFoundException(ACCOUNT_NOT_FOUND);
    if ((await this.cashDay.accountBalance(account)) !== 0) {
      throw new ConflictException(
        'A conta tem saldo. Transfira o saldo para outra conta antes de inativar',
      );
    }
    const open = await this.prisma.cashRegister.count({
      where: { bankAccountId: accountId, status: 'OPEN' },
    });
    if (open) {
      throw new ConflictException(
        'Feche o caixa desta conta antes de inativar',
      );
    }
    // A operadora que deposita aqui ficaria sem conta onde cai
    const cards = await this.prisma.bankAccount.findMany({
      where: { settlementAccountId: accountId, isActive: true },
      select: { name: true },
    });
    if (cards.length) {
      throw new ConflictException(
        `${cards.map((card) => card.name).join(', ')} ${cards.length === 1 ? 'deposita' : 'depositam'} nesta conta. Troque a conta onde cai ${cards.length === 1 ? 'da operadora' : 'das operadoras'} antes de inativar.`,
      );
    }
  }

  /**
   * A conta onde a operadora deposita (12/11/2026): da empresa, ativa, que
   * não é outra operadora nem a própria. Nula tira a ligação.
   */
  private async settlementOf(
    companyId: string,
    settlementAccountId: string | null | undefined,
    selfId?: string,
  ): Promise<string | null> {
    if (!settlementAccountId) return null;
    if (settlementAccountId === selfId) {
      bad('A operadora não deposita nela mesma: escolha a conta do banco');
    }
    const target = await this.prisma.bankAccount.findFirst({
      where: { id: settlementAccountId, companyId },
      select: { id: true, kind: true, isActive: true },
    });
    if (!target) throw new NotFoundException('Conta onde cai não encontrada');
    if (!target.isActive) bad('A conta onde cai está inativa: escolha outra');
    if (target.kind === 'CARD') {
      bad('A conta onde cai é a do banco, não outra operadora de cartão');
    }
    return target.id;
  }

  /** Um botão só: sem histórico exclui, com histórico inativa (CX-2). */
  async remove(accountId: string) {
    const history = await this.historyOf([accountId]);
    if (!history.has(accountId)) {
      await this.prisma.$transaction([
        this.prisma.bankAccountCashControl.deleteMany({
          where: { bankAccountId: accountId },
        }),
        this.prisma.bankAccount.delete({ where: { id: accountId } }),
      ]);
      return { removed: 'DELETED' as const };
    }
    await this.assertCanInactivate(accountId);
    await this.prisma.bankAccount.update({
      where: { id: accountId },
      data: { isActive: false },
    });
    return { removed: 'INACTIVATED' as const };
  }

  /** Reativa; inativar por aqui segue as regras do excluir. */
  async toggleStatus(accountId: string, active = true) {
    if (!active) await this.assertCanInactivate(accountId);
    return this.prisma.bankAccount.update({
      where: { id: accountId },
      data: { isActive: active },
      select: { id: true, name: true, isActive: true },
    });
  }
}
