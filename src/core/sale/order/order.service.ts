import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CancelOrderDto, CreateOrderDto } from './dto/create-order.dto';
import { PrismaService } from 'nestjs-prisma';
import { FilterOrderDto } from './dto/filter.dto';
import { Order, OrderStatus, Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { ORDER_FIND_ONE_INCLUDE } from './order.includes';
import { transformOrderToResponse } from './order.transformers';

export interface OrderGroup {
  date: string;
  orders: Order[];
}

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);
  constructor(private prisma: PrismaService) {}

  async create(createOrderDto: CreateOrderDto) {
    const order = await this.prisma.order.create({
      data: {
        quotationId: createOrderDto.quotationId,
        status: OrderStatus.PENDING,
      },
    });

    return order;
  }

  async findAll(dto: FilterOrderDto) {
    try {
      const where: Prisma.OrderWhereInput = {};
      const quotationFilters: Prisma.QuotationWhereInput = {};

      // Filtros básicos - acumulando em quotationFilters
      if (dto.companyId) {
        quotationFilters.companyId = dto.companyId;
      }

      if (dto.status) {
        where.status = dto.status;
      }

      if (dto.sellerId) {
        quotationFilters.sellerId = dto.sellerId;
      }

      if (dto.serieId) {
        quotationFilters.seriesId = dto.serieId;
      }

      if (dto.clientId) {
        quotationFilters.clientId = dto.clientId;
      }

      // Filtro por fase de emissão fiscal
      if (dto.nfeStatus === 'EMITIDA') {
        where.nfes = { some: { status: 'AUTHORIZED' } };
      } else if (dto.nfeStatus === 'EM_DIGITACAO') {
        where.nfes = {
          some: { status: 'DRAFT' },
          none: { status: 'AUTHORIZED' },
        };
      } else if (dto.nfeStatus === 'TODAS') {
        // Sem filtro de NFE, mas se for tela de NFE, esconder canceladas sem NF
        where.OR = [
          { status: { not: OrderStatus.CANCELED } },
          { nfes: { some: {} } },
        ];
      } else if (dto.nfeStatus) {
        // Padrão (NAO_EMITIDA): ordens sem nenhuma NF AUTHORIZED ou DRAFT e que NÃO estão canceladas
        // Isso permite que ordens com NF rejeitadas ou com erro ainda apareçam para serem reemitidas
        where.nfes = { none: { status: { in: ['AUTHORIZED', 'DRAFT'] } } };
        where.status = { not: OrderStatus.CANCELED };
      }

      // Busca por texto - combinando com os filtros existentes
      if (dto.search) {
        quotationFilters.OR = [
          { description: { contains: dto.search, mode: 'insensitive' } },
          {
            client: { name: { contains: dto.search, mode: 'insensitive' } },
          },
          {
            seller: {
              user: { name: { contains: dto.search, mode: 'insensitive' } },
            },
          },
        ];
      }

      // Aplicar filtros de quotation se houver algum
      if (Object.keys(quotationFilters).length > 0) {
        where.quotation = { is: quotationFilters };
      }

      const totalOrders = await this.prisma.order.count({ where });

      const orders = await this.prisma.order.findMany({
        where,
        include: {
          quotation: {
            include: {
              seller: {
                include: {
                  user: {
                    select: { name: true },
                  },
                },
              },
              series: {
                select: {
                  id: true,
                  title: true,
                  code: true,
                },
              },
              client: {
                select: { id: true, name: true, email: true },
              },
              contactSource: {
                select: { id: true, name: true },
              },
              tag: true,
              deliveryInfo: {
                select: {
                  value: true,
                },
              },
              quotationPayment: {
                select: {
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
          },
          nfes: {
            where: { status: { in: ['AUTHORIZED', 'DRAFT'] } },
            orderBy: { createdAt: 'desc' },
            take: 2,
            select: {
              id: true,
              numero: true,
              serie: true,
              status: true,
              danfeUrl: true,
            },
          },
        },
        take: Number(dto.limit),
        skip: (Number(dto.page) - 1) * Number(dto.limit),
        orderBy: { createdAt: 'desc' },
      });

      const grouped = orders.reduce((acc, order) => {
        const date = order.createdAt.toISOString().split('T')[0];
        if (!acc[date]) {
          acc[date] = { date, orders: [] };
        }

        const quotation = order.quotation;
        acc[date].orders.push({
          id: order.id,
          status: order.status,
          quotation: {
            id: quotation.id,
            description: quotation.description,
            status: quotation.status,
            dueDate: quotation.dueDate,
            totalValue: quotation.totalValue,
            approvedAt: quotation.approvedAt,
            tag: quotation.tag
              ? {
                  id: quotation.tag.id,
                  text: quotation.tag.title,
                  color: quotation.tag.color,
                }
              : null,
            quickSale: quotation.quickSale || false,
            serie: quotation.series
              ? {
                  id: quotation.series.id,
                  name: quotation.series.title,
                  code: quotation.series.code,
                  quotation: quotation.quotationNumber,
                }
              : null,
            client: quotation.client
              ? {
                  id: quotation.client.id,
                  name: quotation.client.name,
                  email: quotation.client.email,
                }
              : null,
            seller: quotation.seller
              ? {
                  id: quotation.seller.id,
                  name: quotation.seller.name ?? quotation.seller.user.name,
                }
              : null,
            deliveryInfo: quotation.deliveryInfo,
            quotationPayment: quotation.quotationPayment,
          },
          nfes: order.nfes || [],
        });

        return acc;
      }, {});
      // Transformar o agrupamento em um array de objetos
      const data = Object.values(grouped);

      const lastPage = Math.ceil(totalOrders / Number(dto.limit));

      return {
        total: totalOrders,
        lastPage,
        data,
      };
    } catch (error) {
      this.logger.error('Error fetching orders', error.stack);
      throw new Error('Erro ao buscar os pedidos.');
    }
  }

  async findAllQuantity(companyId: string, sellerId?: string) {
    const allStatuses: OrderStatus[] = [
      'PENDING',
      'IN_PRODUCTION',
      'CANCELED',
      'FINISHED',
    ];

    // Build quotation filter with optional sellerId
    const quotationFilter: any = { companyId };
    if (sellerId) {
      quotationFilter.sellerId = sellerId;
    }

    const result = await this.prisma.order.groupBy({
      by: ['status'],
      where: {
        quotation: quotationFilter,
        status: {
          in: [
            'PENDING',
            'IN_PRODUCTION',
            'CANCELED',
            'COMPLETED',
            'FINISHED',
            'DELIVERY',
          ],
        },
      },
      _count: true,
    });

    const statusCount = allStatuses.reduce(
      (acc, status) => {
        acc[status] = 0;
        return acc;
      },
      {} as { [K in OrderStatus]: number },
    );

    result.forEach((cur) => {
      if (cur.status === 'COMPLETED' || cur.status === 'DELIVERY') {
        statusCount['IN_PRODUCTION'] += cur._count;
      } else {
        statusCount[cur.status] = cur._count;
      }
    });

    const total = Object.values(statusCount).reduce((acc, cur) => acc + cur, 0);

    return {
      ...statusCount,
      TOTAL: total,
    };
  }

  async count(companyId?: string) {
    return this.prisma.order.count({
      where: companyId ? { quotation: { companyId } } : undefined,
    });
  }

  async findOne(id: string) {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id },
        include: ORDER_FIND_ONE_INCLUDE,
      });

      if (!order) {
        throw new NotFoundException('Pedido não encontrado');
      }

      const quotation = order.quotation;
      const financialTableData = await this.buildFinancialTableData(
        quotation.id,
        quotation.client,
        quotation.quotationPayment,
        quotation.deliveryInfo,
      );

      return transformOrderToResponse(order as any, financialTableData);
    } catch (error) {
      this.logger.error('Error fetching order', error.stack);
      throw new InternalServerErrorException(
        'Erro ao buscar a ordem de serviço.',
      );
    }
  }

  private async verifySellerPermission(sellerId: string) {
    const seller = await this.prisma.sellerProfile.findFirst({
      where: {
        employees: {
          some: {
            user: {
              id: sellerId,
            },
          },
        },
      },
      select: {
        id: true,
        canCancelSale: true,
      },
    });

    // If no seller profile found (deleted, admin user, etc.), allow the operation
    if (!seller) {
      return;
    }

    if (!seller.canCancelSale) {
      throw new ForbiddenException(
        'Você não tem permissão para cancelar uma ordem de serviço.',
      );
    }
  }

  async cancelOrder(orderId: string, dto: CancelOrderDto, sellerId: string) {
    await this.verifySellerPermission(sellerId);
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        quotation: {
          select: {
            id: true,
          },
        },
      },
    });
    if (!order) {
      throw new NotFoundException('Ordem de serviço não encontrada.');
    }

    // Validate reason before transaction
    if (dto.reasonId) {
      const reason = await this.prisma.reasons.findFirst({
        where: { id: dto.reasonId },
      });

      if (!reason) {
        throw new NotFoundException('Motivo de cancelamento não encontrado.');
      }
    }

    const quotationId = order.quotation.id;

    try {
      return await this.prisma.$transaction(async (prisma) => {
        // Count installments before cancellation
        const [totalReceivableInstallments, totalPayableInstallments] =
          await Promise.all([
            prisma.receivableInstallment.count({
              where: { receivable: { quotationId } },
            }),
            prisma.payableInstallment.count({
              where: { payable: { quotationId } },
            }),
          ]);

        // Fetch all receivables and payables
        const [receivables, payables] = await Promise.all([
          prisma.receivable.findMany({
            where: { quotationId },
            include: { installments: true },
          }),
          prisma.payable.findMany({
            where: { quotationId },
            include: { installments: true },
          }),
        ]);

        // Cancel pending receivable installments and mark receivables as canceled
        let canceledReceivableInstallmentsCount = 0;
        for (const receivable of receivables) {
          const pendingCount = receivable.installments.filter(
            (inst) => inst.status === 'PENDING' || inst.status === 'OVERDUE',
          ).length;

          if (pendingCount > 0) {
            await prisma.receivableInstallment.updateMany({
              where: {
                receivableId: receivable.id,
                status: { in: ['PENDING', 'OVERDUE'] },
              },
              data: { status: 'CANCELED' },
            });
            canceledReceivableInstallmentsCount += pendingCount;
          }

          await prisma.receivable.update({
            where: { id: receivable.id },
            data: {
              status: 'CANCELED',
              cancelReason:
                'Cancelado automaticamente pelo cancelamento da ordem de serviço',
            },
          });
        }

        // Cancel pending payable installments and mark payables as canceled
        let canceledPayableInstallmentsCount = 0;
        for (const payable of payables) {
          const pendingCount = payable.installments.filter(
            (inst) => inst.status === 'PENDING' || inst.status === 'OVERDUE',
          ).length;

          if (pendingCount > 0) {
            await prisma.payableInstallment.updateMany({
              where: {
                payableId: payable.id,
                status: { in: ['PENDING', 'OVERDUE'] },
              },
              data: { status: 'CANCELED' },
            });
            canceledPayableInstallmentsCount += pendingCount;
          }

          await prisma.payable.update({
            where: { id: payable.id },
            data: {
              status: 'CANCELED',
              cancelReason:
                'Cancelado automaticamente pelo cancelamento da ordem de serviço',
            },
          });
        }

        // Cancel delivery schedule (updateMany won't fail if not found)
        await prisma.deliverySchedule.updateMany({
          where: { quotationId },
          data: { status: 'CANCELED' },
        });

        // Cancel the order
        const updatedOrder = await prisma.order.update({
          where: { id: orderId },
          data: {
            canceledAt: new Date(),
            status: OrderStatus.CANCELED,
            reasonId: dto.reasonId || null,
          },
        });

        // History: register order cancellation
        try {
          const user = await prisma.user.findUnique({
            where: { id: sellerId },
            select: { name: true },
          });
          await prisma.orderHistory.create({
            data: {
              orderId,
              action: 'CANCELED',
              description: `Ordem de serviço cancelada por ${user?.name || 'Usuário'}`,
              metadata: {
                reasonId: dto.reasonId || null,
                canceledReceivableInstallments:
                  canceledReceivableInstallmentsCount,
                canceledPayableInstallments: canceledPayableInstallmentsCount,
                keptReceivableInstallments:
                  totalReceivableInstallments -
                  canceledReceivableInstallmentsCount,
                keptPayableInstallments:
                  totalPayableInstallments - canceledPayableInstallmentsCount,
              },
              createdBy: sellerId,
              createdByName: user?.name || null,
            } as any,
          });
        } catch (historyError) {
          // Non-blocking: don't fail cancellation if history fails
          this.logger.error(
            'Error creating order cancel history',
            historyError.stack,
          );
        }

        // Calculate summary
        const keptReceivableInstallments =
          totalReceivableInstallments - canceledReceivableInstallmentsCount;
        const keptPayableInstallments =
          totalPayableInstallments - canceledPayableInstallmentsCount;

        return {
          order: updatedOrder,
          canceledInstallments: {
            receivables: canceledReceivableInstallmentsCount,
            payables: canceledPayableInstallmentsCount,
            total:
              canceledReceivableInstallmentsCount +
              canceledPayableInstallmentsCount,
          },
          keptInstallments: {
            receivables: keptReceivableInstallments,
            payables: keptPayableInstallments,
            total: keptReceivableInstallments + keptPayableInstallments,
          },
          summary: {
            totalInstallments:
              totalReceivableInstallments + totalPayableInstallments,
            canceledInstallments:
              canceledReceivableInstallmentsCount +
              canceledPayableInstallmentsCount,
            keptInstallments:
              keptReceivableInstallments + keptPayableInstallments,
          },
        };
      });
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError) {
        throw new BadRequestException(
          'Erro na base de dados ao cancelar a ordem.',
        );
      }
      this.logger.error('Error canceling order', error.stack);
      throw new InternalServerErrorException(
        'Erro interno ao cancelar a ordem.',
      );
    }
  }
  remove(id: string) {
    return this.prisma.order.update({
      where: { id },
      data: { isActive: false },
    });
  }

  /**
   * Constrói os dados da tabela financeira
   * Prioriza dados reais de receivable/payable quando existirem
   * Faz fallback para dados do quotation quando não houver movimentações financeiras criadas
   */
  private async buildFinancialTableData(
    quotationId: string,
    client: any,
    quotationPayment: any,
    deliveryInfo: any,
  ) {
    // Buscar receivables e payables reais do banco
    const [receivables, payables] = await Promise.all([
      this.prisma.receivable.findMany({
        where: { quotationId },
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
        orderBy: {
          createdAt: 'asc',
        },
      }),
      this.prisma.payable.findMany({
        where: { quotationId },
        include: {
          installments: {
            include: {
              paymentCondition: true,
            },
            orderBy: {
              installmentNumber: 'asc',
            },
          },
          supplier: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
      }),
    ]);

    // Se existirem receivables/payables, usar dados reais
    if (receivables.length > 0 || payables.length > 0) {
      return this.buildFromRealFinancialData(receivables, payables, client);
    }

    // Caso contrário, construir dados "fictícios" baseados no quotationPayment
    return this.buildFromQuotationData(client, quotationPayment, deliveryInfo);
  }

  /**
   * Constrói dados financeiros a partir de receivables e payables reais do banco
   */
  private buildFromRealFinancialData(
    receivables: any[],
    payables: any[],
    client: any,
  ) {
    const paymentInstallments = [];
    const commissionInstallments = [];
    const deliveryInstallments = [];

    let installmentId = 1;

    // Processar RECEIVABLES (receitas - pagamentos do cliente)
    receivables.forEach((receivable) => {
      receivable.installments.forEach((installment) => {
        paymentInstallments.push({
          id: installmentId++,
          company: client.name,
          method: installment.paymentCondition?.name || 'A definir',
          installmentNumber: installment.installmentNumber,
          installmentTotal: receivable.installmentQty,
          status: installment.status,
          dueAmount: installment.amount + (installment.additionalFee || 0),
          dueDate: new Date(installment.dueDate).toLocaleDateString('pt-BR'),
          paidAmount: installment.paidAmount || 0,
          paidDate: installment.paidDate
            ? new Date(installment.paidDate).toLocaleDateString('pt-BR')
            : null,
          financialType: receivable.financialType, // DOWN_PAYMENT ou MAIN
        });
      });
    });

    // Processar PAYABLES (despesas - comissões e frete)
    payables.forEach((payable) => {
      const isCommission = payable.financialType === 'COMMISSION';
      const isDelivery = payable.financialType === 'DELIVERY';

      payable.installments.forEach((installment) => {
        const installmentData = {
          id: installmentId++,
          company: payable.supplier?.name || 'Fornecedor',
          method: isCommission ? 'Comissão' : 'Frete',
          installmentNumber: installment.installmentNumber,
          installmentTotal: payable.installmentQty,
          status: installment.status,
          dueAmount: installment.amount + (installment.additionalFee || 0),
          dueDate: new Date(installment.dueDate).toLocaleDateString('pt-BR'),
          paidAmount: installment.paidAmount || 0,
          paidDate: installment.paidDate
            ? new Date(installment.paidDate).toLocaleDateString('pt-BR')
            : null,
        };

        if (isCommission) {
          commissionInstallments.push(installmentData);
        } else if (isDelivery) {
          deliveryInstallments.push(installmentData);
        }
      });
    });

    return {
      payment: paymentInstallments,
      commission: commissionInstallments,
      delivery: deliveryInstallments,
    };
  }

  /**
   * Constrói dados financeiros "fictícios" baseados no quotationPayment
   * Usado quando ainda não foram criados receivables/payables
   */
  private buildFromQuotationData(
    client: any,
    quotationPayment: any,
    deliveryInfo: any,
  ) {
    const { quotationInstallment, commission, downPayment } = quotationPayment;
    const paymentInstallments = [];
    const commissionInstallments = [];
    const deliveryInstallments = [];

    let installmentId = 1;

    // Processar Entrada (Down Payment) se existir
    if (downPayment && downPayment > 0) {
      paymentInstallments.push({
        id: installmentId++,
        company: client.name,
        method: 'Entrada',
        installmentNumber: 1,
        installmentTotal: 1,
        status: 'PENDING',
        dueAmount: downPayment,
        dueDate: quotationPayment.downPaymentDueDate
          ? new Date(quotationPayment.downPaymentDueDate).toLocaleDateString(
              'pt-BR',
            )
          : new Date().toLocaleDateString('pt-BR'),
        paidAmount: 0,
        paidDate: null,
        financialType: 'DOWN_PAYMENT',
      });
    }

    // Processar parcelas principais (Payment)
    quotationInstallment.forEach((installment, index) => {
      paymentInstallments.push({
        id: installmentId++,
        company: client.name,
        method: installment.paymentCondition?.name || 'A definir',
        installmentNumber: index + 1,
        installmentTotal: quotationInstallment.length,
        status: 'PENDING',
        dueAmount: installment.value + (installment.additionalFee || 0),
        dueDate: new Date(installment.dueDate).toLocaleDateString('pt-BR'),
        paidAmount: 0,
        paidDate: null,
        financialType: 'MAIN',
      });
    });

    // Processar Comissão (Commission)
    if (commission && commission.totalCommission > 0) {
      if (commission.transferMethod === 'SINGLE') {
        commissionInstallments.push({
          id: installmentId++,
          company: commission.supplier?.name || 'Vendedor',
          method: 'Comissão',
          installmentNumber: 1,
          installmentTotal: 1,
          status: 'PENDING',
          dueAmount: commission.totalCommission,
          dueDate: new Date(
            Date.now() + 30 * 24 * 60 * 60 * 1000,
          ).toLocaleDateString('pt-BR'),
          paidAmount: 0,
          paidDate: null,
        });
      } else if (commission.transferMethod === 'PAYMENT_BASED') {
        const installmentValue =
          commission.totalCommission / quotationInstallment.length;
        quotationInstallment.forEach((installment, index) => {
          commissionInstallments.push({
            id: installmentId++,
            company: commission.supplier?.name || 'Vendedor',
            method: 'Comissão',
            installmentNumber: index + 1,
            installmentTotal: quotationInstallment.length,
            status: 'PENDING',
            dueAmount: installmentValue,
            dueDate: new Date(installment.dueDate).toLocaleDateString('pt-BR'),
            paidAmount: 0,
            paidDate: null,
          });
        });
      }
    }

    // Processar Frete (Delivery)
    if (deliveryInfo && deliveryInfo.cost > 0) {
      deliveryInstallments.push({
        id: installmentId++,
        company: deliveryInfo.supplier?.name || 'Transportadora',
        method: 'Frete',
        installmentNumber: 1,
        installmentTotal: 1,
        status: 'PENDING',
        dueAmount: deliveryInfo.cost,
        dueDate: deliveryInfo.estimatedDate
          ? new Date(deliveryInfo.estimatedDate).toLocaleDateString('pt-BR')
          : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString(
              'pt-BR',
            ),
        paidAmount: 0,
        paidDate: null,
      });
    }

    return {
      payment: paymentInstallments,
      commission: commissionInstallments,
      delivery: deliveryInstallments,
    };
  }
}
