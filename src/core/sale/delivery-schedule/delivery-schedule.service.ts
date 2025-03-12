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
    const quotation = await this.prisma.quotation.findUnique({
      where: { id: quotationId },
      include: {
        series: {
          select: {
            id: true,
            title: true,
            code: true,
          },
        },
        seller: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        company: {
          select: {
            id: true,
            name: true,
            cnpj: true,
          },
        },
        client: {
          select: {
            id: true,
            type: true,
            name: true,
            status: true,
            cnpj: true,
            cpf: true,
            email: true,
            phone: true,
          },
        },
        deliveryInfo: {
          include: {
            supplier: true,
          },
        },
        DeliverySchedule: true,
        quotationProduct: {
          include: {
            product: true,
            items: {
              select: {
                id: true,
                productItemId: true,
                name: true,
                unitOfMeasure: true,
                salePrice: true,
                quantity: true,
                unitCost: true,
                totalValue: true,
              },
              orderBy: {
                createdAt: 'asc',
              },
            },
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
        tag: {
          select: {
            id: true,
            title: true,
            color: true,
          },
        },
        payable: true,
        receivable: true,
        quotationPayment: {
          include: {
            commission: {
              include: {
                supplier: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
            downPaymentCondition: {
              include: {
                paymentMethod: true,
              },
            },
            paymentMethod: true,
            paymentCondition: true,
            quotationInstallment: {
              include: {
                paymentMethod: true,
                payableInstallment: true,
                receivableInstallment: true,
              },
            },
          },
        },
      },
    });
    if (!quotation) {
      throw new Error('Orçamento não encontrado.');
    }
    if (
      quotation.DeliverySchedule &&
      quotation.DeliverySchedule.status === 'FINISHED'
    ) {
      await this.prisma.deliverySchedule.update({
        where: { id: quotation.DeliverySchedule.id },
        data: { status: 'DONE' },
      });
    }
    const receivable = await this.generateReceivableFromQuotation(quotation);

    const payable = await this.generatePayableFromQuotation(quotation);

    return { quotation, receivable, payable };
  }

  private async generatePayableFromQuotation(quotation: any) {
    const commission = quotation.quotationPayment.commission;
    const delivery = quotation.deliveryInfo;
    if (!commission || !delivery) {
      return null;
    }

    // Criar conta a pagar da comissão
    const payableCommision = await this.prisma.payable.create({
      data: {
        referenceDate: new Date(),
        description: `Comissão da venda ${quotation.quotationNumber}-${quotation.series.code} - ${quotation.description || ''}`,
        notes: quotation.quotationPayment.description || '',
        totalAmount: commission.totalCommission || 0,
        installmentQty:
          commission.transferMethod === 'PAYMENT_BASED'
            ? quotation.quotationPayment.quotationInstallment.length
            : 1,
        status: 'PENDING',
        supplierId: commission.supplierId,
        companyId: quotation.companyId,
        natureId: null, // Substitua se houver uma natureza predefinida
        subCategoryId: null, // Substitua se houver uma subcategoria predefinida
        quotationId: quotation.id,
        commission: {
          connect: {
            id: commission.id,
          },
        },
      },
    });

    // Criar parcelas de comissão
    if (payableCommision) {
      if (commission.transferMethod === 'SINGLE') {
        await this.prisma.payableInstallment.create({
          data: {
            payableId: payableCommision.id,
            installmentNumber: 1,
            dueDate: add(new Date(), { days: 30 }),
            amount: commission.totalCommission,
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
              payableId: payableCommision.id,
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

        await this.prisma.payableInstallment.createMany({
          data: installments,
        });
      }
    }

    // Criar conta a pagar da entrega
    const payableDelivery = await this.prisma.payable.create({
      data: {
        referenceDate: new Date(),
        description: `Entrega da venda ${quotation.quotationNumber}-${quotation.series.code} - ${quotation.description || ''}`,
        notes: quotation.quotationPayment.description || '',
        totalAmount: delivery.cost || 0,
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
      await this.prisma.payableInstallment.create({
        data: {
          payableId: payableDelivery.id,
          installmentNumber: 1,
          dueDate: add(new Date(), { days: 30 }),
          amount: delivery.cost,
          additionalFee: 0,
          paymentMethodId: null,
          status: 'PENDING',
          paidDate: null,
        },
      });
    }

    return { payableCommision, payableDelivery };
  }

  private async generateReceivableFromQuotation(quotation: any) {
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
    try {
      // Iniciar uma transação Prisma
      return await this.prisma.$transaction(async (prisma) => {
        if (downPayment && downPayment > 0) {
          const receivableDownPayment = await prisma.receivable.create({
            data: {
              referenceDate: new Date(),
              description: `Entrada da venda ${quotation.quotationNumber}-${quotation.series.code} - ${quotation.description || ''}`,
              notes: quotation.quotationPayment.description || '',
              totalAmount: downPayment,
              installmentQty: 1,
              status: 'PENDING',
              clientId: quotation.clientId,
              companyId: quotation.companyId, // Certifique-se de passar o `companyId`
              natureId: null, // Substitua se houver uma natureza predefinida
              subCategoryId: null, // Substitua se houver uma subcategoria predefinida
              quotationId: quotation.id, // Associar ao orçamento, se necessário
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

        // Criar o Receivable
        const receivable = await prisma.receivable.create({
          data: {
            referenceDate: new Date(),
            description: `Venda ${quotation.quotationNumber}-${quotation.series.code} - ${quotation.description || ''}`,
            notes: quotation.quotationPayment.description || '',
            totalAmount,
            installmentQty: quotationInstallments.length,
            status: 'PENDING',
            clientId: quotation.clientId,
            companyId: quotation.companyId, // Certifique-se de passar o `companyId`
            natureId: null, // Substitua se houver uma natureza predefinida
            subCategoryId: null, // Substitua se houver uma subcategoria predefinida
            quotationId: quotation.id, // Associar ao orçamento, se necessário
          },
        });

        // Preparar as parcelas
        const installments = quotationInstallments.map(
          (installment: any, index: number) => ({
            receivableId: receivable.id,
            installmentNumber: index + 1, // Adicionar o número da parcela
            dueDate: installment.dueDate,
            amount: installment.value,
            additionalFee: installment.additionalFee || 0,
            paymentMethodId: installment.paymentMethodId,
            status: 'PENDING',
            paidDate: null,
          }),
        );
        // Criar as parcelas
        await prisma.receivableInstallment.createMany({
          data: installments,
        });

        return receivable;
      });
    } catch (error) {
      // Log do erro para análise
      console.error('Erro ao gerar contas a receber:', error);

      // Lançar o erro novamente para que o chamador possa tratá-lo
      throw new Error(
        'Erro ao gerar contas a receber. Detalhes: ' + error.message,
      );
    }
  }

  async getFinancialDataById(quotationId: string) {
    const installments = await this.prisma.receivableInstallment.findMany({
      where: {
        receivable: {
          id: quotationId,
        },
      },
      select: {
        id: true,
        status: true,
        amount: true,
        additionalFee: true,
        paidDate: true,
        dueDate: true,
        receivable: {
          select: {
            id: true,
            totalAmount: true,
            description: true,
            notes: true,
            status: true,
            referenceDate: true,
            client: { select: { id: true, name: true } },
            // supplier: { select: { id: true, name: true } },
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
              },
              orderBy: { dueDate: 'desc' },
            },
          },
        },
      },
    });

    if (!installments || installments.length === 0) {
      return null;
    }

    const receivables = installments.map((inst) => {
      return {
        id: inst.receivable?.id || null,
        totalValue: inst.receivable?.totalAmount || 0,
        totalPaid: (inst.receivable?.installments || []).reduce((sum, item) => {
          return sum + (item.paidAmount ?? 0);
        }, 0),
        description: inst.receivable?.description || '',
        client: inst.receivable?.client
          ? {
              id: inst.receivable.client.id,
              name: inst.receivable.client.name,
            }
          : null,
        subCategory: inst.receivable?.subCategory
          ? {
              id: inst.receivable.subCategory.id,
              name: inst.receivable.subCategory.description,
            }
          : null,
        nature: inst.receivable?.nature
          ? {
              id: inst.receivable.nature.id,
              name: inst.receivable.nature.description,
            }
          : null,
        installmentsQuantity: inst.receivable?.installments?.length || 0,
        period: inst.receivable?.referenceDate || null,
        notes: inst.receivable?.notes || '',
        status: inst.receivable?.status || 'UNKNOWN',
        installments: (inst.receivable?.installments || [])
          .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime()) // Ordenando as parcelas pela data de vencimento
          .map((installment) => ({
            id: installment.id || null,
            status: installment.status || 'UNKNOWN',
            paymentMethod: {
              id: installment.paymentMethod?.id || null,
              name: installment.paymentMethod?.name || null,
            },
            value: installment.amount || 0,
            additionalFee: installment.additionalFee || 0,
            dueDate: installment.dueDate || null,
            paidValue: installment.paidAmount || 0, // Ajuste baseado nos requisitos.
            paymentDate: installment.paidDate || null,
            current: installment.id === inst.id, // Definindo se a parcela é a atual
          })),
      };
    });
    return receivables[0];
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
