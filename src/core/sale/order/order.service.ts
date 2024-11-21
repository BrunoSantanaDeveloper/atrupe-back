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
        where = { ...where, companyId: dto.companyId };
      }

      if (dto.search) {
        where = { ...where, quotation: { name: { contains: dto.search } } };
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

      if (dto.clientId) {
        where = { ...where, quotation: { clientId: dto.clientId } };
      }

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
            },
          },
        },
        take: Number(dto.limit),
        skip: (Number(dto.page) - 1) * Number(dto.limit),
      });

      const grouped: Record<string, OrderGroup> = orders.reduce(
        (acc, order) => {
          const date = order.createdAt.toISOString().split('T')[0];
          if (!acc[date]) {
            acc[date] = {
              date: date,
              orders: [],
            };
          }
          acc[date].orders.push(order);
          return acc;
        },
        {},
      );

      return Object.values(grouped).sort((a, b) =>
        b.date.localeCompare(a.date),
      );
    } catch (error) {
      console.error(error);
    }
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
                name: true,
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
    return this.prisma.order.delete({ where: { id } });
  }
}
