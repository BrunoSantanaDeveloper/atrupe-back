import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { GetSalarySheetsDto } from './dto/salaries-filters.dto';
import {
  AddPaymentMovementDto,
  AddSalaryItemDto,
  PaySalaryMovementDto,
} from './dto/create-salary.dto';
import {
  ToggleSalarySheetStatusDto,
  UpdateSalaryItemDto,
} from './dto/update-salary.dto';

@Injectable()
export class SalarySheetService {
  constructor(private readonly prisma: PrismaService) {}

  async generateSalarySheetForMonth(
    month: number,
    year: number,
    companyId: string,
  ): Promise<void> {
    const employees = await this.prisma.employee.findMany({
      where: { isActive: true },
    });

    for (const employee of employees) {
      try {
        const existingSheet = await this.prisma.salarySheet.findUnique({
          where: {
            employeeId_month_year: { employeeId: employee.id, month, year },
          },
        });
        if (!existingSheet) {
          try {
            await this.prisma.salarySheet.create({
              data: {
                employeeId: employee.id,
                month,
                year,
                status: 'EMPTY',
                companyId,
              },
            });
          } catch (error) {
            console.error('Error creating salary sheet:', error.message);
          }
        }
      } catch (error) {
        console.error('Error finding salary sheet:', error.message);
      }
    }
  }

  async openSalarySheet(salarySheetId: string) {
    const salarySheet = await this.prisma.salarySheet.findUnique({
      where: { id: salarySheetId },
      include: {
        employee: true,
      },
    });

    if (!salarySheet || salarySheet.status !== 'EMPTY') {
      throw new NotFoundException(
        'Folha de pagamento não encontrada ou já está aberta.',
      );
    }

    await this.prisma.salarySheet.update({
      where: { id: salarySheetId },
      data: { status: 'OPEN' },
    });

    const salaryBase = salarySheet.employee.sallary || 0;
    const salaryItem = await this.prisma.salaryItem.create({
      data: {
        salarySheetId: salarySheetId,
        type: 'INCREASE',
        description: 'Salário Base',
        amount: salaryBase,
        reference: `${salarySheet.month + 1}/${salarySheet.year}`,
      },
    });

    return {
      message: 'Folha de pagamento aberta e salário base criado.',
      salaryItem,
    };
  }

  async getSalarySheets(
    dto: GetSalarySheetsDto,
  ): Promise<{ data: any[]; count: number }> {
    const { companyId, month, year, status, page = 1, limit = 10 } = dto;

    const filters: any = {};
    if (month) filters.month = +month;
    if (year) filters.year = +year;
    if (status) filters.status = status;
    if (companyId) filters.companyId = companyId;

    const skip = (+page - 1) * +limit;
    try {
      const [salarySheets, total] = await this.prisma.$transaction([
        this.prisma.salarySheet.findMany({
          where: filters,
          skip,
          take: +limit,
          select: {
            id: true,
            month: true,
            year: true,
            employee: {
              select: {
                user: {
                  select: {
                    name: true,
                  },
                },
                role: {
                  select: {
                    name: true,
                  },
                },
              },
            },
            items: true,
            movements: true,
          },
        }),
        this.prisma.salarySheet.count({ where: filters }),
      ]);
      return { data: salarySheets, count: total };
    } catch (error) {
      console.error(error.message);
    }
  }

  async getSalarySheetById(id: string): Promise<any> {
    return this.prisma.salarySheet.findUnique({
      where: { id },
      select: {
        id: true,
        month: true,
        year: true,
        employee: {
          select: {
            user: {
              select: {
                name: true,
              },
            },
            role: {
              select: {
                name: true,
              },
            },
          },
        },
        items: true,
        movements: true,
      },
    });
  }

  async addSalaryItem(addSalaryItemDto: AddSalaryItemDto) {
    try {
      const { salarySheetId, type, amount, description } = addSalaryItemDto;

      const salarySheet = await this.prisma.salarySheet.findUnique({
        where: { id: salarySheetId },
      });
      const reference = `${salarySheet.month + 1}/${salarySheet.year}`;

      if (!salarySheet || salarySheet.status !== 'OPEN') {
        throw new NotFoundException(
          'Folha de pagamento não encontrada ou não está aberta.',
        );
      }
      const salaryItem = await this.prisma.salaryItem.create({
        data: {
          salarySheetId,
          reference,
          type,
          amount,
          description,
        },
      });
      if (type === 'ADVANCE') {
        const movementDto: AddPaymentMovementDto = {
          salarySheetId,
          amount,
          paidDate: null, // Data atual
          paymentMethodId: null, // Deixar nulo até ser definido pelo gestor
          paymentStatus: 'PENDING', // Status inicial
        };

        await this.addPaymentMovement(movementDto);
      }

      return salaryItem;
    } catch (error) {
      console.error('Error creating payment movement:', error.message);
      throw new BadRequestException('Erro ao criar item de pagamento.');
    }
  }

  async updateSalaryItem(updateSalaryItemDto: UpdateSalaryItemDto) {
    const { id, ...itemData } = updateSalaryItemDto;

    const salaryItem = await this.prisma.salaryItem.findUnique({
      where: { id },
    });

    if (!salaryItem) {
      throw new NotFoundException('Item de folha de pagamento não encontrado.');
    }

    const updatedSalaryItem = await this.prisma.salaryItem.update({
      where: { id },
      data: itemData,
    });

    return updatedSalaryItem;
  }

  async toggleSalarySheetStatus(dto: ToggleSalarySheetStatusDto) {
    const { salarySheetId, status } = dto;

    const salarySheet = await this.prisma.salarySheet.findUnique({
      where: { id: salarySheetId },
      select: {
        id: true,
        status: true,
      },
    });

    if (!salarySheet) {
      throw new NotFoundException('Folha de pagamento não encontrada.');
    }

    if (salarySheet.status === status) {
      throw new BadRequestException(`A folha já está no estado ${status}.`);
    }

    const updatedSalarySheet = await this.prisma.salarySheet.update({
      where: { id: salarySheetId },
      data: { status },
    });

    return updatedSalarySheet;
  }

  async addPaymentMovement(dto: AddPaymentMovementDto) {
    const { salarySheetId, ...movementData } = dto;

    // Validar existência da folha de pagamento
    const salarySheet = await this.prisma.salarySheet.findUnique({
      where: { id: salarySheetId },
    });

    if (!salarySheet) {
      throw new NotFoundException('Folha de pagamento não encontrada.');
    }

    // Criar movimentação
    const paymentMovement = await this.prisma.paymentMovement.create({
      data: {
        salarySheetId,
        ...movementData,
      },
    });

    return paymentMovement;
  }

  async payMovement(dto: PaySalaryMovementDto) {
    const { movementId, paidDate, paidAmount, paymentMethodId } = dto;

    // Verificar existência da movimentação
    const movement = await this.prisma.paymentMovement.findUnique({
      where: { id: movementId },
    });

    if (!movement) {
      throw new NotFoundException('Movimentação não encontrada.');
    }

    if (movement.paymentStatus === 'PAID') {
      throw new BadRequestException('Movimentação já foi paga.');
    }

    // Atualizar movimentação para pago
    const updatedMovement = await this.prisma.paymentMovement.update({
      where: { id: movementId },
      data: {
        paidDate: new Date(paidDate),
        amount: paidAmount,
        paymentMethodId,
        paymentStatus: 'PAID',
      },
    });

    return updatedMovement;
  }
}
