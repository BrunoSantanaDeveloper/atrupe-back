import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CancelOrderDto, CreateOrderDto } from './dto/create-order.dto';
import { PrismaService } from 'nestjs-prisma';
import { FilterOrderDto } from './dto/filter.dto';
import { Order, OrderStatus, Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

export interface OrderGroup {
  date: string;
  orders: Order[];
}

@Injectable()
export class OrderService {
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
            },
          },
          nfes: {
            where: { status: 'AUTHORIZED' },
            orderBy: { createdAt: 'desc' },
            take: 1,
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
      console.error(error);
      throw new Error('Erro ao buscar os pedidos.');
    }
  }

  async findAllQuantity(companyId: string) {
    const allStatuses: OrderStatus[] = [
      'PENDING',
      'IN_PRODUCTION',
      'CANCELED',
      'FINISHED',
    ];

    const result = await this.prisma.order.groupBy({
      by: ['status'],
      where: {
        quotation: { companyId },
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

  async count() {
    return this.prisma.order.count();
  }

  async findOne(id: string) {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id },
        include: {
          quotation: {
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
              contact: {
                select: {
                  id: true,
                  name: true,
                },
              },
              contactSource: {
                select: {
                  id: true,
                  name: true,
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
                  deliverySchedule: true,
                  clientAddress: {
                    select: {
                      id: true,
                      street: true,
                      number: true,
                      complement: true,
                      neighborhood: true,
                      city: true,
                      state: true,
                      zipcode: true,
                      type: true,
                    },
                  },
                },
              },
              quotationProduct: {
                include: {
                  product: true,
                  items: {
                    select: {
                      id: true,
                      productItemId: true,
                      name: true,
                      unitKind: true,
                      salePrice: true,
                      quantity: true,
                      unitCost: true,
                      totalValue: true,
                      originalQuantity: true,
                      weight: true,
                      width: true,
                      height: true,
                      length: true,
                      duration: true,
                      distance: true,
                      volume: true,
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
                select: {
                  id: true,
                  type: true,
                  billing: true,
                  discountValue: true,
                  discountType: true,
                  discountTotal: true,
                  downPayment: true,
                  downPaymentConditionId: true,
                  downPaymentDueDate: true,
                  downPaymentAdditionalFee: true,
                  installmentQty: true,
                  minInstallmentQty: true,
                  maxInstallmentQty: true,
                  mainAdditionalFee: true,
                  additionalFeeType: true,
                  totalValue: true,
                  finalValue: true,
                  description: true,
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
                  paymentCondition: {
                    include: {
                      paymentMethod: {
                        select: {
                          id: true,
                          name: true,
                        },
                      },
                    },
                  },
                  quotationInstallment: {
                    include: {
                      paymentCondition: true,
                      payableInstallment: true,
                      receivableInstallment: true,
                    },
                  },
                },
              },
            },
          },
          nfes: {
            where: { status: 'AUTHORIZED' },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              numero: true,
              serie: true,
              status: true,
              chaveAcesso: true,
              danfeUrl: true,
              dataEmissao: true,
            },
          },
        },
      });
      if (!order) {
        throw new Error('Order not found');
      }

      const quotation = order.quotation;

      const financialTableData = await this.buildFinancialTableData(
        quotation.id,
        quotation.client,
        quotation.quotationPayment,
        quotation.deliveryInfo,
      );
      const formattedQuotation = {
        id: quotation.id,
        description: quotation.description,
        createdAt: quotation.createdAt,
        approvedAt: quotation.approvedAt,
        finishedAt: quotation.finishedAt,
        status: quotation.status,
        dueDate: quotation.dueDate,
        totalValue: quotation.totalValue,
        contactSource: quotation.contactSource,
        quickSale: quotation.quickSale || false,
        serie: quotation.series
          ? {
              id: quotation.series.id,
              name: quotation.series.title,
              code: quotation.series.code,
              quotation: quotation.quotationNumber,
            }
          : null,
        seller: quotation.seller
          ? {
              id: quotation.seller.id,
              name: quotation.seller.name ?? quotation.seller.user.name,
            }
          : null,
        contact: quotation.contact
          ? {
              id: quotation.contact.id,
              name: quotation.contact.name,
            }
          : null,
        company: quotation.company
          ? {
              id: quotation.company.id,
              name: quotation.company.name,
              cnpj: quotation.company.cnpj,
            }
          : null,
        deliveryInfo: quotation.deliveryInfo
          ? {
              id: quotation.deliveryInfo.id,
              status: quotation.deliveryInfo.deliverySchedule?.status,
              type: quotation.deliveryInfo.deliveryType,
              timeFrame: quotation.deliveryInfo.daysAfterApproval,
              estimateDate: quotation.deliveryInfo.estimatedDate,
              cost: quotation.deliveryInfo.cost,
              value: quotation.deliveryInfo.value,
              notes: quotation.deliveryInfo.notes,
              modality: quotation.deliveryInfo.modality,
              clientAddressId: quotation.deliveryInfo.clientAddressId,
              clientAddress: quotation.deliveryInfo.clientAddress
                ? {
                    id: quotation.deliveryInfo.clientAddress.id,
                    street: quotation.deliveryInfo.clientAddress.street,
                    number: quotation.deliveryInfo.clientAddress.number,
                    complement: quotation.deliveryInfo.clientAddress.complement,
                    neighborhood:
                      quotation.deliveryInfo.clientAddress.neighborhood,
                    city: quotation.deliveryInfo.clientAddress.city,
                    state: quotation.deliveryInfo.clientAddress.state,
                    zipcode: quotation.deliveryInfo.clientAddress.zipcode,
                    type: quotation.deliveryInfo.clientAddress.type,
                  }
                : null,
              supplier: quotation.deliveryInfo.supplier
                ? {
                    id: quotation.deliveryInfo.supplier.id,
                    name: quotation.deliveryInfo.supplier.name,
                  }
                : null,
            }
          : null,
        client: quotation.client
          ? {
              id: quotation.client.id,
              type: quotation.client.type,
              name: quotation.client.name,
              status: quotation.client.status,
              cnpj: quotation.client.cnpj,
              cpf: quotation.client.cpf,
              email: quotation.client.email,
              phoneNumber: quotation.client.phone,
            }
          : null,
        tag: quotation.tag
          ? {
              id: quotation.tag.id,
              text: quotation.tag.title,
              color: quotation.tag.color,
            }
          : null,
        quotationItems: quotation.quotationProduct.map((qp) => ({
          id: qp.id,
          description: qp.description,
          allowEditDescription: qp.allowEditDescription,
          allowEditValues: qp.allowEditValues,
          technicalDescription: qp.technicalDescription,
          notes: qp.notes,
          discountType: qp.discountType,
          discount: qp.discount,
          unitValue: (() => {
            // Usar valores já calculados do banco ao invés de recalcular
            const unitValue = qp.items.reduce((total, item) => {
              return total + (item.unitCost || 0);
            }, 0);
            return unitValue;
          })(),
          totalValue: qp.items.reduce(
            (total, item) => total + item.totalValue,
            0,
          ),
          finalValue: qp.finalValue,
          image: (() => {
            if (qp.imageUrl) {
              // Se a imagem do produto no orçamento for diferente da imagem original do produto
              const isOriginal = qp.imageUrl === qp.product.imageUrl;
              return { url: qp.imageUrl, original: isOriginal };
            } else {
              return { url: qp.product.imageUrl, original: true };
            }
          })(),
          product: {
            originalProductId: qp.productId,
            name: qp.product.name,
            quantity: qp.quantity,
            unitValue: (() => {
              // Usar valores já calculados do banco ao invés de recalcular
              const unitValue = qp.items.reduce((total, item) => {
                return total + (item.unitCost || 0);
              }, 0);
              return unitValue;
            })(),
            finalValue: qp.items.reduce(
              (total, item) => total + item.totalValue,
              0,
            ),
            compositions: qp.items.map((item) => ({
              id: item.id,
              originalCompositionId: item.productItemId,
              name: item.name,
              unitKind: item.unitKind,
              quantity: item.quantity,
              originalQuantity: item.originalQuantity,
              unitValue: item.unitCost || 0,
              totalValue: item.totalValue,
              weight: item.weight,
              width: item.width,
              height: item.height,
              duration: item.duration,
              length: item.length,
              distance: item.distance,
              volume: item.volume,
            })),
          },
        })),
        paymentConditions: quotation.quotationPayment
          ? {
              id: quotation.quotationPayment.id,
              type: quotation.quotationPayment.type,
              billing: quotation.quotationPayment.billing,
              discount: {
                discountValue: quotation.quotationPayment.discountValue || 0,
                discountType:
                  quotation.quotationPayment.discountType || 'VALUE',
                discountTotal: quotation.quotationPayment.discountTotal || 0,
              },
              installmentQty: quotation.quotationPayment.installmentQty,
              minInstallmentQty: quotation.quotationPayment.minInstallmentQty,
              maxInstallmentQty: quotation.quotationPayment.maxInstallmentQty,
              mainAdditionalFee: quotation.quotationPayment.mainAdditionalFee,
              additionalFeeType: quotation.quotationPayment.additionalFeeType,
              hasDownPayment: quotation.quotationPayment.downPayment > 0,
              downPayment:
                quotation.quotationPayment.downPayment > 0
                  ? {
                      amount: quotation.quotationPayment.downPayment,
                      dueDate: quotation.quotationPayment.downPaymentDueDate,
                      additionalFee:
                        quotation.quotationPayment.downPaymentAdditionalFee,
                      paymentConditionId:
                        quotation.quotationPayment.downPaymentConditionId,
                    }
                  : null,
              paymentCondition: quotation.quotationPayment.paymentCondition
                ? {
                    id: quotation.quotationPayment.paymentCondition.id,
                    name: quotation.quotationPayment.paymentCondition.name,
                  }
                : null,
              totalValue: quotation.quotationPayment.totalValue,
              finalValue: quotation.quotationPayment.finalValue,
              description: quotation.quotationPayment.description,
              commission: quotation.quotationPayment.commission
                ? {
                    type: quotation.quotationPayment.commission.type,
                    supplier: {
                      id: quotation.quotationPayment.commission.supplier.id,
                      name: quotation.quotationPayment.commission.supplier.name,
                    },
                    transferMethod:
                      quotation.quotationPayment.commission.transferMethod,
                    commissionValue:
                      quotation.quotationPayment.commission.commissionValue,
                    commissionType:
                      quotation.quotationPayment.commission.commissionType,
                    totalCommission:
                      quotation.quotationPayment.commission.totalCommission,
                  }
                : null,
              installments:
                quotation.quotationPayment.quotationInstallment.length > 0
                  ? quotation.quotationPayment.quotationInstallment.map(
                      (installment, index) => ({
                        id: installment.id,
                        installmentNumber: index + 1,
                        dueDate: installment.dueDate,
                        paymentConditionId: installment.paymentConditionId,
                        additionalFee: installment.additionalFee,
                        amount: installment.value,
                      }),
                    )
                  : null,
            }
          : null,
        financial: {
          status:
            quotation.receivable.length > 0 ? 'BILLED' : 'BILLING_PENDING',
          ...financialTableData,
        },
      };

      return {
        id: order.id,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        canceledAt: order.canceledAt,
        deliveredAt: order.deliveredAt,
        status: order.status,
        quotation: formattedQuotation,
        nfes: order.nfes || [],
      };
    } catch (error) {
      console.error(error);
      throw new Error('Erro ao buscar a ordem de serviço.');
    }
  }

  private async verifySellerPermission(sellerId) {
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

    if (!seller) {
      throw new NotFoundException('Seller not found');
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

    try {
      // Verifica se o motivo do cancelamento existe (se fornecido)
      if (dto.reasonId) {
        const reason = await this.prisma.reasons.findFirst({
          where: { id: dto.reasonId },
        });

        if (!reason) {
          throw new NotFoundException('Motivo de cancelamento não encontrado.');
        }
      }

      // Cancelar parcelas pendentes dos receivables e payables
      const quotationId = order.quotation.id;

      // Conta total de parcelas de receivables antes do cancelamento
      const totalReceivableInstallments =
        await this.prisma.receivableInstallment.count({
          where: {
            receivable: {
              quotationId: quotationId,
            },
          },
        });

      // Conta total de parcelas de payables antes do cancelamento
      const totalPayableInstallments =
        await this.prisma.payableInstallment.count({
          where: {
            payable: {
              quotationId: quotationId,
            },
          },
        });

      // Busca todos os receivables e payables relacionados à quotation
      const receivables = await this.prisma.receivable.findMany({
        where: { quotationId: quotationId },
        include: {
          installments: true,
        },
      });

      const payables = await this.prisma.payable.findMany({
        where: { quotationId: quotationId },
        include: {
          installments: true,
        },
      });

      // Cancela parcelas pendentes e atualiza status dos receivables
      let canceledReceivableInstallmentsCount = 0;
      for (const receivable of receivables) {
        const pendingInstallments = receivable.installments.filter(
          (inst) => inst.status === 'PENDING' || inst.status === 'OVERDUE',
        );

        // Cancela as parcelas pendentes
        if (pendingInstallments.length > 0) {
          await this.prisma.receivableInstallment.updateMany({
            where: {
              receivableId: receivable.id,
              status: {
                in: ['PENDING', 'OVERDUE'],
              },
            },
            data: {
              status: 'CANCELED',
            },
          });

          canceledReceivableInstallmentsCount += pendingInstallments.length;
        }

        // Marca o receivable como cancelado (independente de ter parcelas pagas)
        await this.prisma.receivable.update({
          where: { id: receivable.id },
          data: {
            status: 'CANCELED',
            cancelReason:
              'Cancelado automaticamente pelo cancelamento da ordem de serviço',
          },
        });
      }

      // Cancela parcelas pendentes e atualiza status dos payables
      let canceledPayableInstallmentsCount = 0;
      for (const payable of payables) {
        const pendingInstallments = payable.installments.filter(
          (inst) => inst.status === 'PENDING' || inst.status === 'OVERDUE',
        );

        // Cancela as parcelas pendentes
        if (pendingInstallments.length > 0) {
          await this.prisma.payableInstallment.updateMany({
            where: {
              payableId: payable.id,
              status: {
                in: ['PENDING', 'OVERDUE'],
              },
            },
            data: {
              status: 'CANCELED',
            },
          });

          canceledPayableInstallmentsCount += pendingInstallments.length;
        }

        // Marca o payable como cancelado (independente de ter parcelas pagas)
        await this.prisma.payable.update({
          where: { id: payable.id },
          data: {
            status: 'CANCELED',
            cancelReason:
              'Cancelado automaticamente pelo cancelamento da ordem de serviço',
          },
        });
      }

      const canceledReceivableInstallments = {
        count: canceledReceivableInstallmentsCount,
      };
      const canceledPayableInstallments = {
        count: canceledPayableInstallmentsCount,
      };

      // Atualiza o status do deliverySchedule para CANCELED (se existir)
      try {
        await this.prisma.deliverySchedule.update({
          where: {
            id: quotationId,
          },
          data: {
            status: 'CANCELED',
          },
        });
      } catch (error) {
        // Ignora se não existir deliverySchedule
        console.log('DeliverySchedule não encontrado ou já cancelado');
      }

      // Atualiza o pedido para status cancelado
      const updatedOrder = await this.prisma.order.update({
        where: { id: orderId },
        data: {
          canceledAt: new Date(),
          status: OrderStatus.CANCELED,
          reasonId: dto.reasonId || null,
        },
      });

      // Calcula parcelas que não foram canceladas (já pagas)
      const keptReceivableInstallments =
        totalReceivableInstallments - canceledReceivableInstallments.count;
      const keptPayableInstallments =
        totalPayableInstallments - canceledPayableInstallments.count;

      return {
        order: updatedOrder,
        canceledInstallments: {
          receivables: canceledReceivableInstallments.count,
          payables: canceledPayableInstallments.count,
          total:
            canceledReceivableInstallments.count +
            canceledPayableInstallments.count,
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
            canceledReceivableInstallments.count +
            canceledPayableInstallments.count,
          keptInstallments:
            keptReceivableInstallments + keptPayableInstallments,
        },
      };
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError) {
        // Tratamento específico para erros do Prisma
        throw new BadRequestException(
          'Erro na base de dados ao cancelar a ordem.',
        );
      }
      console.error(error); // Log para depuração
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
