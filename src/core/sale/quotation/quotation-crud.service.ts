import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { Prisma, Quotation, QuotationStatus } from '@prisma/client';
import { add, endOfDay } from 'date-fns';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { FilterQuotationDto } from './dto/filter.dto';

/**
 * QuotationCrudService
 * Responsável por operações CRUD básicas do orçamento.
 */
@Injectable()
export class QuotationCrudService {
  constructor(private prisma: PrismaService) {}

  /**
   * Método auxiliar para buscar userId a partir de employeeId
   */
  async getUserIdFromEmployee(
    employeeId: string,
  ): Promise<{ userId: string; userName: string } | null> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        userId: true,
        name: true,
        user: { select: { name: true } },
      },
    });

    if (!employee?.userId) {
      return null;
    }

    return {
      userId: employee.userId,
      userName: employee.name || employee.user?.name || 'Usuário',
    };
  }

  /**
   * Cria um novo orçamento
   */
  async create(createQuotationDto: CreateQuotationDto): Promise<Quotation> {
    const {
      description,
      contactSourceId,
      companyId,
      sellerId,
      clientId,
      contactId,
      seriesId,
    } = createQuotationDto;

    try {
      if (!seriesId) {
        throw new BadRequestException(
          `Não é possível criar um orçamento sem uma série`,
        );
      }
      const series = await this.prisma.saleSeries.findUnique({
        where: { id: seriesId },
      });
      if (!series) {
        throw new NotFoundException(`Serie não encontrada`);
      }
      const mainCompany = await this.prisma.company.findUnique({
        where: { id: companyId },
        select: {
          id: true,
          principalCompanyId: true,
        },
      });

      // Validação do contactId se informado
      if (contactId && clientId) {
        const contact = await this.prisma.contact.findFirst({
          where: {
            id: contactId,
            clientId: clientId,
          },
        });
        if (!contact) {
          throw new BadRequestException(
            `Contato não encontrado ou não pertence ao cliente informado`,
          );
        }
      }

      // Criação do orçamento no banco
      const newQuotation = await this.prisma.quotation.create({
        data: {
          description,
          contactSourceId,
          companyId: mainCompany.principalCompanyId
            ? mainCompany.principalCompanyId
            : mainCompany.id,
          subCompanyId: mainCompany.id,
          sellerId,
          clientId,
          contactId,
          seriesId: seriesId || undefined,
          quotationNumber: series.currentBudgetNumber + 1,
        },
      });

      await this.prisma.saleSeries.update({
        where: {
          id: seriesId,
        },
        data: {
          currentBudgetNumber: { increment: 1 },
        },
      });

      await this.prisma.deliveryInfo.create({
        data: {
          daysAfterApproval: series.deliveryDeadline,
          quotation: {
            connect: {
              id: newQuotation.id,
            },
          },
        },
      });

      const defaultPaymentCondition =
        await this.prisma.paymentCondition.findFirst({
          where: {
            companyId: createQuotationDto.companyId,
            isActive: true,
          },
        });

      if (!defaultPaymentCondition) {
        throw new Error('No payment condition found for company');
      }

      await this.prisma.quotationPayment.create({
        data: {
          quotation: {
            connect: { id: newQuotation.id },
          },
          billing: series.billing,
          totalValue: 0,
          paymentCondition: {
            connect: { id: defaultPaymentCondition.id },
          },
        },
      });

      return newQuotation;
    } catch (error) {
      console.log(error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(
        `Erro ao criar orçamento: ${error.message}`,
      );
    }
  }

  /**
   * Busca contagem de orçamentos por status
   */
  async findAllQuantity(companyId: string, sellerId?: string) {
    const allStatuses: QuotationStatus[] = [
      'OPEN',
      'REJECTED',
      'DONE',
      'OVERDUE' as any,
    ];

    const where: any = { companyId, status: { in: allStatuses } };
    if (sellerId) {
      where.sellerId = sellerId;
    }

    const quotations = await this.prisma.quotation.findMany({
      where,
      select: {
        status: true,
        dueDate: true,
      },
    });

    const statusCount = allStatuses.reduce(
      (acc, status) => {
        acc[status] = 0;
        return acc;
      },
      {} as { [K in QuotationStatus]: number },
    );

    quotations.forEach((quotation) => {
      const isOverdue =
        quotation.dueDate &&
        quotation.dueDate < new Date() &&
        quotation.status === 'DONE';

      const status = isOverdue ? 'OVERDUE' : quotation.status;
      statusCount[status]++;
    });

    const total = Object.values(statusCount).reduce((acc, cur) => acc + cur, 0);

    return {
      ...statusCount,
      TOTAL: total,
    };
  }

  /**
   * Busca todos os orçamentos com filtros
   */
  async findAll(dto: FilterQuotationDto) {
    try {
      let where: Prisma.QuotationWhereInput = {
        status: { not: QuotationStatus.APPROVED },
      };

      if (dto.companyId) {
        where = {
          ...where,
          OR: [
            { companyId: dto.companyId },
            { subCompany: { id: dto.companyId } },
            { subCompany: { principalCompanyId: dto.companyId } },
          ],
        };
      }

      if (dto.search) {
        where = {
          ...where,
          AND: [
            ...(where.AND
              ? Array.isArray(where.AND)
                ? where.AND
                : [where.AND]
              : []),
            {
              OR: [
                { description: { contains: dto.search, mode: 'insensitive' } },
                {
                  client: {
                    name: { contains: dto.search, mode: 'insensitive' },
                  },
                },
                {
                  seller: {
                    user: {
                      name: { contains: dto.search, mode: 'insensitive' },
                    },
                  },
                },
              ],
            },
          ],
        };
      }

      if (dto.status) {
        if ((dto.status as any) === 'OVERDUE') {
          where = {
            ...where,
            status: 'DONE',
            dueDate: {
              lt: new Date(),
            },
          };
        } else {
          where = { ...where, status: dto.status };
        }
      }

      if (dto.sellerId) {
        where = { ...where, sellerId: dto.sellerId };
      }

      if (dto.serieId) {
        where = { ...where, seriesId: dto.serieId };
      }

      if (dto.clientId) {
        where = { ...where, clientId: dto.clientId };
      }

      if (dto.date) {
        const date = add(new Date(dto.date), { days: 1 });
        where = {
          ...where,
          finishedAt: {
            lte: endOfDay(date),
          },
        };
      }

      if (dto.startDate || dto.endDate) {
        const dateFilter: any = {};

        if (dto.startDate) {
          dateFilter.gte = new Date(dto.startDate);
        }

        if (dto.endDate) {
          const endDate = new Date(dto.endDate);
          endDate.setHours(23, 59, 59, 999);
          dateFilter.lte = endDate;
        }

        where = {
          ...where,
          createdAt: dateFilter,
        };
      }

      const [quotations, total] = await Promise.all([
        this.prisma.quotation.findMany({
          where,
          include: {
            tag: true,
            series: true,
            client: true,
            order: {
              select: {
                id: true,
              },
            },
            deliveryInfo: {
              select: {
                value: true,
              },
            },
            quotationPayment: {
              select: {
                finalValue: true,
                discountTotal: true,
                downPaymentAdditionalFee: true,
                commission: {
                  select: {
                    type: true,
                    totalCommission: true,
                  },
                },
                quotationInstallment: {
                  select: {
                    additionalFee: true,
                  },
                },
              },
            },
          },
          take: Number(dto.limit),
          skip: (Number(dto.page) - 1) * Number(dto.limit),
          orderBy: {
            createdAt: 'desc',
          },
        }),
        this.prisma.quotation.count({ where }),
      ]);

      return {
        data: quotations.map((quotation) => ({
          ...quotation,
          finalValue: quotation.quotationPayment?.finalValue || 0,
        })),
        meta: {
          total,
          page: Number(dto.page),
          limit: Number(dto.limit),
          totalPages: Math.ceil(total / Number(dto.limit)),
        },
      };
    } catch (error) {
      console.error('Error in findAll:', error);
      throw error;
    }
  }

  /**
   * Busca um orçamento por ID
   */
  async findOne(id: string) {
    const quotation = await this.prisma.quotation.findUnique({
      where: { id },
      include: {
        seller: {
          include: { user: true, sellerProfile: true },
        },
        client: true,
        series: true,
        quotationPayment: true,
        quotationProduct: {
          include: { product: true, items: true },
        },
        deliveryInfo: true,
      },
    });

    if (!quotation) {
      throw new NotFoundException(`Quotation with ID '${id}' not found.`);
    }

    return quotation;
  }

  /**
   * Conta total de orçamentos
   */
  async count() {
    return this.prisma.quotation.count();
  }

  /**
   * Atualiza um orçamento
   */
  async update(id: string, updateQuotationDto: UpdateQuotationDto) {
    try {
      const existingQuotation = await this.prisma.quotation.findUnique({
        where: { id },
      });

      if (!existingQuotation) {
        throw new NotFoundException(`Quotation with ID '${id}' not found.`);
      }

      return await this.prisma.quotation.update({
        where: { id },
        data: updateQuotationDto,
      });
    } catch (error) {
      throw error;
    }
  }

  /**
   * Remove (desativa) um orçamento
   */
  remove(id: string) {
    return this.prisma.quotation.update({
      where: { id },
      data: { isActive: false },
    });
  }

  /**
   * Busca fontes de contato
   */
  async findAllContactSources() {
    try {
      return await this.prisma.contactSource.findMany({
        orderBy: { name: 'asc' },
      });
    } catch (error) {
      console.error('Error finding all contact sources:', error);
      throw error;
    }
  }
}
