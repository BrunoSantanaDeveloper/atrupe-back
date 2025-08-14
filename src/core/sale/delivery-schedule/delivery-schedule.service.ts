import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';

import { CreateDeliveryScheduleDto } from './dto/create-delivery-schedule.dto';
import { UpdateDeliveryScheduleDto } from './dto/update-delivery-schedule.dto';
import { PrismaService } from 'src/config/prisma/prisma.service';
import {
  DeliverySchedule,
  DeliveryScheduleStatus,
  Prisma,
} from '@prisma/client';
import { DeliveryScheduleFitlerDto } from './dto/filter.dto';
import { add } from 'date-fns';
export interface DeliveryScheduleGroup {
  date: string;
  deliveries: DeliverySchedule[];
}
@Injectable()
export class DeliveryScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  create(createDeliveryScheduleDto: CreateDeliveryScheduleDto) {
    return this.prisma.deliverySchedule.create({
      data: createDeliveryScheduleDto,
    });
  }

  async findAll(dto: DeliveryScheduleFitlerDto) {
    try {
      let where: Prisma.DeliveryScheduleWhereInput = {};
      if (dto.companyId) {
        where = { ...where, companyId: dto.companyId };
      }

      if (dto.search) {
        where.quotation = {
          is: {
            OR: [
              { description: { contains: dto.search, mode: 'insensitive' } },
              {
                client: { name: { contains: dto.search, mode: 'insensitive' } },
              },
              {
                seller: {
                  user: { name: { contains: dto.search, mode: 'insensitive' } },
                },
              },
            ],
          },
        };
      }

      if (dto.status) {
        where = { ...where, status: dto.status };
      }

      if (dto.sellerId) {
        where = { ...where, quotation: { sellerId: dto.sellerId } };
      }

      if (dto.serieId) {
        where = { ...where, quotation: { seriesId: dto.serieId } };
      }
      const [deliveries, total] = await Promise.all([
        this.prisma.deliverySchedule.findMany({
          where,
          include: {
            order: {
              include: {
                quotation: {
                  include: {
                    series: true,
                    client: true,
                    payable: true,
                    receivable: true,
                    seller: {
                      include: {
                        user: {
                          select: {
                            name: true,
                          },
                        },
                      },
                    },
                    quotationProduct: {
                      include: {
                        items: {
                          orderBy: {
                            createdAt: 'asc',
                          },
                        },
                      },
                      orderBy: {
                        createdAt: 'asc',
                      },
                    },
                  },
                },
              },
            },
            deliveryInfo: true,
            productionStages: {
              select: {
                id: true,
                status: true,
                prevStatus: true,
                order: true,
                notes: true,
                stage: {
                  select: {
                    id: true,
                    name: true,
                    icon: true,
                  },
                },
              },
              orderBy: {
                order: 'asc',
              },
            },
          },
          take: Number(dto.limit),
          skip: (Number(dto.page) - 1) * Number(dto.limit),
          orderBy: {
            createdAt: 'desc',
          },
        }),
        this.prisma.deliverySchedule.count({ where }),
      ]);

      // Create an array of promises for all the financial data
      const deliveriesWithFinancial = await Promise.all(
        deliveries.map(async (delivery) => {
          let getData = null;
          if (delivery.order.quotation.receivable[0]) {
            getData = await this.getFinancialDataById(
              delivery.order.quotation.receivable[0].id,
            );
          }
          const date = delivery.createdAt.toISOString().split('T')[0];
          return {
            date,
            delivery,
            getData,
          };
        }),
      );

      // Now group the results
      const grouped: Record<string, DeliveryScheduleGroup> =
        deliveriesWithFinancial.reduce((acc, { date, delivery, getData }) => {
          if (!acc[date]) {
            acc[date] = {
              date: date,
              deliveries: [],
            };
          }
          acc[date].deliveries.push({
            id: delivery.id,
            deliveryInfoId: delivery.deliveryInfo?.id,
            isActive: delivery.isActive,
            status: delivery.status,
            completed: delivery.completed,
            notes: delivery.notes,
            scheduledDate: delivery.scheduledDate,
            addScheduleTime: delivery.addScheduleTime,
            pendingDescription: delivery.pendingDescription,

            financial: {
              billed: delivery.order.quotation
                ? delivery.order.quotation.receivable.length > 0
                : false,
              data: getData,
            },
            order: delivery.order
              ? {
                  id: delivery.order.id,
                  status: delivery.order.status,
                  quotation: delivery.order.quotation
                    ? {
                        id: delivery.order.quotation.id,
                        description: delivery.order.quotation.description,
                        serie: delivery.order.quotation.series
                          ? {
                              id: delivery.order.quotation.series.id,
                              title: delivery.order.quotation.series.title,
                              code: delivery.order.quotation.series.code,
                              quotation:
                                delivery.order.quotation.quotationNumber,
                            }
                          : null,
                        seller: delivery.order.quotation.seller
                          ? {
                              id: delivery.order.quotation.seller.id,
                              name: delivery.order.quotation.seller.name,
                            }
                          : null,
                        client: delivery.order.quotation.client
                          ? {
                              id: delivery.order.quotation.client.id,
                              type: delivery.order.quotation.client.type,
                              name: delivery.order.quotation.client.name,
                              status: delivery.order.quotation.client.status,
                              cnpj: delivery.order.quotation.client.cnpj,
                              cpf: delivery.order.quotation.client.cpf,
                              email: delivery.order.quotation.client.email,
                              phoneNumber:
                                delivery.order.quotation.client.phone,
                            }
                          : null,
                      }
                    : null,
                }
              : null,

            productionStages: delivery.productionStages.map((stage) => ({
              id: stage.id,
              status: stage.status,
              prevStatus: stage.prevStatus,
              notes: stage.notes,
              stage: {
                id: stage.stage.id,
                name: stage.stage.name,
                icon: stage.stage.icon,
              },
            })),
            createdAt: delivery.createdAt,
            updatedAt: delivery.updatedAt,
          });
          return acc;
        }, {});

      return {
        total,
        lastPage: Math.ceil(total / Number(dto.limit)),
        data: Object.values(grouped).sort((a, b) =>
          b.date.localeCompare(a.date),
        ),
      };
    } catch (error) {
      console.error(error);
      throw new BadRequestException(error.message);
    }
  }

  async findAllQuantity(companyId: string) {
    const allStatuses: DeliveryScheduleStatus[] = [
      'IN_PRODUCTION',
      'DELIVERING',
      'FINISHED',
      'DONE',
    ];

    const result = await this.prisma.deliverySchedule.groupBy({
      by: ['status'],
      where: { companyId, status: { in: allStatuses } },
      _count: true,
    });

    const statusCount = allStatuses.reduce(
      (acc, status) => {
        acc[status] = 0;
        return acc;
      },
      {} as { [K in DeliveryScheduleStatus]: number },
    );

    result.forEach((cur) => {
      statusCount[cur.status] = cur._count;
    });

    const total = Object.values(statusCount).reduce((acc, cur) => acc + cur, 0);

    return {
      ...statusCount,
      ACTIVE: statusCount.IN_PRODUCTION + statusCount.DELIVERING,
      TOTAL: total,
    };
  }

  findOne(id: string) {
    return this.prisma.deliverySchedule.findUnique({ where: { id } });
  }

  update(id: string, updateDeliveryScheduleDto: UpdateDeliveryScheduleDto) {
    return this.prisma.deliverySchedule.update({
      where: { id },
      data: updateDeliveryScheduleDto,
    });
  }

  remove(id: string) {
    return this.prisma.deliverySchedule.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async bill(quotationId: string) {
    // Verificar se já existem receivables ou payables para este orçamento
    const existingFinancials = await this.prisma.$transaction(
      async (prisma) => {
        const [existingReceivables, existingPayables] = await Promise.all([
          prisma.receivable.findMany({
            where: { quotationId },
            select: { id: true },
          }),
          prisma.payable.findMany({
            where: { quotationId },
            select: { id: true },
          }),
        ]);
        return { receivables: existingReceivables, payables: existingPayables };
      },
    );

    if (
      existingFinancials.receivables.length > 0 ||
      existingFinancials.payables.length > 0
    ) {
      console.log(
        `Financials already exist for quotation ${quotationId}. Skipping bill creation.`,
      );
      return {
        quotation: { id: quotationId },
        receivable: null,
        payable: null,
        message: 'Financial records already exist for this quotation',
      };
    }

    // Buscar o quotation ANTES de qualquer transação para evitar timeout
    const quotation = await this.prisma.quotation.findUnique({
      where: { id: quotationId },
      include: {
        quotationProduct: {
          include: {
            product: true,
            items: true,
          },
        },
        deliveryInfo: {
          include: {
            deliverySchedule: true,
          },
        },
        quotationPayment: {
          // include: {
          //   quotationInstallment: true,
          //   commission: true,
          // },
          select: {
            billing: true,
            quotationInstallment: true,
            commission: true,
            downPayment: true,
            downPaymentDueDate: true,
            downPaymentAdditionalFee: true,
            description: true,
            downPaymentCondition: true,
          },
        },
        client: true,
        series: true,
        company: true,
      },
    });

    if (!quotation) {
      throw new NotFoundException(
        `Quotation with ID '${quotationId}' not found.`,
      );
    }

    // Executar em uma transação otimizada
    return await this.prisma.$transaction(
      async (prisma) => {
        // Marcar as entregas como finalizadas
        if (quotation.deliveryInfo?.deliverySchedule) {
          await prisma.deliverySchedule.update({
            where: { id: quotation.deliveryInfo.deliverySchedule.id },
            data: { status: 'DONE' },
          });
        }

        // Gerar receivables (só se billing não for NO_INVOICE)
        let receivable = null;
        if (quotation.quotationPayment.billing !== 'NO_INVOICE') {
          receivable = await this.generateReceivableFromQuotation(
            quotation,
            prisma,
          );
        }

        // Gerar payables
        const payable = await this.generatePayableFromQuotation(
          quotation,
          prisma,
        );

        return { quotation, receivable, payable };
      },
      {
        timeout: 15000, // 15 segundos de timeout
      },
    );
  }

  private async generatePayableFromQuotation(quotation: any, prisma: any) {
    const results = {
      payableCommission: null,
      payableDelivery: null,
    };

    // Avaliar comissão independentemente
    const commission = quotation.quotationPayment.commission;
    if (await this.shouldCreateCommissionPayable(commission, prisma)) {
      results.payableCommission = await this.createCommissionPayable(
        quotation,
        commission,
        prisma,
      );
    }

    // Avaliar entrega independentemente
    const delivery = quotation.deliveryInfo;
    if (this.shouldCreateDeliveryPayable(delivery)) {
      results.payableDelivery = await this.createDeliveryPayable(
        quotation,
        delivery,
        prisma,
      );
    }

    return results;
  }

  private async shouldCreateCommissionPayable(
    commission: any,
    prisma: any,
  ): Promise<boolean> {
    if (!commission) return false;

    // Validar valor da comissão
    if (!commission.commissionValue || commission.commissionValue <= 0) {
      console.log('Commission validation failed: commissionValue <= 0');
      return false;
    }

    if (!commission.totalCommission || commission.totalCommission <= 0) {
      console.log('Commission validation failed: totalCommission <= 0');
      return false;
    }

    // Validar fornecedor ativo
    if (!commission.supplierId) {
      console.log('Commission validation failed: no supplierId');
      return false;
    }

    const supplier = await prisma.supplier.findFirst({
      where: { id: commission.supplierId, status: 'ACTIVE' },
    });

    if (!supplier) {
      console.log(
        'Commission validation failed: supplier not found or inactive',
      );
      return false;
    }

    // Validar tipo de comissão
    if (!['ADDITION', 'SUBTRACTION'].includes(commission.type)) {
      console.log('Commission validation failed: invalid commission type');
      return false;
    }

    // Validar método de transferência
    if (!['SINGLE', 'PAYMENT_BASED'].includes(commission.transferMethod)) {
      console.log('Commission validation failed: invalid transferMethod');
      return false;
    }

    return true;
  }

  private shouldCreateDeliveryPayable(delivery: any): boolean {
    if (!delivery) return false;

    // Regra simplificada: se tem custo, sempre gera despesa
    if (!delivery.cost || delivery.cost <= 0) {
      console.log('Delivery validation failed: cost <= 0');
      return false;
    }

    return true;
  }

  private async createCommissionPayable(
    quotation: any,
    commission: any,
    prisma: any,
  ) {
    // Criar conta a pagar da comissão
    const payableCommission = await prisma.payable.create({
      data: {
        referenceDate: new Date(),
        description: `Comissão da venda ${quotation.quotationNumber}-${quotation.series.code} - ${quotation.description || ''}`,
        notes: quotation.quotationPayment.description || '',
        totalAmount: commission.totalCommission || 0,
        totalValue: commission.totalCommission || 0,
        mainAdditionalFee: 0,
        installmentQty:
          commission.transferMethod === 'PAYMENT_BASED'
            ? quotation.quotationPayment.quotationInstallment.length
            : 1,
        status: 'PENDING',
        supplierId: commission.supplierId,
        companyId: quotation.companyId,
        natureId: null,
        subCategoryId: null,
        quotationId: quotation.id,
        commission: {
          connect: {
            id: commission.id,
          },
        },
      },
    });

    // Criar parcelas de comissão
    if (payableCommission) {
      if (commission.transferMethod === 'SINGLE') {
        await prisma.payableInstallment.create({
          data: {
            payableId: payableCommission.id,
            installmentNumber: 1,
            dueDate: add(new Date(), { days: 30 }),
            amount: commission.totalCommission || 0,
            additionalFee: 0,
            paymentMethodId: null,
            status: 'PENDING',
            paidDate: null,
          },
        });
      } else if (commission.transferMethod === 'PAYMENT_BASED') {
        const installments =
          quotation.quotationPayment.quotationInstallment.map(
            (installment: any, index: number) => ({
              payableId: payableCommission.id,
              installmentNumber: index + 1,
              dueDate: installment.dueDate,
              amount:
                commission.totalCommission /
                quotation.quotationPayment.quotationInstallment.length,
              additionalFee: 0,
              paymentMethodId: null,
              status: 'PENDING',
              paidDate: null,
            }),
          );

        await prisma.payableInstallment.createMany({
          data: installments,
        });
      }
    }

    return payableCommission;
  }

  private async createDeliveryPayable(
    quotation: any,
    delivery: any,
    prisma: any,
  ) {
    const deliveryCost = delivery.cost || 0;

    // Criar conta a pagar da entrega
    const payableDelivery = await prisma.payable.create({
      data: {
        referenceDate: new Date(),
        description: `Entrega da venda ${quotation.quotationNumber}-${quotation.series.code} - ${quotation.description || ''}`,
        notes: quotation.quotationPayment.description || '',
        totalAmount: deliveryCost,
        totalValue: deliveryCost,
        mainAdditionalFee: 0,
        installmentQty: 1,
        status: 'PENDING',
        supplierId: delivery.supplierId,
        companyId: quotation.companyId,
        natureId: null,
        subCategoryId: null,
        quotationId: quotation.id,
      },
    });

    // Criar parcela única para a entrega
    if (payableDelivery) {
      await prisma.payableInstallment.create({
        data: {
          payableId: payableDelivery.id,
          installmentNumber: 1,
          dueDate: add(new Date(), { days: 30 }),
          amount: deliveryCost,
          additionalFee: 0,
          paymentMethodId: null,
          status: 'PENDING',
          paidDate: null,
        },
      });
    }

    return payableDelivery;
  }

  private async generateReceivableFromQuotation(quotation: any, prisma: any) {
    const quotationInstallments =
      quotation.quotationPayment.quotationInstallment;
    const downPayment = quotation.quotationPayment.downPayment;
    const downPaymentDueDate = quotation.quotationPayment.downPaymentDueDate;
    const downPaymentadditionalFee =
      quotation.quotationPayment.downPaymentAdditionalFee;
    const paymentMethod =
      quotation?.quotationPayment?.downPaymentCondition?.paymentMethodId ??
      null;
    if (!quotationInstallments || quotationInstallments.length === 0) {
      throw new BadRequestException(
        'Não há parcelas para gerar contas a receber.',
      );
    }

    // Calcular o valor total das parcelas
    const totalAmount = quotationInstallments.reduce(
      (sum: number, installment: any) =>
        sum + installment.value + (installment.additionalFee || 0),
      0,
    );
    const totalValue = quotationInstallments.reduce(
      (sum: number, installment: any) => sum + installment.value,
      0,
    );
    const mainAdditionalFee = quotationInstallments.reduce(
      (sum: number, installment: any) => sum + (installment.additionalFee || 0),
      0,
    );

    try {
      // Criar entrada se houver
      if (downPayment && downPayment > 0) {
        const receivableDownPayment = await prisma.receivable.create({
          data: {
            referenceDate: new Date(),
            description: `Entrada da venda ${quotation.quotationNumber}-${quotation.series.code} - ${quotation.description || ''}`,
            notes: quotation.quotationPayment.description || '',
            totalAmount: downPayment,
            totalValue: downPayment,
            mainAdditionalFee: downPaymentadditionalFee || 0,
            installmentQty: 1,
            status: 'PENDING',
            clientId: quotation.clientId,
            companyId: quotation.companyId,
            natureId: null,
            subCategoryId: null,
            quotationId: quotation.id,
          },
        });
        await prisma.receivableInstallment.create({
          data: {
            receivableId: receivableDownPayment.id,
            installmentNumber: 1,
            dueDate: downPaymentDueDate,
            amount: downPayment,
            additionalFee: downPaymentadditionalFee || 0,
            paymentMethodId: paymentMethod,
            status: 'PENDING',
            paidDate: null,
          },
        });
      }

      // Criar o Receivable principal
      const receivable = await prisma.receivable.create({
        data: {
          referenceDate: new Date(),
          description: `Venda ${quotation.quotationNumber}-${quotation.series.code} - ${quotation.description || ''}`,
          notes: quotation.quotationPayment.description || '',
          totalAmount,
          totalValue,
          mainAdditionalFee,
          installmentQty: quotationInstallments.length,
          status: 'PENDING',
          clientId: quotation.clientId,
          companyId: quotation.companyId,
          natureId: null,
          subCategoryId: null,
          quotationId: quotation.id,
        },
      });

      // Preparar e criar as parcelas
      const installments = quotationInstallments.map(
        (installment: any, index: number) => ({
          receivableId: receivable.id,
          installmentNumber: index + 1,
          dueDate: installment.dueDate,
          amount: installment.value,
          additionalFee: installment.additionalFee || 0,
          paymentMethodId: installment.paymentMethodId,
          status: 'PENDING',
          paidDate: null,
        }),
      );

      await prisma.receivableInstallment.createMany({
        data: installments,
      });

      return receivable;
    } catch (error) {
      console.error('Erro ao gerar contas a receber:', error);
      throw new Error(
        'Erro ao gerar contas a receber. Detalhes: ' + error.message,
      );
    }
  }

  async getFinancialDataById(quotationId: string) {
    const receivables = await this.prisma.receivable.findMany({
      where: {
        quotationId: quotationId,
      },
      select: {
        id: true,
        totalAmount: true,
        description: true,
        notes: true,
        status: true,
        referenceDate: true,
        client: { select: { id: true, name: true } },
        nature: { select: { id: true, description: true } },
        subCategory: { select: { id: true, description: true } },
        installments: {
          select: {
            id: true,
            status: true,
            paymentMethod: { select: { id: true, name: true } },
            amount: true,
            paidAmount: true,
            additionalFee: true,
            dueDate: true,
            paidDate: true,
            installmentNumber: true,
          },
          orderBy: { installmentNumber: 'asc' },
        },
      },
    });

    if (!receivables || receivables.length === 0) {
      return null;
    }

    // Retornar dados combinados de todos os receivables do orçamento
    const totalAmount = receivables.reduce(
      (sum, receivable) => sum + (receivable.totalAmount || 0),
      0,
    );
    const totalPaid = receivables.reduce((sum, receivable) => {
      return (
        sum +
        receivable.installments.reduce((installmentSum, installment) => {
          return installmentSum + (installment.paidAmount || 0);
        }, 0)
      );
    }, 0);

    // Combinar todas as parcelas de todos os receivables
    const allInstallments = receivables
      .flatMap((receivable) =>
        receivable.installments.map((installment) => ({
          id: installment.id,
          status: installment.status,
          paymentMethod: {
            id: installment.paymentMethod?.id || null,
            name: installment.paymentMethod?.name || null,
          },
          value: installment.amount || 0,
          additionalFee: installment.additionalFee || 0,
          dueDate: installment.dueDate,
          paidValue: installment.paidAmount || 0,
          paymentDate: installment.paidDate,
          installmentNumber: installment.installmentNumber,
          receivableDescription: receivable.description,
        })),
      )
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());

    return {
      id: receivables[0].id, // ID do primeiro receivable (principal)
      totalValue: totalAmount,
      totalPaid: totalPaid,
      description:
        receivables.find((r) => !r.description?.includes('Entrada'))
          ?.description || receivables[0].description,
      client: receivables[0].client,
      subCategory: receivables[0].subCategory,
      nature: receivables[0].nature,
      installmentsQuantity: allInstallments.length,
      period: receivables[0].referenceDate,
      notes: receivables[0].notes,
      status: receivables[0].status,
      installments: allInstallments,
    };
  }

  async finishDeliverySchedule(id: string) {
    try {
      const deliverySchedule = await this.prisma.deliverySchedule.findUnique({
        where: { id },
        select: {
          id: true,
          order: {
            select: {
              id: true,
            },
          },
          quotation: {
            select: {
              id: true,
              receivable: true,
            },
          },
        },
      });

      if (!deliverySchedule) {
        throw new NotFoundException('Delivery Schedule not found');
      }

      return await this.prisma.$transaction(async (prisma) => {
        const status =
          deliverySchedule.quotation.receivable.length > 0
            ? 'DONE'
            : 'FINISHED';
        try {
          await prisma.deliverySchedule.update({
            where: { id },
            data: { status: status },
          });

          await prisma.order.update({
            where: { id: deliverySchedule.order.id },
            data: { status: 'FINISHED' },
          });
        } catch (error) {
          throw new InternalServerErrorException(
            'Failed to update delivery schedule and order status',
            {
              cause: error,
            },
          );
        }
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      if (error instanceof InternalServerErrorException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'An unexpected error occurred while finishing delivery schedule',
        {
          cause: error,
        },
      );
    }
  }
}
