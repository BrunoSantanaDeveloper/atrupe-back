import { Injectable } from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { PrismaService } from 'nestjs-prisma';
import { FilterOrderDto } from './dto/filter.dto';
import { Order, OrderStatus } from '@prisma/client';

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

  async cancel(id: string) {
    return this.prisma.order.update({
      where: { id },
      data: {
        status: OrderStatus.CANCELED,
        canceledAt: new Date(),
      },
    });
  }

  async duplicate(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
    });

    if (!order) {
      throw new Error('Order not found');
    }

    return this.prisma.order.create({
      data: {
        quotationId: order.quotationId,
      },
    });
  }

  async findAll(dto: FilterOrderDto) {
    try {
      let where: any = {};

      if (dto.companyId) {
        where = {
          ...where,
          quotation: {
            ...where.quotation,
            companyId: dto.companyId,
          },
        };
      }

      if (dto.search) {
        where = {
          ...where,
          quotation: {
            ...where.quotation,
            name: { contains: dto.search },
          },
        };
      }

      if (dto.status) {
        where = { ...where, status: dto.status };
      }

      if (dto.sellerId) {
        where = {
          ...where,
          quotation: {
            ...where.quotation,
            sellerId: dto.sellerId,
          },
        };
      }

      if (dto.serieId) {
        where = {
          ...where,
          quotation: {
            ...where.quotation,
            seriesId: dto.serieId,
          },
        };
      }

      if (dto.clientId) {
        where = {
          ...where,
          quotation: {
            ...where.quotation,
            clientId: dto.clientId,
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
                    select: {
                      name: true,
                    },
                  },
                },
              },
              series: {
                select: {
                  code: true,
                },
              },
              client: {
                select: {
                  name: true,
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
      });

      const grouped: Record<string, { date: string; orders: any[] }> =
        orders.reduce((acc, order) => {
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
              clientName: quotation.client?.name || null,
              serieQuotation: `${quotation.id}-${quotation.series?.code || 'N/A'}`,
              description: quotation.description,
              totalValue: quotation.totalValue,
              sellerName: quotation.seller?.user?.name || null,
            },
          });

          return acc;
        }, {});

      const result = Object.values(grouped).map((group) => ({
        date: group.date,
        orders: group.orders,
      }));

      const lastPage = Math.ceil(totalOrders / Number(dto.limit));

      return {
        total: totalOrders,
        lastPage,
        data: result,
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
          in: ['PENDING', 'IN_PRODUCTION', 'CANCELED', 'COMPLETED', 'FINISHED'],
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
      if (cur.status === 'COMPLETED') {
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

  findOne(id: string) {
    return this.prisma.order.findUnique({
      where: { id },
      include: {
        quotation: {
          include: {
            series: {
              select: {
                id: true,
                title: true,
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
            client: true,
            quotationProduct: {
              include: {
                product: true,
                items: {
                  include: {
                    productItem: true,
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  remove(id: string) {
    return this.prisma.order.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
