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
import { consumeSale } from '../../stock/stock-consumption';
import { compositionMeasure } from '../quotation/quotation-items.service';

/** "4 un · 1 × 0,5 m" (design §7), pelas linhas de medida do item. */
const mm = (value: number) =>
  (value / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const measureOf = (
  quantity: number,
  lines: { quantity: number; width: number | null; height: number | null }[],
) => {
  // As peças contam como na composição do item (5.1, 29/10/2026): as da
  // primeira linha; vezes a quantidade do produto só no de vários itens
  const {
    quantity: total,
    width,
    height,
  } = compositionMeasure(quantity, lines);
  const size =
    width && height
      ? ` · ${mm(width)} × ${mm(height)} m`
      : width
        ? ` · ${mm(width)} m`
        : '';
  return `${total} un${size}`;
};

/**
 * Os itens da ordem com as etapas de cada um: as tarefas, quando a venda segue
 * o gerenciador; senão, as etapas por item da agenda (LITE, §4.7).
 */
const itemsOf = (
  products: {
    id: string;
    description: string | null;
    quantity: number;
    items: { quantity: number; width: number | null; height: number | null }[];
  }[],
  tasks: {
    id: string;
    quotationProductId: string | null;
    stageName: string;
    status: string;
    sectorId: string | null;
    sectorName: string;
    notes?: string | null;
  }[],
  editable = false,
) =>
  products.map((product) => ({
    id: product.id,
    name: product.description ?? '',
    quantity: product.quantity,
    measure: measureOf(product.quantity, product.items),
    stages: tasks
      .filter((task) => task.quotationProductId === product.id)
      .map((task) => ({
        id: task.id,
        name: task.stageName,
        sectorId: task.sectorId,
        sector: task.sectorName,
        status: task.status,
        notes: task.notes ?? null,
        // A etapa do item que se troca na agenda (LITE): a rota é
        // sale/production-stage/item/:id
        editable,
      })),
  }));

export interface DeliveryScheduleGroup {
  date: string;
  deliveries: DeliverySchedule[];
}
@Injectable()
export class DeliveryScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  create(
    createDeliveryScheduleDto: CreateDeliveryScheduleDto,
    companyId: string,
  ) {
    // A agenda nasce com a empresa da sessão (antes ficava sem empresa)
    return this.prisma.deliverySchedule.create({
      data: { ...createDeliveryScheduleDto, companyId },
    });
  }

  async findAll(dto: DeliveryScheduleFitlerDto) {
    try {
      let where: Prisma.DeliveryScheduleWhereInput = {};
      const quotationFilters: Prisma.QuotationWhereInput = {};

      if (dto.companyId) {
        where = { ...where, companyId: dto.companyId };
      }

      // Busca por texto - acumulando em quotationFilters
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

      if (dto.status) {
        where = { ...where, status: dto.status };
      }

      // Filtro por setor (GP-46): a entrega com uma etapa daquele setor que
      // ainda não terminou nem foi cancelada
      if (dto.stageId) {
        where = {
          ...where,
          productionStages: {
            some: {
              stageId: dto.stageId,
              status: { notIn: ['DONE', 'CANCELED'] },
            },
          },
        };
      }

      if (dto.sellerId) {
        quotationFilters.sellerId = dto.sellerId;
      }

      if (dto.serieId) {
        quotationFilters.seriesId = dto.serieId;
      }

      // Aplicar filtros de quotation se houver algum
      if (Object.keys(quotationFilters).length > 0) {
        where.quotation = { is: quotationFilters };
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
                    // Com projeto no gerenciador (ELITE), as etapas espelham
                    // as tarefas e não se editam aqui (D20). As tarefas dão
                    // as etapas de cada item (agenda em dois níveis, §4.7)
                    productionProject: {
                      select: {
                        id: true,
                        tasks: {
                          select: {
                            id: true,
                            quotationProductId: true,
                            stageName: true,
                            status: true,
                            sectorId: true,
                            sectorName: true,
                          },
                          orderBy: { position: 'asc' },
                        },
                      },
                    },
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
            // As etapas de cada item (LITE, §4.7): o segundo nível da agenda
            // quando a venda não segue o gerenciador
            itemStages: {
              select: {
                id: true,
                quotationProductId: true,
                status: true,
                notes: true,
                order: true,
                stage: { select: { id: true, name: true } },
              },
              orderBy: { order: 'asc' },
            },
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
                    color: true,
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
          if (delivery.order?.quotation?.receivable?.[0]) {
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
            managedByProduction: !!delivery.order?.quotation?.productionProject,

            financial: {
              billed: delivery.order?.quotation
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
            // O segundo nível da agenda (área 9 §4.7, 29/10/2026): os itens
            // da ordem, com a medida e, com projeto no gerenciador, as etapas
            // de cada um (as tarefas). Sem projeto, as etapas por item ainda
            // não existem no dado: a lista vem vazia
            items: itemsOf(
              delivery.order?.quotation?.quotationProduct ?? [],
              delivery.order?.quotation?.productionProject
                ? delivery.order.quotation.productionProject.tasks
                : (delivery.itemStages ?? []).map((stage) => ({
                    id: stage.id,
                    quotationProductId: stage.quotationProductId,
                    stageName: stage.stage.name,
                    status: stage.status,
                    sectorId: stage.stage.id,
                    sectorName: stage.stage.name,
                    notes: stage.notes,
                  })),
              // Sem gerenciador, a etapa do item se troca na agenda
              !delivery.order?.quotation?.productionProject,
            ),
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
            paymentCondition: {
              select: { id: true, name: true },
            },
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

      const finished = await this.prisma.$transaction(async (prisma) => {
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
      // A baixa por consumo da venda (ES-7), se o projeto não a fez antes:
      // fora da transação, uma falha não desfaz a entrega
      await consumeSale(
        this.prisma,
        deliverySchedule.quotation.id,
        'Agenda de entrega',
      ).catch(() => undefined);
      return finished;
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
