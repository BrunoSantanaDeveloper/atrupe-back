import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';

@Injectable()
export class SalaryExpenseService {
  private readonly logger = new Logger(SalaryExpenseService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findSalaryCategories(companyId: string) {
    try {
      const nature = await this.prisma.nature.findFirst({
        where: {
          companyId,
          isActive: true,
          description: {
            contains: 'Colaboradores',
            mode: 'insensitive',
          },
        },
      });

      if (!nature) {
        this.logger.warn(
          `Natureza "Colaboradores / RH" não encontrada para empresa ${companyId}`,
        );
        return {
          natureId: null,
          subCategoryId: null,
        };
      }

      const subCategory = await this.prisma.subCategory.findFirst({
        where: {
          companyId,
          isActive: true,
          natureId: nature.id,
          description: {
            contains: 'Salários',
            mode: 'insensitive',
          },
        },
      });

      if (!subCategory) {
        this.logger.warn(
          `Subcategoria "Salários" não encontrada para natureza "${nature.description}" na empresa ${companyId}`,
        );
      }

      return {
        natureId: nature.id,
        subCategoryId: subCategory?.id || null,
      };
    } catch (error) {
      this.logger.warn(
        `Erro ao buscar categorias de salário: ${error.message}`,
      );
      return {
        natureId: null,
        subCategoryId: null,
      };
    }
  }

  async createSalaryExpense(payroll: any, netAmount: number) {
    try {
      if (netAmount < 0) {
        this.logger.log(
          `Despesa de salário não criada (valor negativo): R$ ${(netAmount / 100).toFixed(2)}`,
        );
        return null;
      }

      const referenceDate = new Date(payroll.year, payroll.month, 1);
      const dueDate = new Date(payroll.year, payroll.month, 5);

      const { natureId, subCategoryId } = await this.findSalaryCategories(
        payroll.companyId,
      );

      const defaultBankAccount = await this.prisma.bankAccount.findFirst({
        where: {
          companyId: payroll.companyId,
          isActive: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
      });
      const defaultBankAccountId = defaultBankAccount?.id || null;

      const payable = await this.prisma.payable.create({
        data: {
          referenceDate: referenceDate,
          description: `Folha ${String(payroll.month + 1).padStart(2, '0')}/${payroll.year} - Salário`,
          totalAmount: netAmount,
          totalValue: netAmount,
          mainAdditionalFee: 0,
          installmentQty: 1,
          status: 'PENDING',
          companyId: payroll.companyId,
          expenseSource: 'EMPLOYEE',
          employeeId: payroll.employeeId,
          natureId,
          subCategoryId,
        },
      });

      await this.prisma.payableInstallment.create({
        data: {
          payableId: payable.id,
          installmentNumber: 1,
          dueDate: dueDate,
          amount: netAmount,
          additionalFee: 0,
          bankAccountId: defaultBankAccountId,
          status: 'PENDING',
        },
      });

      this.logger.log(
        `Despesa de salário criada automaticamente: ${payable.id} - R$ ${(netAmount / 100).toFixed(2)}`,
      );

      return payable;
    } catch (error) {
      this.logger.error(`Erro ao criar despesa de salário: ${error.message}`);
    }
  }

  async createAdvanceExpense(
    payroll: any,
    amount: number,
    description: string,
  ) {
    try {
      const currentDate = new Date();
      const referenceDate = new Date(payroll.year, payroll.month, 1);

      const { natureId, subCategoryId } = await this.findSalaryCategories(
        payroll.companyId,
      );

      const defaultBankAccount = await this.prisma.bankAccount.findFirst({
        where: {
          companyId: payroll.companyId,
          isActive: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
      });
      const defaultBankAccountId = defaultBankAccount?.id || null;

      const payable = await this.prisma.payable.create({
        data: {
          referenceDate,
          description: `Folha ${String(payroll.month + 1).padStart(2, '0')}/${payroll.year} - ${description}`,
          totalAmount: amount,
          totalValue: amount,
          mainAdditionalFee: 0,
          installmentQty: 1,
          status: 'PENDING',
          companyId: payroll.companyId,
          expenseSource: 'EMPLOYEE',
          financialType: 'ADVANCE',
          employeeId: payroll.employeeId,
          natureId,
          subCategoryId,
        },
      });

      await this.prisma.payableInstallment.create({
        data: {
          payableId: payable.id,
          installmentNumber: 1,
          dueDate: currentDate,
          amount: amount,
          additionalFee: 0,
          bankAccountId: defaultBankAccountId,
          status: 'PENDING',
        },
      });

      this.logger.log(
        `Despesa criada automaticamente para adiantamento: ${payable.id}`,
      );

      return payable;
    } catch (error) {
      this.logger.error(
        `Erro ao criar despesa para adiantamento: ${error.message}`,
      );
    }
  }

  async updateSalaryExpense(payroll: any) {
    try {
      const salaryDescription = `Folha ${String(payroll.month + 1).padStart(2, '0')}/${payroll.year} - Salário`;

      const existingSalaryPayable = await this.prisma.payable.findFirst({
        where: {
          companyId: payroll.companyId,
          employeeId: payroll.employeeId,
          expenseSource: 'EMPLOYEE',
          description: salaryDescription,
        },
        include: {
          installments: true,
        },
      });

      if (existingSalaryPayable) {
        const currentItems = await this.prisma.payrollItem.findMany({
          where: { payrollId: payroll.id },
        });

        const totalIncreases = currentItems
          .filter((item) => item.type === 'INCREASE')
          .reduce((sum, item) => sum + item.amount, 0);

        const totalDiscounts = currentItems
          .filter((item) => item.type === 'DISCOUNT')
          .reduce((sum, item) => sum + item.amount, 0);

        const totalAdvances = currentItems
          .filter((item) => item.type === 'ADVANCE')
          .reduce((sum, item) => sum + item.amount, 0);

        const newNetSalary = totalIncreases - totalDiscounts - totalAdvances;
        const expenseAmount = newNetSalary < 0 ? 0 : newNetSalary;

        if (
          expenseAmount !== existingSalaryPayable.totalAmount &&
          expenseAmount >= 0
        ) {
          await this.prisma.$transaction(async (prisma) => {
            await prisma.payable.update({
              where: { id: existingSalaryPayable.id },
              data: {
                totalAmount: expenseAmount,
                totalValue: expenseAmount,
              },
            });

            if (existingSalaryPayable.installments.length > 0) {
              await prisma.payableInstallment.update({
                where: { id: existingSalaryPayable.installments[0].id },
                data: {
                  amount: expenseAmount,
                },
              });
            }
          });

          this.logger.log(
            `Despesa de salário atualizada: ${existingSalaryPayable.id} - Novo valor: R$ ${(expenseAmount / 100).toFixed(2)}`,
          );
        } else if (expenseAmount < 0) {
          await this.prisma.payable.delete({
            where: { id: existingSalaryPayable.id },
          });

          this.logger.log(
            `Despesa de salário removida (valor da despesa negativo): ${existingSalaryPayable.id}`,
          );
        }
      } else {
        const currentItems = await this.prisma.payrollItem.findMany({
          where: { payrollId: payroll.id },
        });

        const totalIncreases = currentItems
          .filter((item) => item.type === 'INCREASE')
          .reduce((sum, item) => sum + item.amount, 0);

        const totalDiscounts = currentItems
          .filter((item) => item.type === 'DISCOUNT')
          .reduce((sum, item) => sum + item.amount, 0);

        const totalAdvances = currentItems
          .filter((item) => item.type === 'ADVANCE')
          .reduce((sum, item) => sum + item.amount, 0);

        const newNetSalary = totalIncreases - totalDiscounts - totalAdvances;
        const expenseAmount = newNetSalary < 0 ? 0 : newNetSalary;

        if (expenseAmount >= 0) {
          await this.createSalaryExpense(payroll, expenseAmount);
        }
      }
    } catch (error) {
      this.logger.error(
        `Erro ao atualizar despesa de salário: ${error.message}`,
      );
    }
  }

  async updateAdvanceExpense(payrollItem: any, oldAmount?: number) {
    try {
      if (payrollItem.type !== 'ADVANCE') {
        return;
      }

      const payroll = await this.prisma.payroll.findUnique({
        where: { id: payrollItem.payrollId },
      });

      if (!payroll) {
        return;
      }

      const advanceDescription = `Folha ${String(payroll.month + 1).padStart(2, '0')}/${payroll.year} - ${payrollItem.description}`;

      const existingAdvancePayable = await this.prisma.payable.findFirst({
        where: {
          companyId: payroll.companyId,
          employeeId: payroll.employeeId,
          expenseSource: 'EMPLOYEE',
          description: advanceDescription,
        },
        include: {
          installments: true,
        },
      });

      if (existingAdvancePayable && oldAmount !== undefined) {
        await this.prisma.$transaction(async (prisma) => {
          await prisma.payable.update({
            where: { id: existingAdvancePayable.id },
            data: {
              totalAmount: payrollItem.amount,
              totalValue: payrollItem.amount,
            },
          });

          if (existingAdvancePayable.installments.length > 0) {
            await prisma.payableInstallment.update({
              where: { id: existingAdvancePayable.installments[0].id },
              data: {
                amount: payrollItem.amount,
              },
            });
          }
        });

        this.logger.log(
          `Despesa de adiantamento atualizada: ${existingAdvancePayable.id} - Novo valor: R$ ${(payrollItem.amount / 100).toFixed(2)}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Erro ao atualizar despesa de adiantamento: ${error.message}`,
      );
    }
  }
}
