import { Injectable } from '@nestjs/common';
import { CreateBankDto } from './dto/create-bank.dto';
import { UpdateBankDto } from './dto/update-bank.dto';
import { PrismaService } from 'nestjs-prisma';

@Injectable()
export class BankService {
  constructor(private readonly prisma: PrismaService) {}

  create(createBankDto: CreateBankDto) {
    return this.prisma.bank.create({
      data: {
        ...createBankDto,
      },
    });
  }

  findAll() {
    return this.prisma.bank.findMany({
      where: {
        isActive: true,
      },
      orderBy: {
        name: 'asc',
      },
    });
  }
  findAllByCondition(paymentCondition: string) {
    return this.prisma.bank.findMany({
      where: {
        isActive: true,
        accounts: {
          some: {
            bankAccountCashControl: {
              some: {
                paymentCondition: {
                  id: paymentCondition,
                },
              },
            },
          },
        },
      },
      orderBy: {
        name: 'asc',
      },
    });
  }

  findOne(id: string) {
    return this.prisma.bank.findUnique({ where: { id } });
  }

  update(id: string, updateBankDto: UpdateBankDto) {
    return this.prisma.bank.update({ data: updateBankDto, where: { id } });
  }

  remove(id: string) {
    return this.prisma.bank.update({
      where: { id },
      data: {
        isActive: false,
      },
    });
  }

  async getBankAccountsInUse(companyId: string) {
    const receivableBankAccounts =
      await this.prisma.receivableInstallment.findMany({
        where: {
          receivable: {
            companyId: companyId,
          },
          bankAccountId: {
            not: null,
          },
        },
        select: {
          bankAccount: {
            include: {
              bank: true,
            },
          },
        },
        distinct: ['bankAccountId'],
      });

    const payableBankAccounts = await this.prisma.payableInstallment.findMany({
      where: {
        payable: {
          companyId: companyId,
        },
        bankAccountId: {
          not: null,
        },
      },
      select: {
        bankAccount: {
          include: {
            bank: true,
          },
        },
      },
      distinct: ['bankAccountId'],
    });

    const allBankAccounts = [
      ...receivableBankAccounts.map((item) => item.bankAccount),
      ...payableBankAccounts.map((item) => item.bankAccount),
    ];

    const uniqueBankAccounts = allBankAccounts.filter(
      (account, index, self) =>
        account && self.findIndex((a) => a?.id === account.id) === index,
    );

    return uniqueBankAccounts;
  }
}
