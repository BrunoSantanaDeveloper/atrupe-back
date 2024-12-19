import {
  BadRequestException,
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
            },
          },
        },
      });

      if (!order) {
        throw new Error('Order not found');
      }

      const quotation = order.quotation;

      const formattedQuotation = {
        id: quotation.id,
        description: quotation.description,
        createdAt: quotation.createdAt,
        approvedAt: quotation.approvedAt,
        finishedAt: quotation.finishedAt,
        status: quotation.status,
        dueDate: quotation.dueDate,
        totalValue: quotation.totalValue,
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
              status: quotation.DeliverySchedule.status,
              type: quotation.deliveryInfo.deliveryType,
              timeFrame: quotation.deliveryInfo.daysAfterApproval,
              estimateDate: quotation.deliveryInfo.estimatedDate,
              cost: quotation.deliveryInfo.cost,
              value: quotation.deliveryInfo.value,
              notes: quotation.deliveryInfo.notes,
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
          notes: qp.notes,
          discountType: qp.discountType,
          discount: qp.discount,
          unitValue: qp.items.reduce(
            (total, item) => total + item.totalValue,
            0,
          ),
          totalValue: (() => {
            const unitValue = qp.items.reduce(
              (total, item) => total + item.totalValue,
              0,
            );

            return qp.quantity * unitValue;
          })(),
          finalValue: qp.finalValue,
          image: {
            url: qp.imageUrl,
            original: true, // Marcar como original ou não
          },
          product: {
            originalProductId: qp.productId,
            name: qp.product.name,
            quantity: qp.quantity,
            unitValue: qp.items.reduce(
              (total, item) => total + item.totalValue,
              0,
            ),

            finalValue:
              qp.quantity *
              qp.items.reduce((total, item) => total + item.totalValue, 0),
            compositions: qp.items.map((item) => ({
              id: item.id,
              originalCompositionId: item.productItemId,
              name: item.name,
              unitOfMeasure: item.unitOfMeasure,
              quantity: item.quantity,
              unitValue: item.salePrice,
              totalValue: item.totalValue,
            })),
          },
        })),
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

  async cancelOrder(orderId: string, dto: CancelOrderDto) {
    try {
      // Verifica se o motivo do cancelamento existe
      const reason = await this.prisma.reasons.findFirst({
        where: { id: dto.reasonId },
      });

      if (!reason) {
        throw new NotFoundException('Motivo de cancelamento não encontrado.');
      }

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
