import { Injectable } from '@nestjs/common';

import { CreateDeliveryScheduleDto } from './dto/create-delivery-schedule.dto';
import { UpdateDeliveryScheduleDto } from './dto/update-delivery-schedule.dto';
import { PrismaService } from 'src/config/prisma/prisma.service';
import {
  DeliverySchedule,
  DeliveryScheduleStatus,
  Prisma,
} from '@prisma/client';
import { DeliveryScheduleFitlerDto } from './dto/filter.dto';
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

    const grouped: Record<string, DeliveryScheduleGroup> = deliveries.reduce(
      (acc, delivery) => {
        const date = delivery.createdAt.toISOString().split('T')[0];
        if (!acc[date]) {
          acc[date] = {
            date: date,
            deliveries: [],
          };
        }
        acc[date].deliveries.push({
          id: delivery.id,
          deliveryInfoId: delivery.deliveryInfo.id,
          isActive: delivery.isActive,
          status: delivery.status,
          completed: delivery.completed,
          notes: delivery.notes,
          scheduledDate: delivery.scheduledDate,
          addScheduleTime: delivery.addScheduleTime,
          pendingDescription: delivery.pendingDescription,
          // financial: {
          //   billed: boolean
          //   invoiceStatus: string
          // }
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
                            quotation: delivery.order.quotation.quotationNumber,
                          }
                        : null,
                      seller: delivery.order.quotation.seller
                        ? {
                            id: delivery.order.quotation.seller.id,
                            name: delivery.order.quotation.seller.user.name,
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
                            phoneNumber: delivery.order.quotation.client.phone,
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
      },
      {},
    );

    return {
      total,
      lastPage: Math.ceil(total / Number(dto.limit)),
      data: Object.values(grouped).sort((a, b) => b.date.localeCompare(a.date)),
    };
  }

  async findAllQuantity(companyId: string) {
    const allStatuses: DeliveryScheduleStatus[] = [
      'IN_PRODUCTION',
      'DELIVERING',
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
}
