import { Injectable } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { CreateBankAccountDto } from './dto/create-account.dto';
import { BankAccountFilterDTO } from './dto/filter-account.dto';
import { BankAccount } from '@prisma/client';

@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateBankAccountDto): Promise<BankAccount> {
    const bankAccount = await this.prisma.bankAccount.create({
      data: {
        name: dto.name,
        bankId: dto.bankId,
        companyId: dto.companyId,
        description: dto.description,
        cashControl: dto.cashControl,
        bankAccountCashControl: {
          createMany: {
            data: dto.bankAccountCashControl,
          },
        },
      },
    });

    return bankAccount;
  }

  findAll(filter: BankAccountFilterDTO) {
    try {
      let where = {};
      if (filter.companyId) {
        where = { ...where, companyId: filter.companyId };
      }

      if (filter.bankId) {
        where = { ...where, bankId: filter.bankId };
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

      return this.prisma.bankAccount.findMany({
        where: where,
        include: {
          bank: true,
          bankAccountCashControl: {
            include: {
              paymentMethod: true,
            },
          },
        },
        take: +filter.limit || undefined,
        skip: ((+filter.page || 1) - 1) * +filter.limit,
      });
    } catch (e) {
      console.error(e);
      throw e;
    }
  }
}
