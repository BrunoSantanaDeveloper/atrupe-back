import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';

@Injectable()
export class SalaryPdfService {
  private readonly logger = new Logger(SalaryPdfService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getSalarySheetPdfData(id: string, userId?: string) {
    try {
      const payroll = await this.prisma.payroll.findUnique({
        where: { id },
        include: {
          employee: {
            include: {
              user: true,
              role: true,
            },
          },
          company: {
            include: {
              address: {
                where: { type: 'Principal' },
              },
            },
          },
          items: {
            orderBy: [
              {
                createdAt: 'asc',
              },
              {
                id: 'asc',
              },
            ],
          },
        },
      });

      if (!payroll) {
        throw new NotFoundException('Folha de pagamento não encontrada');
      }

      // Assinatura exibida no PDF é a do colaborador logado que está
      // gerando o documento, não a do colaborador dono da folha
      const loggedEmployee = userId
        ? await this.prisma.employee.findFirst({
            where: { userId, companyId: payroll.companyId },
            select: { signatureUrl: true },
          })
        : null;

      const companyAddress = payroll.company.address[0];

      const totalIncreases = payroll.items
        .filter((item) => item.type === 'INCREASE')
        .reduce((sum, item) => sum + item.amount, 0);

      const totalDiscounts = payroll.items
        .filter((item) => item.type === 'DISCOUNT')
        .reduce((sum, item) => sum + item.amount, 0);

      const totalAdvances = payroll.items
        .filter((item) => item.type === 'ADVANCE')
        .reduce((sum, item) => sum + item.amount, 0);

      const netSalary = totalIncreases - totalDiscounts - totalAdvances;

      const startDate = new Date(payroll.year, payroll.month, 1);
      const endDate = new Date(payroll.year, payroll.month + 1, 0);

      const relatedPayables = await this.prisma.payable.findMany({
        where: {
          companyId: payroll.companyId,
          employeeId: payroll.employeeId,
          expenseSource: 'EMPLOYEE',
          financialType: 'MAIN',
          referenceDate: {
            gte: startDate,
            lte: endDate,
          },
        },
        include: {
          installments: {
            include: {
              paymentCondition: true,
            },
            orderBy: {
              installmentNumber: 'asc',
            },
          },
        },
      });

      const pdfData = {
        company: {
          name: payroll.company.name,
          cnpj: payroll.company.cnpj,
          email: payroll.company.email,
          phone: payroll.company.phone,
          siteUrl: payroll.company.siteUrl,
          logo: payroll.company.logoUrl,
          socialNetworks: {
            instagram: payroll.company.instagram,
            facebook: payroll.company.facebook,
            linkedin: payroll.company.linkedin,
          },
          address: companyAddress
            ? {
                street: companyAddress.street,
                number: companyAddress.number,
                complement: companyAddress.complement,
                neighborhood: companyAddress.neighborhood,
                city: companyAddress.city,
                state: companyAddress.state,
                zipCode: companyAddress.zipcode,
              }
            : null,
        },
        employeeName: payroll.employee.user?.name || payroll.employee.name,
        employeeSignatureUrl: loggedEmployee?.signatureUrl ?? null,
        reference: `${String(payroll.month + 1).padStart(2, '0')}/${payroll.year}`,
        items: payroll.items.map((item) => ({
          id: item.id,
          description: item.description,
          type: item.type,
          amount: item.amount,
        })),
        netSalary,
        payables: relatedPayables.map((payable) => ({
          id: payable.id,
          description: payable.description,
          totalAmount: payable.totalAmount,
          installments: payable.installments.map((installment) => ({
            id: installment.id,
            installmentNumber: installment.installmentNumber,
            dueDate: installment.dueDate,
            amount: installment.amount,
            status: installment.status,
            paidDate: installment.paidDate,
            paidAmount: installment.paidAmount,
          })),
        })),
      };

      return pdfData;
    } catch (error) {
      this.logger.error(
        `Erro ao gerar dados do PDF da folha de pagamento: ${error.message}`,
      );
      throw new BadRequestException(
        'Erro ao gerar dados do PDF da folha de pagamento',
      );
    }
  }

  async getAdvanceItemPdfData(itemId: string, userId?: string) {
    try {
      const payrollItem = await this.prisma.payrollItem.findUnique({
        where: { id: itemId },
        include: {
          payroll: {
            include: {
              employee: {
                include: {
                  user: true,
                  role: true,
                },
              },
              company: {
                include: {
                  address: {
                    where: { type: 'Principal' },
                  },
                },
              },
            },
          },
        },
      });

      if (!payrollItem) {
        throw new NotFoundException(
          'Item da folha de pagamento não encontrado',
        );
      }

      if (payrollItem.type !== 'ADVANCE') {
        throw new BadRequestException(
          'O item especificado não é um adiantamento',
        );
      }

      const payroll = payrollItem.payroll;
      const companyAddress = payroll.company.address[0];

      // Assinatura exibida no PDF é a do colaborador logado que está
      // gerando o documento, não a do colaborador dono da folha
      const loggedEmployee = userId
        ? await this.prisma.employee.findFirst({
            where: { userId, companyId: payroll.companyId },
            select: { signatureUrl: true },
          })
        : null;

      const startDate = new Date(payroll.year, payroll.month, 1);
      const endDate = new Date(payroll.year, payroll.month + 1, 0);

      const advanceDescription = `Folha ${String(payroll.month + 1).padStart(2, '0')}/${payroll.year} - ${payrollItem.description}`;

      const relatedPayable = await this.prisma.payable.findFirst({
        where: {
          companyId: payroll.companyId,
          employeeId: payroll.employeeId,
          expenseSource: 'EMPLOYEE',
          financialType: 'ADVANCE',
          description: advanceDescription,
          referenceDate: {
            gte: startDate,
            lte: endDate,
          },
        },
        include: {
          installments: {
            include: {
              paymentCondition: true,
            },
            orderBy: {
              installmentNumber: 'asc',
            },
          },
        },
      });

      const pdfData = {
        company: {
          name: payroll.company.name,
          cnpj: payroll.company.cnpj,
          email: payroll.company.email,
          phone: payroll.company.phone,
          siteUrl: payroll.company.siteUrl,
          logo: payroll.company.logoUrl,
          socialNetworks: {
            instagram: payroll.company.instagram,
            facebook: payroll.company.facebook,
            linkedin: payroll.company.linkedin,
          },
          address: companyAddress
            ? {
                street: companyAddress.street,
                number: companyAddress.number,
                complement: companyAddress.complement,
                neighborhood: companyAddress.neighborhood,
                city: companyAddress.city,
                state: companyAddress.state,
                zipCode: companyAddress.zipcode,
              }
            : null,
        },
        employeeName: payroll.employee.user?.name || payroll.employee.name,
        employeeSignatureUrl: loggedEmployee?.signatureUrl ?? null,
        reference: `${String(payroll.month + 1).padStart(2, '0')}/${payroll.year}`,
        items: [
          {
            id: payrollItem.id,
            description: payrollItem.description,
            type: payrollItem.type,
            amount: payrollItem.amount,
          },
        ],
        netSalary: payrollItem.amount,
        payables: relatedPayable
          ? [
              {
                id: relatedPayable.id,
                description: relatedPayable.description,
                totalAmount: relatedPayable.totalAmount,
                installments: relatedPayable.installments.map(
                  (installment) => ({
                    id: installment.id,
                    installmentNumber: installment.installmentNumber,
                    dueDate: installment.dueDate,
                    amount: installment.amount,
                    status: installment.status,
                    paidDate: installment.paidDate,
                    paidAmount: installment.paidAmount,
                  }),
                ),
              },
            ]
          : [],
      };

      return pdfData;
    } catch (error) {
      this.logger.error(
        `Erro ao gerar dados do PDF de adiantamento: ${error.message}`,
      );
      throw new BadRequestException(
        'Erro ao gerar dados do PDF de adiantamento',
      );
    }
  }
}
