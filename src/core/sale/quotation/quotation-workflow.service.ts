import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import {
  Prisma,
  QuotationStatus,
  Order,
  OrderStatus,
  Quotation,
} from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { add } from 'date-fns';
import { CancelOrderDto } from '../order/dto/create-order.dto';
import { QuotationFinancialService } from './quotation-financial.service';
import { DeliveryScheduleService } from '../delivery-schedule/delivery-schedule.service';
import {
  QuotationForFinancial,
  ProductionStageJson,
} from './quotation-financial.types';
import { calculateFinalValue } from './quotation.utils';

/**
 * QuotationWorkflowService
 * Responsável por mudanças de status e workflow do orçamento.
 */
@Injectable()
export class QuotationWorkflowService {
  private readonly logger = new Logger(QuotationWorkflowService.name);

  constructor(
    private prisma: PrismaService,
    private financialService: QuotationFinancialService,
    private deliveryScheduleService: DeliveryScheduleService,
  ) {}

  /**
   * Resolve o nome do usuário a partir do userId
   */
  private async resolveUserName(userId?: string): Promise<string | null> {
    if (!userId) return null;
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });
      return user?.name || null;
    } catch {
      return null;
    }
  }

  /**
   * Cria um registro de histórico do orçamento (side-effect, non-blocking)
   */
  private async createQuotationHistoryEntry(data: {
    quotationId: string;
    action: string;
    description: string;
    changes?: any;
    metadata?: any;
    createdBy?: string;
    createdByName?: string;
  }): Promise<void> {
    try {
      await this.prisma.quotationHistory.create({ data: data as any });
    } catch (error) {
      this.logger.error('Error creating quotation history:', error.stack);
    }
  }

  /**
   * Cria um registro de histórico da ordem de serviço (side-effect, non-blocking)
   */
  private async createOrderHistoryEntry(data: {
    orderId: string;
    action: string;
    description: string;
    changes?: any;
    metadata?: any;
    createdBy?: string;
    createdByName?: string;
  }): Promise<void> {
    try {
      await this.prisma.orderHistory.create({ data: data as any });
    } catch (error) {
      this.logger.error('Error creating order history:', error.stack);
    }
  }

  // =====================================================
  // APPROVE HELPER METHODS
  // =====================================================

  /**
   * Verifica se a empresa está em trial ou plano START
   */
  private async checkTrialStatus(companyId: string): Promise<boolean> {
    try {
      const companyData = await this.prisma.company.findUnique({
        where: { id: companyId },
        select: {
          Subscription: {
            where: { status: 'ACTIVE' },
            take: 1,
            select: {
              plan: { select: { planType: true } },
              nextDueDate: true,
            },
          },
        },
      });

      const subscription = companyData?.Subscription?.[0];
      if (!subscription) return false;

      if (subscription.plan?.planType === 'START') return true;

      if (
        subscription.plan?.planType === 'TRIAL' &&
        subscription.nextDueDate &&
        subscription.nextDueDate > new Date()
      ) {
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error('Error checking trial status:', error.stack);
      return false;
    }
  }

  /**
   * Valida se o cliente pode ter o orçamento aprovado
   */
  private async validateClientForApproval(
    client: { status: string } | null,
    userId: string | undefined,
    prisma: Prisma.TransactionClient,
  ): Promise<void> {
    if (!client || client.status === 'ACTIVE') return;

    let canApprove = false;

    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          employee: {
            select: {
              role: { select: { name: true } },
            },
          },
        },
      });

      if (user?.employee?.[0]?.role?.name === 'Admin') {
        canApprove = true;
      } else {
        const seller = await prisma.sellerProfile.findFirst({
          where: {
            employees: { some: { user: { id: userId } } },
          },
          select: { canApprovePreRegistration: true },
        });
        canApprove = seller?.canApprovePreRegistration ?? false;
      }
    }

    if (!canApprove) {
      throw new BadRequestException(
        'Não é possível aprovar orçamento para cliente com cadastro não regular. ' +
          'Por favor, complete o cadastro do cliente primeiro ou solicite aprovação a um administrador.',
      );
    }
  }

  /**
   * Cria ou retorna o pedido existente para o orçamento
   */
  private async createOrUpdateOrder(
    quotation: { id: string; series?: { productionStatus: string } | null },
    prisma: Prisma.TransactionClient,
  ): Promise<Order> {
    let order = await prisma.order.findUnique({
      where: { quotationId: quotation.id },
    });

    let orderStatus: OrderStatus = OrderStatus.IN_PRODUCTION;
    if (quotation.series?.productionStatus === 'PRODUCTION_COMPLETED') {
      orderStatus = OrderStatus.FINISHED;
    }

    if (!order) {
      order = await prisma.order.create({
        data: {
          quotationId: quotation.id,
          status: orderStatus,
        },
      });
    }

    return order;
  }

  /**
   * Cria o agendamento de entrega para o orçamento aprovado
   */
  private async createDeliveryScheduleForApproval(
    quotation: {
      id: string;
      companyId: string;
      approvedAt: Date;
      deliveryInfo: {
        id: string;
        daysAfterApproval: number | null;
      } | null;
    },
    order: Order,
    isTrial: boolean,
    prisma: Prisma.TransactionClient,
  ): Promise<void> {
    if (!quotation.deliveryInfo) return;

    const deliveryStatus = isTrial ? 'DELIVERING' : 'IN_PRODUCTION';

    const estimatedDate = quotation.deliveryInfo.daysAfterApproval
      ? add(quotation.approvedAt, {
          days: quotation.deliveryInfo.daysAfterApproval,
        })
      : quotation.approvedAt;

    await prisma.deliveryInfo.update({
      where: { id: quotation.deliveryInfo.id },
      data: { estimatedDate },
    });

    await prisma.deliverySchedule.create({
      data: {
        company: { connect: { id: quotation.companyId } },
        quotation: { connect: { id: quotation.id } },
        order: { connect: { id: order.id } },
        deliveryInfo: { connect: { id: quotation.deliveryInfo.id } },
        scheduledDate: estimatedDate,
        status: deliveryStatus,
      },
    });
  }

  /**
   * Gera receivables e payables se billing for ON_ORDER
   */
  private async handleApprovalFinancials(
    quotationId: string,
    quotation: QuotationForFinancial,
    prisma: Prisma.TransactionClient,
  ): Promise<void> {
    const [existingReceivables, existingPayables] = await Promise.all([
      prisma.receivable.findMany({
        where: { quotationId },
        select: { id: true },
      }),
      prisma.payable.findMany({
        where: { quotationId },
        select: { id: true },
      }),
    ]);

    if (
      existingReceivables.length === 0 &&
      existingPayables.length === 0 &&
      quotation.quotationPayment?.billing === 'ON_ORDER'
    ) {
      await this.financialService.generateReceivableFromQuotation(
        quotation,
        prisma,
      );
      await this.financialService.generatePayableFromQuotation(
        quotation,
        prisma,
      );
    }
  }

  // =====================================================
  // MAIN WORKFLOW METHODS
  // =====================================================

  /**
   * Aprova um orçamento e cria pedido
   */
  async approve(quotationId: string, userId?: string): Promise<Order> {
    const quotationBase = await this.prisma.quotation.findUnique({
      where: { id: quotationId },
      select: { companyId: true },
    });

    if (!quotationBase) {
      throw new NotFoundException(
        `Quotation with ID '${quotationId}' not found.`,
      );
    }

    const isTrial = await this.checkTrialStatus(quotationBase.companyId);

    // Core TX: status update + order creation (fast, critical)
    const { quotation, order } = await this.prisma.$transaction(
      async (prisma) => {
        const quotation = await prisma.quotation.update({
          where: { id: quotationId },
          data: {
            status: QuotationStatus.APPROVED,
            approvedAt: new Date(),
          },
          include: {
            deliveryInfo: {
              select: {
                id: true,
                estimatedDate: true,
                daysAfterApproval: true,
                cost: true,
                supplierId: true,
                deliveryType: true,
              },
            },
            quotationPayment: {
              select: {
                billing: true,
                quotationInstallment: true,
                commission: true,
                downPayment: true,
                downPaymentDueDate: true,
                downPaymentAdditionalFee: true,
                description: true,
                downPaymentConditionId: true,
                paymentCondition: {
                  select: {
                    id: true,
                    generateInvoice: true,
                    invoiceType: true,
                  },
                },
              },
            },
            quotationProduct: {
              include: {
                product: true,
                items: true,
              },
            },
            client: true,
            series: {
              select: {
                id: true,
                title: true,
                code: true,
                productionStatus: true,
              },
            },
          },
        });

        await this.validateClientForApproval(quotation.client, userId, prisma);

        if (!quotation.deliveryInfo) {
          throw new Error('Informações de entrega ausentes na venda.');
        }

        const order = await this.createOrUpdateOrder(quotation, prisma);

        return { quotation, order };
      },
      { timeout: 5000 },
    );

    try {
      // Side-effects TX: delivery schedule + financials (separate, longer timeout)
      await this.prisma.$transaction(
        async (prisma) => {
          await this.createDeliveryScheduleForApproval(
            quotation as any,
            order,
            isTrial,
            prisma,
          );

          await this.handleApprovalFinancials(quotationId, quotation, prisma);
        },
        { timeout: 15000 },
      );
    } catch (error) {
      this.logger.error(
        'Error in approval side-effects (delivery/financials):',
        error.stack,
      );
      // Side-effects failed but core approval succeeded — log and rethrow
      throw error;
    }

    // Post-TX: production stages (non-transactional, idempotent)
    await this.createProductionStages(order.quotationId, isTrial);

    // History: register approval
    if (userId) {
      const userName = await this.resolveUserName(userId);
      await this.createQuotationHistoryEntry({
        quotationId,
        action: 'APPROVED',
        description: `Orçamento aprovado por ${userName || 'Usuário'}`,
        createdBy: userId,
        createdByName: userName,
      });
      await this.createOrderHistoryEntry({
        orderId: order.id,
        action: 'CREATED',
        description: `Ordem de serviço criada via aprovação do orçamento`,
        metadata: { quotationId },
        createdBy: userId,
        createdByName: userName,
      });
    }

    // Signal: generate invoice if payment condition demands it
    const paymentCondition = (quotation as any).quotationPayment?.paymentCondition;
    if (paymentCondition?.generateInvoice && paymentCondition?.invoiceType) {
      this.logger.log(
        `Quotation ${quotationId} approved with generateInvoice=${paymentCondition.invoiceType}. ` +
          `NF emission pending for order ${order.id}.`,
      );
      await this.createOrderHistoryEntry({
        orderId: order.id,
        action: 'NF_PENDING',
        description: `Nota fiscal ${paymentCondition.invoiceType} pendente de emissão (condição de pagamento)`,
        metadata: {
          invoiceType: paymentCondition.invoiceType,
          paymentConditionId: paymentCondition.id,
        },
        createdBy: userId,
      });
    }

    return order;
  }

  /**
   * Faturamento manual de um orçamento
   */
  async billQuotation(quotationId: string) {
    const existingFinancials = await this.prisma.$transaction(
      async (prisma) => {
        const [existingReceivables, existingPayables] = await Promise.all([
          prisma.receivable.findMany({
            where: { quotationId },
            select: { id: true },
          }),
          prisma.payable.findMany({
            where: { quotationId },
            select: { id: true },
          }),
        ]);
        return { receivables: existingReceivables, payables: existingPayables };
      },
    );

    if (
      existingFinancials.receivables.length > 0 ||
      existingFinancials.payables.length > 0
    ) {
      this.logger.log(
        `Financials already exist for quotation ${quotationId}. Skipping bill creation.`,
      );
      return {
        quotation: { id: quotationId },
        receivable: null,
        payable: null,
        message: 'Financial records already exist for this quotation',
      };
    }

    const quotation = await this.prisma.quotation.findUnique({
      where: { id: quotationId },
      include: {
        quotationProduct: {
          include: {
            product: true,
            items: true,
          },
        },
        deliveryInfo: {
          include: {
            deliverySchedule: true,
          },
        },
        quotationPayment: {
          select: {
            billing: true,
            quotationInstallment: true,
            commission: true,
            downPayment: true,
            downPaymentDueDate: true,
            downPaymentAdditionalFee: true,
            description: true,
            downPaymentConditionId: true,
          },
        },
        client: true,
        series: true,
        company: true,
      },
    });

    if (!quotation) {
      throw new NotFoundException(
        `Quotation with ID '${quotationId}' not found.`,
      );
    }

    if (quotation.status !== QuotationStatus.APPROVED) {
      throw new BadRequestException(
        'Somente orçamentos com status APROVADO podem ser faturados.',
      );
    }

    return await this.prisma.$transaction(
      async (prisma) => {
        if (quotation.deliveryInfo?.deliverySchedule) {
          await prisma.deliverySchedule.update({
            where: { id: quotation.deliveryInfo.deliverySchedule.id },
            data: { status: 'DONE' },
          });
        }

        let receivable = null;
        if (quotation.quotationPayment.billing !== 'NO_INVOICE') {
          receivable =
            await this.financialService.generateReceivableFromQuotation(
              quotation,
              prisma,
            );
        }

        const payable =
          await this.financialService.generatePayableFromQuotation(
            quotation,
            prisma,
          );

        return { quotation, receivable, payable };
      },
      {
        timeout: 20000,
      },
    );
  }

  /**
   * Cria etapas de produção para o orçamento
   */
  async createProductionStages(quotationId: string, isTrial: boolean) {
    try {
      const quotation = await this.prisma.quotation.findUnique({
        where: { id: quotationId },
        include: {
          quotationProduct: true,
          deliveryInfo: {
            include: {
              deliverySchedule: true,
            },
          },
        },
      });
      if (!quotation) {
        this.logger.error('Orçamento não encontrado.');
        return;
      }

      const quotationProductsIds = quotation.quotationProduct.map(
        (product) => product.productId,
      );

      const products = await this.prisma.product.findMany({
        where: {
          id: {
            in: quotationProductsIds,
          },
          productionStages: {
            not: null,
          },
        },
        select: {
          id: true,
          productionStages: true,
        },
      });

      const allStages = products.flatMap((product) => {
        const stages =
          typeof product.productionStages === 'string'
            ? JSON.parse(product.productionStages)
            : product.productionStages;

        return stages.filter((stage: ProductionStageJson) => stage.isActive);
      });

      const uniqueStages = Array.from(
        new Map(allStages.map((stage) => [stage.id, stage])).values(),
      );

      const productionStages = uniqueStages.map((stage, index) => ({
        stageId: stage.id,
        order: index + 1,
        prevStatus: null,
        scheduleId: quotation.deliveryInfo?.deliverySchedule?.id,
      }));

      if (quotation.deliveryInfo?.deliveryType === 'CARRIER') {
        const systemStage = await this.prisma.companySector.findFirst({
          where: {
            isSystem: true,
            companyId: quotation.companyId,
            name: 'Entrega',
          },
          select: {
            id: true,
            name: true,
            icon: true,
          },
        });
        if (systemStage) {
          productionStages.push({
            stageId: systemStage.id,
            order: productionStages.length + 1,
            prevStatus: null,
            scheduleId: quotation.deliveryInfo?.deliverySchedule?.id,
          });
        }
      }
      if (quotation.deliveryInfo?.deliveryType === 'PICKUP') {
        const systemStage = await this.prisma.companySector.findFirst({
          where: {
            isSystem: true,
            companyId: quotation.companyId,
            name: 'Cliente Retira',
          },
          select: {
            id: true,
            name: true,
            icon: true,
          },
        });
        if (systemStage) {
          productionStages.push({
            stageId: systemStage.id,
            order: productionStages.length + 1,
            prevStatus: null,
            scheduleId: quotation.deliveryInfo?.deliverySchedule?.id,
          });
        }
      }

      if (productionStages.length > 0) {
        await this.prisma.productionStage.createMany({
          data: productionStages,
        });
        this.logger.log('Etapas de produção criadas com sucesso!');
      }
    } catch (error) {
      this.logger.error('Erro ao criar etapas de produção:', error.stack);
    }
  }

  /**
   * Rejeita um orçamento
   */
  async reject(
    quotationId: string,
    dto: CancelOrderDto,
    userId?: string,
  ): Promise<Quotation> {
    const quotation = await this.prisma.quotation.findUnique({
      where: { id: quotationId },
      select: { status: true },
    });

    if (!quotation) {
      throw new NotFoundException(
        `Orçamento com ID '${quotationId}' não encontrado.`,
      );
    }

    if (quotation.status === QuotationStatus.APPROVED) {
      throw new BadRequestException(
        'Não é possível rejeitar um orçamento com status aprovado.',
      );
    }

    if (!dto.reasonId) {
      const updatedQuotation = await this.prisma.quotation.update({
        where: { id: quotationId },
        data: {
          status: QuotationStatus.REJECTED,
        },
      });

      // History: register rejection
      if (userId) {
        const userName = await this.resolveUserName(userId);
        await this.createQuotationHistoryEntry({
          quotationId,
          action: 'REJECTED',
          description: `Orçamento rejeitado por ${userName || 'Usuário'}`,
          createdBy: userId,
          createdByName: userName,
        });
      }

      return updatedQuotation;
    }

    try {
      const reason = await this.prisma.reasons.findFirst({
        where: { id: dto.reasonId },
      });

      if (!reason) {
        throw new NotFoundException('Motivo de cancelamento não encontrado.');
      }

      const updatedQuotation = await this.prisma.quotation.update({
        where: { id: quotationId },
        data: {
          status: QuotationStatus.REJECTED,
          reasonId: dto.reasonId,
        },
      });

      // History: register rejection with reason
      if (userId) {
        const userName = await this.resolveUserName(userId);
        await this.createQuotationHistoryEntry({
          quotationId,
          action: 'REJECTED',
          description: `Orçamento rejeitado por ${userName || 'Usuário'}`,
          metadata: {
            reasonId: dto.reasonId,
            reasonDescription: reason.reason,
          },
          createdBy: userId,
          createdByName: userName,
        });
      }

      return updatedQuotation;
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError) {
        throw new BadRequestException(
          'Erro na base de dados ao cancelar a ordem.',
        );
      }
      this.logger.error('Error rejecting quotation:', error.stack);
      throw new BadRequestException('Erro interno ao cancelar a ordem.');
    }
  }

  /**
   * Finaliza (conclui) um orçamento
   */
  async finish(quotationId: string, userId?: string): Promise<Quotation> {
    const quotation = await this.prisma.quotation.findUnique({
      where: { id: quotationId },
      include: {
        series: {
          select: {
            proposalValidity: true,
          },
        },
        seller: {
          select: {
            sellerProfile: {
              select: {
                id: true,
                maxDiscount: true,
                minValue: true,
              },
            },
          },
        },
        quotationPayment: {
          select: {
            billing: true,
            finalValue: true,
            totalValue: true,
            discountValue: true,
            discountTotal: true,
            discountType: true,
            quotationInstallment: true,
          },
        },
        quotationProduct: {
          select: {
            discount: true,
            discountType: true,
            totalValue: true,
            finalValue: true,
          },
        },
      },
    });

    if (!quotation) {
      throw new NotFoundException(
        `Orçamento com ID '${quotationId}' não encontrado.`,
      );
    }

    if (quotation.status === QuotationStatus.APPROVED) {
      throw new BadRequestException(
        'Não é possível concluir um orçamento com status aprovado.',
      );
    }

    if (
      quotation.quotationPayment.quotationInstallment.length === 0 &&
      quotation.quotationPayment.billing !== 'NO_INVOICE'
    ) {
      throw new BadRequestException('O orçamento não possui parcelas.');
    }

    if (!quotation || !quotation.seller || !quotation.seller.sellerProfile) {
      throw new BadRequestException('Informações do vendedor não encontradas.');
    }

    const minValue = quotation.seller.sellerProfile.minValue;
    const maxDiscount = quotation.seller.sellerProfile.maxDiscount;

    if (quotation.totalValue < minValue) {
      const formattedMinValue = new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      }).format(minValue / 100);
      throw new BadRequestException(
        `O valor total do orçamento deve ser maior que o valor mínimo de venda do vendedor (${formattedMinValue}).`,
      );
    }

    // Validação de desconto máximo
    if (maxDiscount !== null && maxDiscount !== undefined) {
      const originalValue =
        quotation.quotationProduct?.reduce(
          (sum, product) => sum + (product.totalValue || 0),
          0,
        ) || quotation.totalValue;

      let finalValue = quotation.quotationPayment?.finalValue;

      if (!finalValue && quotation.quotationPayment?.discountTotal) {
        finalValue =
          quotation.totalValue - quotation.quotationPayment.discountTotal;
      }

      if (!finalValue) {
        finalValue = calculateFinalValue(
          quotation.totalValue,
          quotation.quotationPayment?.discountValue ?? null,
          quotation.quotationPayment?.discountType ?? null,
        );
      }

      const totalDiscount = originalValue - finalValue;
      const discountPercentage = (totalDiscount / originalValue) * 100;

      if (discountPercentage > maxDiscount) {
        throw new BadRequestException(
          `O desconto aplicado (${discountPercentage.toFixed(2)}%) excede o limite máximo permitido para este vendedor (${maxDiscount}%).`,
        );
      }
    }

    const finishedAt = new Date();
    const proposalValidity = quotation.series?.proposalValidity || 0;
    const newDueDate =
      proposalValidity > 0
        ? add(finishedAt, { days: proposalValidity })
        : quotation.dueDate;

    try {
      const updatedQuotation = await this.prisma.quotation.update({
        where: { id: quotationId },
        data: {
          status: QuotationStatus.DONE,
          finishedAt,
          dueDate: newDueDate,
        },
      });

      // History: register finish
      if (userId) {
        const userName = await this.resolveUserName(userId);
        await this.createQuotationHistoryEntry({
          quotationId,
          action: 'FINISHED',
          description: `Orçamento concluído por ${userName || 'Usuário'}`,
          metadata: {
            finishedAt: finishedAt.toISOString(),
            dueDate: newDueDate?.toISOString(),
          },
          createdBy: userId,
          createdByName: userName,
        });
      }

      return updatedQuotation;
    } catch (error) {
      this.logger.error('Error finishing quotation:', error.stack);
      throw new BadRequestException('Erro ao atualizar o status do orçamento.');
    }
  }

  /**
   * Reabre um orçamento
   */
  async open(quotationId: string, userId?: string): Promise<Quotation> {
    const quotation = await this.prisma.quotation.findUnique({
      where: { id: quotationId },
      select: { status: true },
    });

    if (!quotation) {
      throw new NotFoundException(
        `Orçamento com ID '${quotationId}' não encontrado.`,
      );
    }

    if (quotation.status === QuotationStatus.APPROVED) {
      throw new BadRequestException(
        'Não é possível abrir um orçamento com status aprovado.',
      );
    }

    try {
      const updatedQuotation = await this.prisma.quotation.update({
        where: { id: quotationId },
        data: {
          status: QuotationStatus.OPEN,
          finishedAt: null,
          dueDate: null,
          reasons: {
            disconnect: true,
          },
        },
      });

      // History: register reopen
      if (userId) {
        const userName = await this.resolveUserName(userId);
        await this.createQuotationHistoryEntry({
          quotationId,
          action: 'REOPENED',
          description: `Orçamento reaberto por ${userName || 'Usuário'}`,
          createdBy: userId,
          createdByName: userName,
        });
      }

      return updatedQuotation;
    } catch (error) {
      this.logger.error(
        'Error updating quotation status to OPEN:',
        error.stack,
      );
      throw new BadRequestException('Erro ao reabrir o orçamento.');
    }
  }
}
