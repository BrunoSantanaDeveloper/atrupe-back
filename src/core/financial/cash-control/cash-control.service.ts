import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CloseCashRegisterDto,
  CreateCashRegisterDto,
} from './dto/create-cash-control.dto';
import { PrismaService } from 'nestjs-prisma';
import {
  EditCashRegisterDto,
  TransferDto,
} from './dto/update-cash-control.dto';
import { ListCashRegistersDto } from './dto/cash-control-filters.dto';
import { startOfDay, endOfDay } from 'date-fns';

@Injectable()
export class CashControlService {
  constructor(private readonly prisma: PrismaService) {}

  async openCashRegister(createCashRegisterDto: CreateCashRegisterDto) {
    const { companyId, openingDate, openingBalance, bankAccountId } =
      createCashRegisterDto;

    const date = openingDate ? startOfDay(new Date(openingDate)) : new Date();

    const existingRegister = await this.prisma.cashRegister.findFirst({
      where: {
        openingDate: date,
        bankAccountId,
        status: 'OPEN',
      },
    });

    if (existingRegister) {
      throw new BadRequestException(
        'Já existe um caixa aberto para essa data.',
      );
    }
    const cashControls = await this.prisma.bankAccountCashControl.findMany({
      where: {
        bankAccountId,
      },
    });

    if (!cashControls.length) {
      throw new BadRequestException(
        'Nenhuma configuração de método de pagamento encontrada para esta conta bancária.',
      );
    }

    return this.prisma.cashRegister.create({
      data: {
        openingDate: date,
        openingBalance,
        bankAccount: {
          connect: { id: bankAccountId },
        },
        company: {
          connect: {
            id: companyId,
          },
        },
        cashControls: {
          connect: cashControls.map((control) => ({ id: control.id })),
        },
      },
    });
  }

  async closeCashRegister(closeCashRegisterDto: CloseCashRegisterDto) {
    const { cashRegisterId, observation } = closeCashRegisterDto;

    const register = await this.prisma.cashRegister.findUnique({
      where: { id: cashRegisterId },
      include: { transactions: true },
    });

    if (!register || register.status === 'CLOSED') {
      throw new BadRequestException('Caixa inválido ou já fechado.');
    }

    const totalIncomes = register.transactions
      .filter((t) => t.type === 'INCOME')
      .reduce((sum, t) => sum + t.amount, 0);

    const totalOutcomes = register.transactions
      .filter((t) => t.type === 'OUTCOME')
      .reduce((sum, t) => sum + t.amount, 0);

    const closingBalance =
      register.openingBalance +
      totalIncomes -
      totalOutcomes +
      register.retroactive;

    return this.prisma.cashRegister.update({
      where: { id: cashRegisterId },
      data: {
        closingDate: new Date(),
        totalIncomes,
        totalOutcomes,
        closingBalance,
        observation,
        status: 'CLOSED',
      },
    });
  }

  async editCashRegister(editDto: EditCashRegisterDto) {
    const { cashRegisterId, type, amount, reason } = editDto;

    const cashRegister = await this.prisma.cashRegister.findUnique({
      where: { id: cashRegisterId },
    });

    if (!cashRegister || cashRegister.status !== 'OPEN') {
      throw new BadRequestException('Caixa inválido ou fechado.');
    }

    if (amount <= 0) {
      throw new BadRequestException('O valor deve ser maior que zero.');
    }

    // Atualizar valores do caixa com base no tipo de transação
    const updatedValues =
      type === 'INCOME'
        ? { totalIncomes: cashRegister.totalIncomes + amount }
        : { totalOutcomes: cashRegister.totalOutcomes + amount };

    // Registrar a transação e atualizar o caixa
    return this.prisma.$transaction([
      this.prisma.transaction.create({
        data: {
          cashRegisterId,
          type,
          amount,
          reason,
          transactionDate: new Date(),
        },
      }),
      this.prisma.cashRegister.update({
        where: { id: cashRegisterId },
        data: updatedValues,
      }),
    ]);
  }

