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
  UpdateEmployeeSalaryDto,
} from './dto/update-salary.dto';

@Injectable()
export class SalarySheetsService {
  constructor(private readonly prisma: PrismaService) {}

  async generateSalarySheetForMonth(
    month: number,
    year: number,
    companyId: string,
  ): Promise<void> {
        /**
     * LÓGICA TEMPORAL PARA FOLHAS DE PAGAMENTO:
     * - Colaboradores ativos: aparecem nos meses posteriores ao cadastro
     * - Colaboradores desativados: mantêm histórico dos meses anteriores
     * - Novos colaboradores: só aparecem a partir do mês de cadastro
     */
    const lastDayOfMonth = new Date(year, month + 1, 0, 23, 59, 59); // Último dia do mês

    // Buscar colaboradores que existiam no mês selecionado
    const employees = await this.prisma.employee.findMany({
      where: {
        companyId,
        // Colaborador foi criado até o final do mês selecionado
        createdAt: {
          lte: lastDayOfMonth,
        },
        OR: [
          // Colaborador ainda está ativo (aparece em todos os meses posteriores ao cadastro)
          { isActive: true },
          // OU colaborador inativo MAS que já teve folha criada para este mês
          // (mantém histórico de meses anteriores à desativação)
          {
            AND: [
              { isActive: false },
              {
                salarySheet: {
                  some: {
                    month: month,
                    year: year,
                  },
                },
              },
            ],
          },
        ],
      },
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

  async getSalarySheets(dto: GetSalarySheetsDto): Promise<{
    data: {
      id: string;
      name: string;
      role: string;
      salary: number;
      balance: number;
      status: string;
    }[];
    count: number;
    summary: {
      totalSalary: number;
      totalIncreases: number;
      totalDiscounts: number;
      totalAdvances: number;
    };
  }> {
    const {
      companyId,
      month,
      year,
      status,
      page = 1,
      limit = 10,
      sectorId,
      employeeName,
      itemType,
      search,
      orderBy = 'month',
      orderDirection = 'desc',
    } = dto;

    const filters: any = {
      where: {
        companyId,
      },
      include: {
        employee: {
          include: {
            user: true,
            sector: true,
          },
        },
        items: true,
      },
      orderBy: {
        [orderBy]: orderDirection,
      },
    };

    if (month) filters.where.month = +month;
    if (year) filters.where.year = +year;
    if (status) filters.where.status = status;
    if (sectorId) filters.where.employee = { sectorId };
    if (employeeName) {
      filters.where.employee = {
        ...filters.where.employee,
        user: {
          name: {
            contains: employeeName,
            mode: 'insensitive',
          },
        },
      };
    }
    if (itemType) {
      filters.where.items = {
        some: {
          type: itemType,
        },
      };
    }
    if (search) {
      filters.where.OR = [
        {
          employee: {
            user: {
              name: {
                contains: search,
                mode: 'insensitive',
              },
            },
          },
        },
        {
          items: {
            some: {
              description: {
                contains: search,
                mode: 'insensitive',
              },
            },
          },
        },
      ];
    }

    const skip = (+page - 1) * +limit;
    try {
      const [salarySheets, total] = await this.prisma.$transaction([
        this.prisma.salarySheet.findMany({
          ...filters,
          skip,
          take: +limit,
        }),
        this.prisma.salarySheet.count({
          where: filters.where,
        }),
      ]);

      // Calcular totais
      const summary = {
        totalSalary: 0,
        totalIncreases: 0,
        totalDiscounts: 0,
        totalAdvances: 0,
      };

      salarySheets.forEach((sheet: any) => {
        sheet.items.forEach((item) => {
          switch (item.type) {
            case 'INCREASE':
              summary.totalIncreases += item.amount;
              break;
            case 'DISCOUNT':
              summary.totalDiscounts += item.amount;
              break;
            case 'ADVANCE':
              summary.totalAdvances += item.amount;
              break;
          }
        });
      });

      summary.totalSalary =
        summary.totalIncreases - summary.totalDiscounts - summary.totalAdvances;

      // Mapear dados para o formato desejado
      const mappedData = salarySheets.map((sheet: any) => {
        // Calcular salário base (item do tipo INCREASE com descrição "Salário Base")
        const baseSalaryItem = sheet.items.find(
          (item) =>
            item.type === 'INCREASE' && item.description === 'Salário Base',
        );
        const baseSalary = baseSalaryItem ? baseSalaryItem.amount : 0;

        // Calcular saldo (aumentos - descontos - adiantamentos)
        let totalIncreases = 0;
        let totalDiscounts = 0;
        let totalAdvances = 0;

        sheet.items.forEach((item) => {
          switch (item.type) {
            case 'INCREASE':
              totalIncreases += item.amount;
              break;
            case 'DISCOUNT':
              totalDiscounts += item.amount;
              break;
            case 'ADVANCE':
              totalAdvances += item.amount;
              break;
          }
        });

        const balance = totalIncreases - totalDiscounts - totalAdvances;

        // Mapear status
        const statusMap = {
          EMPTY: '',
          OPEN: 'Aberta',
          CLOSED: 'Fechada',
        };

        return {
          id: sheet.id,
          name: sheet.employee?.user?.name || 'Nome não disponível',
          role:
            sheet.employee?.role?.name ||
            sheet.employee?.sector?.name ||
            'Cargo não definido',
          salary: baseSalary,
          balance: balance,
          status: statusMap[sheet.status] || sheet.status,
        };
      });

      return {
        data: mappedData,
        count: total,
        summary,
      };
    } catch (error) {
      console.error(error.message);
      throw new BadRequestException('Erro ao buscar folhas de pagamento');
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

  async updateEmployeeSalary(dto: UpdateEmployeeSalaryDto) {
    const { employeeId, salary } = dto;

    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) {
      throw new NotFoundException('Colaborador não encontrado');
    }

    const updatedEmployee = await this.prisma.employee.update({
      where: { id: employeeId },
      data: { sallary: salary },
    });

    // Atualizar folha de pagamento atual se existir
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth();
    const currentYear = currentDate.getFullYear();

    const currentSalarySheet = await this.prisma.salarySheet.findFirst({
      where: {
        employeeId,
        month: currentMonth,
        year: currentYear,
        status: 'OPEN',
      },
    });

    if (currentSalarySheet) {
      // Atualizar ou criar item de salário base
      const baseSalaryItem = await this.prisma.salaryItem.findFirst({
        where: {
          salarySheetId: currentSalarySheet.id,
          type: 'INCREASE',
          description: 'Salário Base',
        },
      });

      if (baseSalaryItem) {
        await this.prisma.salaryItem.update({
          where: { id: baseSalaryItem.id },
          data: { amount: salary },
        });
      } else {
        await this.prisma.salaryItem.create({
          data: {
            salarySheetId: currentSalarySheet.id,
            type: 'INCREASE',
            description: 'Salário Base',
            amount: salary,
            reference: `${currentMonth + 1}/${currentYear}`,
          },
        });
      }
    }

    return updatedEmployee;
  }
}
