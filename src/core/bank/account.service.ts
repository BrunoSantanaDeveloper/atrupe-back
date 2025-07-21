import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { CreateBankAccountDto } from './dto/create-account.dto';
import { BankAccountFilterDTO } from './dto/filter-account.dto';
import { BankAccount, Prisma } from '@prisma/client';
import { UpdateBankAccountDto } from './dto/update-bank.dto';
import { endOfDay, startOfDay } from 'date-fns';

@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateBankAccountDto): Promise<BankAccount> {
    try {
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
    } catch (error) {
      console.error(error);
      throw new BadRequestException('Error on create bank account');
    }
  }

  async findAll(filter: BankAccountFilterDTO) {
    const { cashControl } = filter;
    try {
      let where: Prisma.BankAccountWhereInput = {};
      where = { ...where, isActive: true };
      if (filter.companyId) {
        where = { ...where, companyId: filter.companyId };
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
                paymentMethod: {
                  select: {
                    id: true,
                    name: true,
                    description: true,
                  },
                },
              },
              orderBy: {
                paymentMethod: {
                  name: 'asc',
                },
              },
            },
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
          take: +filter.limit || 10,
          skip: ((+filter.page || 1) - 1) * +filter.limit,
        }),
        this.prisma.paymentMethod.findMany({
          where: {
            companyId: filter.companyId,
            isActive: true,
          },
          select: {
            id: true,
            name: true,
            description: true,
          },
        }),
      ]);

      const mappedData = data.map((account) => {
        const existingPaymentMethodIds = account.bankAccountCashControl.map(
          (control) => control.paymentMethod.id,
        );

        const missingPaymentMethods = allPaymentMethods.filter(
          (method) => !existingPaymentMethodIds.includes(method.id),
        );

        const updatedBankAccountCashControl = [
          ...account.bankAccountCashControl.map((control) => ({
            ...control,
            paymentMethod: {
              ...control.paymentMethod,
            },
          })),
          ...missingPaymentMethods.map((method) => ({
            paymentMethodId: method.id,
            paymentMethod: method,
          })),
        ];

        return {
          ...account,
          bankAccountCashControl: updatedBankAccountCashControl,
        };
      });

      return {
        total,
        lastPage: Math.ceil(total / +filter.limit),
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

          const currentCashControl = existingAccount.cashControl;
          const { cashControl, bankAccountCashControl, ...updateFields } =
            updateBankAccountDto;
          const finalCashControl =
            cashControl !== undefined ? cashControl : currentCashControl;

          if (bankAccountCashControl !== undefined) {
            const itemsToUpdate = bankAccountCashControl.filter(
              (item) => item.id,
            );
            const itemsToCreate = bankAccountCashControl.filter(
              (item) => !item.id,
            );

            // Validate existing items in batch
            if (itemsToUpdate.length > 0) {
              const existingItems = await tx.bankAccountCashControl.findMany({
                where: { id: { in: itemsToUpdate.map((item) => item.id) } },
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
                      paymentMethodId: item.paymentMethodId,
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
                  paymentMethodId: item.paymentMethodId,
                  bankAccountId: accountId,
                })),
              });
            }
          }

          const updatedAccount = await tx.bankAccount.update({
            where: { id: accountId },
            data: {
              ...updateFields,
              ...(cashControl !== undefined && {
                cashControl: finalCashControl,
              }),
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
      console.error(error);
      throw new BadRequestException('Error updating bank account');
    }
  }

  remove(accountId: string) {
    try {
      return this.prisma.bankAccount.update({
        where: { id: accountId },
        data: { isActive: false },
      });
    } catch (error) {
      console.error(error);
      throw new BadRequestException('Error removing bank account');
    }
  }
}
