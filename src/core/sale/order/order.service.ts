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
    return this.prisma.order.create({
      data: {
        quotationId: createOrderDto.quotationId,
        status: OrderStatus.PENDING,
      },
    });
  }

  async findAll(dto: FilterOrderDto) {
    try {
      const where: Prisma.OrderWhereInput = {};

      // Filtros básicos
      if (dto.companyId) {
        where.quotation = {
          is: { companyId: dto.companyId },
        };
      }

      if (dto.status) {
        where.status = dto.status;
      }

      if (dto.sellerId) {
        where.quotation = {
          is: { sellerId: dto.sellerId },
        };
      }

      if (dto.serieId) {
        where.quotation = {
          is: { seriesId: dto.serieId },
        };
      }

      if (dto.clientId) {
        where.quotation = {
          is: { clientId: dto.clientId },
        };
      }

      // Busca por texto
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
        },
      });
      if (!order) {
        throw new Error('Order not found');
      }

      const quotation = order.quotation;

      const financialTableData = buildFinancialTableData(
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
          unitValue: qp.items.reduce(
            (total, item) => total + (item.unitCost || 0),
            0,
          ),
          totalValue: qp.items.reduce(
            (total, item) => total + item.totalValue,
            0,
          ),
          finalValue: qp.finalValue,
          image: (() => {
            if (qp.imageUrl) {
              return { url: qp.imageUrl, original: false };
            } else {
              return { url: qp.product.imageUrl, original: true };
            }
          })(),
          product: {
            originalProductId: qp.productId,
            name: qp.product.name,
            quantity: qp.quantity,
            unitValue: qp.items.reduce(
              (total, item) => total + item.totalValue * item.originalQuantity,
              0,
            ),

            finalValue: qp.items.reduce(
              (total, item) => total + item.totalValue,
              0,
            ),
            compositions: qp.items.map((item) => ({
              id: item.id,
              originalCompositionId: item.productItemId,
              name: item.name,
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
    if (!dto.reasonId) {
      return await this.prisma.order.update({
        where: { id: orderId },
        data: {
          canceledAt: new Date(),
          status: OrderStatus.CANCELED,
        },
      });
    }
    try {
      // Verifica se o motivo do cancelamento existe
      const reason = await this.prisma.reasons.findFirst({
        where: { id: dto.reasonId },
      });

      if (!reason) {
        throw new NotFoundException('Motivo de cancelamento não encontrado.');
      }
      await this.prisma.deliverySchedule.update({
        where: {
          id: order.quotation.id,
        },
        data: {
          status: 'CANCELED',
        },
      });
      // Atualiza o pedido para status cancelado
      return await this.prisma.order.update({
        where: { id: orderId },
        data: {
          canceledAt: new Date(),
          status: OrderStatus.CANCELED,
          reasonId: dto.reasonId,
        },
      });
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
}

function buildFinancialTableData(client, quotationPayment, deliveryInfo) {
  const { quotationInstallment, commission, totalValue } = quotationPayment;
  const paymentInstallments = [];
  const commissionInstallments = [];
  const deliveryInstallments = [];

  // Processar Payment
  quotationInstallment.forEach((installment, index) => {
    const installmentStatus = installment.receivableInstallmentId
      ? installment.receivableInstallment?.status || 'PAID'
      : 'PENDING';

    paymentInstallments.push({
      id: index + 1,
      company: client.name,
      method: installment.paymentCondition?.name || 'Unknown',
      installmentNumber: index + 1,
      installmentTotal: quotationInstallment.length,
      status: installmentStatus,
      dueAmount: installment.value,
      dueDate: new Date(installment.dueDate).toLocaleDateString('pt-BR'),
      paidAmount: installment.receivableInstallment?.paidAmount || 0,
      paidDate: installment.receivableInstallment?.paidDate
        ? new Date(
            installment.receivableInstallment.paidDate,
          ).toLocaleDateString('pt-BR')
        : null,
    });
  });

  // Processar Commission
  if (commission) {
    const commissionValue =
      commission.commissionType === 'PERCENT'
        ? (totalValue * commission.commissionValue) / 100
        : commission.commissionValue;

    if (commission.transferMethod === 'SINGLE') {
      const commissionStatus = commission.payableInstallmentId
        ? commission.payableInstallment?.status || 'PAID'
        : 'PENDING';

      commissionInstallments.push({
        id: paymentInstallments.length + 1,
        company: commission.supplier?.name || 'Vendedor',
        method: 'Comissão',
        installmentNumber: 1,
        installmentTotal: 1,
        status: commissionStatus,
        dueAmount: commissionValue,
        dueDate: new Date().toLocaleDateString('pt-BR'), // Ajustar conforme necessário
        paidAmount: commission.receivableInstallment?.paidAmount || 0,
        paidDate: commission.receivableInstallment?.paidDate
          ? new Date(
              commission.receivableInstallment.paidDate,
            ).toLocaleDateString('pt-BR')
          : null,
      });
    } else if (commission.transferMethod === 'PAYMENT_BASED') {
      const installmentValue = commissionValue / quotationInstallment.length;
      quotationInstallment.forEach((installment, index) => {
        const commissionStatus = installment.receivableInstallmentId
          ? installment.receivableInstallment?.status || 'PAID'
          : 'PENDING';

        commissionInstallments.push({
          id: paymentInstallments.length + index + 1,
          company: commission.supplier?.name || 'Vendedor',
          method: 'Comissão',
          installmentNumber: index + 1,
          installmentTotal: quotationInstallment.length,
          status: commissionStatus,
          dueAmount: installmentValue,
          dueDate: new Date(installment.dueDate).toLocaleDateString('pt-BR'),
          paidAmount: installment.receivableInstallment?.paidAmount || 0,
          paidDate: installment.receivableInstallment?.paidDate
            ? new Date(
                installment.receivableInstallment.paidDate,
              ).toLocaleDateString('pt-BR')
            : null,
        });
      });
    }
  }

  deliveryInstallments.push({
    id: paymentInstallments.length + commissionInstallments.length + 1,
    company: deliveryInfo.supplier?.name || 'Transportadora',
    method: 'Frete',
    status: 'PENDING',
    dueAmount: deliveryInfo.cost,
    dueDate: deliveryInfo.estimatedDate,
    paidAmount: deliveryInfo.value,
    paidDate: null,
  });

  return {
    payment: paymentInstallments,
    commission: commissionInstallments,
    delivery: deliveryInstallments,
  };
}