  async transferFunds(transferDto: TransferDto) {
    const { sourceBankAccountId, targetBankAccountId, amount, transferMethod } =
      transferDto;

    const sourceCashRegister = await this.prisma.cashRegister.findFirst({
      where: {
        bankAccountId: sourceBankAccountId,
        status: 'OPEN',
        openingDate: {
          gte: startOfDay(new Date()),
          lt: endOfDay(new Date()),
        },
      },
      include: { bankAccount: true },
    });
    if (!sourceCashRegister || sourceCashRegister.status !== 'OPEN') {
      throw new BadRequestException('Caixa de origem inválido ou fechado.');
    }

    let targetCashRegister = await this.prisma.cashRegister.findFirst({
      where: {
        bankAccountId: targetBankAccountId,
        status: 'OPEN',
        openingDate: {
          gte: startOfDay(new Date()),
          lt: endOfDay(new Date()),
        },
      },
    });

    if (!targetCashRegister) {
      targetCashRegister = await this.prisma.cashRegister.create({
        data: {
          openingDate: new Date(),
          openingBalance: 0,
          bankAccount: {
            connect: { id: targetBankAccountId },
          },
          company: {
            connect: { id: sourceCashRegister.companyId },
          },
        },
      });
    }

    // Registrar transações em ambos os caixas
    return this.prisma.$transaction([
      this.prisma.transaction.create({
        data: {
          cashRegisterId: sourceCashRegister.id,
          type: 'OUTCOME',
          amount,
          description: `Transferência para caixa ${targetCashRegister.id}`,
          reason: transferMethod,
          transactionDate: new Date(),
        },
      }),
      this.prisma.transaction.create({
        data: {
          cashRegisterId: targetCashRegister.id,
          type: 'INCOME',
          amount,
          description: `Transferência do caixa ${sourceCashRegister.id}`,
          reason: transferMethod,
          transactionDate: new Date(),
        },
      }),
      this.prisma.cashRegister.update({
        where: { id: sourceCashRegister.id },
        data: {
          totalOutcomes: sourceCashRegister.totalOutcomes + amount,
        },
      }),
      this.prisma.cashRegister.update({
        where: { id: targetCashRegister.id },
        data: {
          totalIncomes: targetCashRegister.totalIncomes + amount,
        },
      }),
    ]);
  }

  async listCashRegisters(query: ListCashRegistersDto) {
    const {
      page = 1,
      limit = 10,
      bankAccountName,
      bankName,
      status,
      companyId,
    } = query;

    // Calcular offset para paginação
    const offset = (+page - 1) * +limit;

    // Construir os filtros dinamicamente
    const whereFilters: any = {};
    if (!companyId) throw new BadRequestException('Empresa não encontrada.');
    whereFilters.status = status;
    if (status) {
      whereFilters.status = status;
    }
    if (bankAccountName) {
      whereFilters.bankAccount = {
        name: { contains: bankAccountName, mode: 'insensitive' },
      };
    }

    if (bankName) {
      whereFilters.bankAccount = {
        ...whereFilters.bankAccount,
        bank: {
          name: { contains: bankName, mode: 'insensitive' },
        },
      };
    }

    // Consultar caixas abertos e agrupar por dia
    const cashRegisters = await this.prisma.cashRegister.findMany({
      where: whereFilters,
      include: {
        bankAccount: {
          include: { bank: true },
        },
      },
      orderBy: { openingDate: 'desc' },
      skip: offset,
      take: +limit,
    });

    // Agrupar por dia
    const groupedByDate = cashRegisters.reduce(
      (acc: Record<string, typeof cashRegisters>, register) => {
        const dateKey = register.openingDate.toISOString().split('T')[0];
        if (!acc[dateKey]) {
          acc[dateKey] = [];
        }
        acc[dateKey].push(register);
        return acc;
      },
      {},
    );

    // Formatar resposta
    const formattedData = Object.entries(groupedByDate).map(
      ([date, registers]) => ({
        date: new Date(date).toLocaleDateString('pt-BR', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        }),
        //TODO: Ajustar o retorno para incluir: movimentações: (totalIncomes - totalOutcomes)  e Saldo (abertura - movimentações)
        cashRegisters: (registers as typeof cashRegisters).map((register) => ({
          bankAccountName: register.bankAccount.name,
          bank: register.bankAccount.bank.name,
          status: register.status,
          openingBalance: register.openingBalance,
          totalIncomes: register.totalIncomes,
          totalOutcomes: register.totalOutcomes,
          retroactive: register.retroactive,
          closingBalance: register.closingBalance,
        })),
      }),
    );

    // Retornar dados com paginação
    const total = await this.prisma.cashRegister.count({ where: whereFilters });
    return {
      total,
      data: formattedData,
      currentPage: page,
      totalPages: Math.ceil(total / +limit),
    };
  }

  async findOneCashRegister(id: string) {
    const cashRegister = await this.prisma.cashRegister.findUnique({
      where: { id },
      include: {
        bankAccount: {
          include: { bank: true },
        },
        transactions: {
          orderBy: { transactionDate: 'desc' }, // Ordenar transações pela data
        },
      },
    });

    if (!cashRegister) {
      throw new NotFoundException('Caixa não encontrado.');
    }

    return {
      id: cashRegister.id,
      status: cashRegister.status,
      openingDate: cashRegister.openingDate,
      closingDate: cashRegister.closingDate,
      openingBalance: cashRegister.openingBalance,
      totalIncomes: cashRegister.totalIncomes,
      totalOutcomes: cashRegister.totalOutcomes,
      retroactive: cashRegister.retroactive,
      closingBalance: cashRegister.closingBalance,
      bankAccount: {
        name: cashRegister.bankAccount.name,
        bank: cashRegister.bankAccount.bank.name,
      },
      transactions: cashRegister.transactions.map((transaction) => ({
        id: transaction.id,
        type: transaction.type,
        amount: transaction.amount,
        reason: transaction.reason,
        date: transaction.transactionDate,
      })),
    };
  }
}
