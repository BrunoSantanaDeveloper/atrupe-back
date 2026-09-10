import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  HttpException,
} from '@nestjs/common';
import { CancelOrderDto, CreateOrderDto } from './dto/create-order.dto';
import { PrismaService } from 'nestjs-prisma';
import { FilterOrderDto } from './dto/filter.dto';
import {
  NfceStatus,
  NfseStatus,
  Order,
  OrderStatus,
  Prisma,
} from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { ORDER_FIND_ONE_INCLUDE } from './order.includes';
import { transformOrderToResponse } from './order.transformers';
import { UpdateOrderInfoDto } from './dto/update-order.dto';
import { reassignQuotationSeries } from '../quotation/quotation-series.util';

const EXPORT_LIMIT = '10000';
const ACTIVE_NFCE_STATUSES: NfceStatus[] = [
  NfceStatus.AUTHORIZED,
  NfceStatus.CONTINGENCY,
  NfceStatus.PROCESSING,
  NfceStatus.UNKNOWN,
  NfceStatus.PENDING,
];
const ISSUED_NFCE_STATUSES: NfceStatus[] = [
  NfceStatus.AUTHORIZED,
  NfceStatus.CONTINGENCY,
];
const DRAFT_NFCE_STATUSES: NfceStatus[] = [
  NfceStatus.PROCESSING,
  NfceStatus.UNKNOWN,
  NfceStatus.PENDING,
];
const ACTIVE_NFSE_STATUSES: NfseStatus[] = [
  NfseStatus.AUTHORIZED,
  NfseStatus.PROCESSING,
  NfseStatus.PENDING,
  NfseStatus.DRAFT,
];
const ISSUED_NFSE_STATUSES: NfseStatus[] = [NfseStatus.AUTHORIZED];
const DRAFT_NFSE_STATUSES: NfseStatus[] = [
  NfseStatus.PROCESSING,
  NfseStatus.PENDING,
  NfseStatus.DRAFT,
];

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
      const fiscalEnvironments = dto.companyId
        ? await this.getActiveFiscalEnvironments(dto.companyId)
        : { nfe: 2, nfse: 2, nfce: 2 };

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
      // Quando há busca ativa, não aplica o filtro de fase para que o resultado apareça independente da fase
      if (!dto.search) {
        if (dto.nfeStatus === 'EMITIDA') {
          where.OR = [
            {
              nfes: {
                some: {
                  status: 'AUTHORIZED',
                  ambiente: fiscalEnvironments.nfe,
                },
              },
            },
            {
              nfeOrders: {
                some: {
                  nfe: {
                    status: 'AUTHORIZED',
                    ambiente: fiscalEnvironments.nfe,
                  },
                },
              },
            },
            {
              nfces: {
                some: {
                  status: { in: ISSUED_NFCE_STATUSES },
                  ambiente: fiscalEnvironments.nfce,
                },
              },
            },
            {
              nfses: {
                some: {
                  status: { in: ISSUED_NFSE_STATUSES },
                  ambiente: fiscalEnvironments.nfse,
                },
              },
            },
          ];
        } else if (dto.nfeStatus === 'EM_DIGITACAO') {
          where.OR = [
            {
              nfes: {
                some: { status: 'DRAFT', ambiente: fiscalEnvironments.nfe },
              },
            },
            {
              nfeOrders: {
                some: {
                  nfe: { status: 'DRAFT', ambiente: fiscalEnvironments.nfe },
                },
              },
            },
            {
              nfces: {
                some: {
                  status: { in: DRAFT_NFCE_STATUSES },
                  ambiente: fiscalEnvironments.nfce,
                },
              },
            },
            {
              nfses: {
                some: {
                  status: { in: DRAFT_NFSE_STATUSES },
                  ambiente: fiscalEnvironments.nfse,
                },
              },
            },
          ];
          where.AND = [
            {
              nfes: {
                none: {
                  status: 'AUTHORIZED',
                  ambiente: fiscalEnvironments.nfe,
                },
              },
            },
            {
              nfeOrders: {
                none: {
                  nfe: {
                    status: 'AUTHORIZED',
                    ambiente: fiscalEnvironments.nfe,
                  },
                },
              },
            },
            {
              nfces: {
                none: {
                  status: { in: ISSUED_NFCE_STATUSES },
                  ambiente: fiscalEnvironments.nfce,
                },
              },
            },
            {
              nfses: {
                none: {
                  status: { in: ISSUED_NFSE_STATUSES },
                  ambiente: fiscalEnvironments.nfse,
                },
              },
            },
          ];
        } else if (dto.nfeStatus === 'TODAS') {
          // Sem filtro de NFE, mas se for tela de NFE, esconder canceladas sem NF
          where.OR = [
            { status: { not: OrderStatus.CANCELED } },
            { nfes: { some: {} } },
            { nfeOrders: { some: {} } },
            { nfces: { some: {} } },
            { nfses: { some: {} } },
          ];
        } else if (dto.nfeStatus) {
          // Padrão (NAO_EMITIDA): ordens sem nenhuma NF AUTHORIZED ou DRAFT e que NÃO estão canceladas
          // Isso permite que ordens com NF rejeitadas ou com erro ainda apareçam para serem reemitidas
          where.AND = [
            {
              nfes: {
                none: {
                  status: { in: ['AUTHORIZED', 'DRAFT'] },
                  ambiente: fiscalEnvironments.nfe,
                },
              },
            },
            {
              nfeOrders: {
                none: {
                  nfe: {
                    status: { in: ['AUTHORIZED', 'DRAFT'] },
                    ambiente: fiscalEnvironments.nfe,
                  },
                },
              },
            },
            {
              nfces: {
                none: {
                  status: { in: ACTIVE_NFCE_STATUSES },
                  ambiente: fiscalEnvironments.nfce,
                },
              },
            },
            {
              nfses: {
                none: {
                  status: { in: ACTIVE_NFSE_STATUSES },
                  ambiente: fiscalEnvironments.nfse,
                },
              },
            },
          ];
          where.status = { not: OrderStatus.CANCELED };
        }
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

        // Se o usuário buscar por algo como "V1-34", extrai apenas o número "34"
        const parts = dto.search.split('-');
        const numStr = parts.length > 1 ? parts[parts.length - 1] : dto.search;
        const searchAsNumber = Number(numStr.trim());

        if (!isNaN(searchAsNumber) && numStr.trim() !== '') {
          quotationFilters.OR.push({ quotationNumber: searchAsNumber });
        }
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
            where: {
              status: { in: ['AUTHORIZED', 'DRAFT'] },
            },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              numero: true,
              serie: true,
              status: true,
              danfeUrl: true,
              dataEmissao: true,
              chaveAcesso: true,
              xmlAutorizado: true,
              motivoRejeicao: true,
              ambiente: true,
            },
          },
          nfeOrders: {
            where: {
              nfe: {
                status: { in: ['AUTHORIZED', 'DRAFT'] },
              },
            },
            orderBy: { createdAt: 'desc' },
            include: {
              nfe: {
                select: {
                  id: true,
                  numero: true,
                  serie: true,
                  status: true,
                  danfeUrl: true,
                  dataEmissao: true,
                  chaveAcesso: true,
                  xmlAutorizado: true,
                  motivoRejeicao: true,
                  ambiente: true,
                },
              },
            },
          },
          nfces: {
            where: {
              status: { in: ACTIVE_NFCE_STATUSES },
            },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              numero: true,
              serie: true,
              status: true,
              danfeUrl: true,
              dataEmissao: true,
              chaveAcesso: true,
              qrCodeUrl: true,
              xmlAutorizado: true,
              motivoRejeicao: true,
              ambiente: true,
            },
          },
          nfses: {
            where: {
              status: { in: ACTIVE_NFSE_STATUSES },
            },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              numero: true,
              serie: true,
              rpsNumero: true,
              rpsSerie: true,
              status: true,
              codigoVerificacao: true,
              pdfUrl: true,
              dataEmissao: true,
              xmlRetorno: true,
              motivoRejeicao: true,
              ambiente: true,
            },
          },
        },
        take: Number(dto.limit),
        skip: (Number(dto.page) - 1) * Number(dto.limit),
        orderBy: { createdAt: 'desc' },
      });

      const ordersWithConsolidatedNfes = orders.map((order: any) => ({
        ...order,
        nfes: [
          ...(order.nfes || []),
          ...(order.nfeOrders || []).map((item) => item.nfe).filter(Boolean),
        ],
      }));

      const grouped = ordersWithConsolidatedNfes.reduce(
        (acc: any, order: any) => {
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
            nfces: order.nfces || [],
            nfses: order.nfses || [],
          });

          return acc;
        },
        {},
      );
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

  private async getActiveFiscalEnvironments(companyId: string) {
    const config = await this.prisma.invoicyConfig.findFirst({
      where: { companyId },
      orderBy: { isDefault: 'desc' },
      select: {
        activeEnvironment: true,
        activeEnvironmentNfe: true,
        activeEnvironmentNfse: true,
        activeEnvironmentNfce: true,
        environment: true,
        ambiente: true,
      },
    });

    const legacyEnvironment =
      config?.activeEnvironment ||
      config?.environment ||
      (config?.ambiente === 1 ? 'PRODUCAO' : 'HOMOLOGACAO');
    const toNumber = (environment?: string | null) =>
      environment === 'PRODUCAO' ? 1 : 2;

    return {
      nfe: toNumber(config?.activeEnvironmentNfe || legacyEnvironment),
      nfse: toNumber(config?.activeEnvironmentNfse || legacyEnvironment),
      nfce: toNumber(config?.activeEnvironmentNfce || legacyEnvironment),
    };
  }

  async findAllForExport(dto: FilterOrderDto) {
    const result = await this.findAll({
      ...dto,
      page: '1',
      limit: EXPORT_LIMIT,
    });

    return {
      total: result.total,
      exportLimit: Number(EXPORT_LIMIT),
      data: result.data.flatMap((group: any) =>
        group.orders.map((order) => ({
          ...order,
          groupDate: group.date,
        })),
      ),
    };
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
      if (error instanceof HttpException) {
        throw error;
      }

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
          const user = prisma.user
            ? await prisma.user.findUnique({
                where: { id: sellerId },
                select: { name: true },
              })
            : null;
          if (prisma.orderHistory) {
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
          }
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
    const deliveryDisplayValue = deliveryInfo?.value || deliveryInfo?.cost;
    if (deliveryInfo && deliveryDisplayValue > 0) {
      deliveryInstallments.push({
        id: installmentId++,
        company: deliveryInfo.supplier?.name || 'Transportadora',
        method: 'Frete',
        installmentNumber: 1,
        installmentTotal: 1,
        status: 'PENDING',
        dueAmount: deliveryDisplayValue,
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

  async updateOrderInfo(
    orderId: string,
    dto: UpdateOrderInfoDto,
    userId: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        quotation: {
          select: {
            id: true,
            clientId: true,
            sellerId: true,
            contactId: true,
            companyId: true,
            subCompanyId: true,
            seriesId: true,
            quotationNumber: true,
            series: { select: { code: true } },
            client: { select: { name: true } },
            seller: { select: { name: true } },
            contact: { select: { name: true } },
            deliveryInfo: {
              select: { id: true, clientAddressId: true },
            },
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Ordem de serviço não encontrada.');
    }

    if (order.status === 'CANCELED') {
      throw new BadRequestException(
        'Não é possível editar uma ordem de serviço cancelada.',
      );
    }

    const { quotation } = order;

    // Snapshot "before" for history
    const before: Record<string, string | null> = {};
    const after: Record<string, string | null> = {};

    if (dto.clientId !== undefined && dto.clientId !== quotation.clientId) {
      const newClient = dto.clientId
        ? await this.prisma.client.findUnique({
            where: { id: dto.clientId },
            select: { name: true },
          })
        : null;
      before.clientId = quotation.clientId;
      before.clientName = quotation.client?.name ?? null;
      after.clientId = dto.clientId;
      after.clientName = newClient?.name ?? null;
    }
    if (dto.sellerId !== undefined && dto.sellerId !== quotation.sellerId) {
      const newSeller = dto.sellerId
        ? await this.prisma.employee.findUnique({
            where: { id: dto.sellerId },
            select: { name: true },
          })
        : null;
      before.sellerId = quotation.sellerId;
      before.sellerName = quotation.seller?.name ?? null;
      after.sellerId = dto.sellerId;
      after.sellerName = newSeller?.name ?? null;
    }
    if (dto.contactId !== undefined && dto.contactId !== quotation.contactId) {
      const newContact = dto.contactId
        ? await this.prisma.contact.findUnique({
            where: { id: dto.contactId },
            select: { name: true },
          })
        : null;
      before.contactId = quotation.contactId;
      before.contactName = quotation.contact?.name ?? null;
      after.contactId = dto.contactId;
      after.contactName = newContact?.name ?? null;
    }
    const currentAddressId = quotation.deliveryInfo?.clientAddressId ?? null;
    const newAddressId = dto.deliveryClientAddressId || null;
    if (
      dto.deliveryClientAddressId !== undefined &&
      newAddressId !== currentAddressId
    ) {
      const formatAddr = (
        a: {
          street?: string;
          number?: string;
          neighborhood?: string;
          city?: string;
          state?: string;
        } | null,
      ) => {
        if (!a) return null;
        return [
          a.street,
          a.number,
          a.neighborhood,
          a.city && a.state ? `${a.city}/${a.state}` : (a.city ?? a.state),
        ]
          .filter(Boolean)
          .join(', ');
      };

      const currentAddr = currentAddressId
        ? await this.prisma.address.findUnique({
            where: { id: currentAddressId },
            select: {
              street: true,
              number: true,
              neighborhood: true,
              city: true,
              state: true,
            },
          })
        : null;

      let afterAddrText: string | null = null;
      if (!dto.deliveryClientAddressId) {
        afterAddrText = null;
      } else if (dto.deliveryClientAddressId === 'custom') {
        afterAddrText = dto.deliveryCustomAddress
          ? formatAddr(dto.deliveryCustomAddress)
          : 'Endereço personalizado';
      } else {
        const newAddr = await this.prisma.address.findUnique({
          where: { id: dto.deliveryClientAddressId },
          select: {
            street: true,
            number: true,
            neighborhood: true,
            city: true,
            state: true,
          },
        });
        afterAddrText = formatAddr(newAddr);
      }

      before.deliveryAddress = formatAddr(currentAddr);
      after.deliveryAddress = afterAddrText;
    }

    const isSeriesChange =
      !!dto.seriesId && dto.seriesId !== quotation.seriesId;
    if (isSeriesChange) {
      before.serie = `${quotation.quotationNumber ?? ''}-${quotation.series?.code ?? ''}`;
      // O número novo só existe depois de reservado, dentro da transação.
      after.serie = null;
    }

    const changedFields = Object.keys(after);
    if (changedFields.length === 0) {
      return this.findOne(orderId);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });

    await this.prisma.$transaction(async (tx) => {
      // Update quotation fields
      const quotationUpdate: Record<string, string | number | null> = {};
      if (dto.clientId !== undefined) quotationUpdate.clientId = dto.clientId;
      if (dto.sellerId !== undefined) quotationUpdate.sellerId = dto.sellerId;
      if (dto.contactId !== undefined)
        quotationUpdate.contactId = dto.contactId || null;

      if (isSeriesChange) {
        const reassigned = await reassignQuotationSeries(
          tx,
          quotation,
          dto.seriesId as string,
        );
        quotationUpdate.seriesId = reassigned.seriesId;
        quotationUpdate.quotationNumber = reassigned.quotationNumber;
        after.serie = `${reassigned.quotationNumber}-${reassigned.code}`;
      }

      if (Object.keys(quotationUpdate).length > 0) {
        await tx.quotation.update({
          where: { id: quotation.id },
          data: quotationUpdate,
        });
      }

      // Update delivery address
      if (dto.deliveryClientAddressId !== undefined && quotation.deliveryInfo) {
        let addressId: string | null = dto.deliveryClientAddressId;

        if (
          dto.deliveryClientAddressId === 'custom' &&
          dto.deliveryCustomAddress
        ) {
          const existingCustom = quotation.deliveryInfo.clientAddressId
            ? await tx.address.findFirst({
                where: {
                  id: quotation.deliveryInfo.clientAddressId,
                  type: 'CustomForDelivery',
                },
              })
            : null;

          if (existingCustom) {
            await tx.address.update({
              where: { id: existingCustom.id },
              data: dto.deliveryCustomAddress,
            });
            addressId = existingCustom.id;
          } else {
            const newAddr = await tx.address.create({
              data: { ...dto.deliveryCustomAddress, type: 'CustomForDelivery' },
            });
            addressId = newAddr.id;
          }
        } else if (
          dto.deliveryClientAddressId !== 'custom' &&
          quotation.deliveryInfo.clientAddressId
        ) {
          // If switching away from a custom address, clean it up
          const prevCustom = await tx.address.findFirst({
            where: {
              id: quotation.deliveryInfo.clientAddressId,
              type: 'CustomForDelivery',
            },
          });
          if (prevCustom) {
            try {
              await tx.address.delete({ where: { id: prevCustom.id } });
            } catch {
              // Ignore if address is referenced elsewhere
            }
          }
        }

        if (dto.deliveryClientAddressId === '') addressId = null;

        await tx.deliveryInfo.update({
          where: { id: quotation.deliveryInfo.id },
          data: { clientAddressId: addressId },
        });
      }

      // Create OrderHistory entry
      await tx.orderHistory.create({
        data: {
          orderId,
          action: 'EDITED',
          description: `Informações editadas por ${user?.name ?? 'Usuário'} — ${[
            after.clientId ? 'cliente' : null,
            after.sellerId ? 'vendedor' : null,
            after.contactId ? 'responsável' : null,
            after.deliveryAddress !== undefined ? 'endereço de entrega' : null,
            after.serie !== undefined ? 'série' : null,
          ]
            .filter(Boolean)
            .join(', ')}`,
          changes: { before, after },
          createdBy: userId,
          createdByName: user?.name ?? null,
        } as any,
      });
    });

    return this.findOne(orderId);
  }
}
