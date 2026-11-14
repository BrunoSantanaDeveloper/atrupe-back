import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
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
import {
  BASE_PRICE_ITEM_SELECT,
  basePriceContext,
  discountOverBase,
  soldMeasureOf,
} from './item-base-price';
import { PlanControlService } from '../../plan/plan-control.service';
import { companyWithoutKeys } from 'src/shared/company/company-keys';
import { ProductSaleService } from '../../assembly/product-sale.service';
import { SaleChoicesDto } from '../../assembly/dto/sale.dto';
import {
  CLIENT_BLOCKED_MESSAGE,
  CREDIT_APPROVAL_HINT,
  CreditCheckService,
  PaymentHold,
  brl,
} from './credit-check.service';
import {
  HOLD_NOT_PENDING,
  HOLD_RELEASE_REASON_REQUIRED,
  PaymentHoldReleaser,
  ReleaseOptions,
} from './payment-hold';
import { ProductionProjectService } from '../../production/production-project.service';
import { snapshotStages } from './item-origin';
import {
  QUICK_SALE_ALREADY_SENT,
  CASH_FRONT_NOT_IN_PLAN,
  CHARGES_AT_SALE,
  NOT_AT_CHECKOUT,
  receivesOutsideOrder,
  ensurePendingSale,
} from '../quick-sale/quick-sale.rules';

export const ALREADY_APPROVED_MESSAGE = 'Este orçamento já está aprovado.';
export const ALREADY_PENDING_PAYMENT =
  'Esta venda já está pendente de pagamento: ela é aprovada quando o título "⚠️ Pendência" for pago no financeiro.';
export const PREPAYMENT_NEEDS_INVOICE =
  'Esta venda precisa ser paga antes de virar ordem de serviço, mas a cobrança sem nota não gera título no financeiro para receber. Mude a cobrança da venda, ou tire a exigência de pagamento antecipado no cadastro do cliente.';
export const PENDING_PAYMENT_LOCKED =
  'Esta venda está pendente de pagamento. Para mudar algo, volte a venda para digitação: o título "⚠️ Pendência" é cancelado.';
export const holdPaidMessage = (paid: number) =>
  `Esta venda já tem ${brl(paid)} recebido do pagamento antecipado. Para desistir, estorne o recebimento no financeiro (título "⚠️ Pendência") e tente de novo.`;
export const ONLY_SEND_TO_CASH =
  'Seu perfil só envia a venda ao caixa: a forma de pagamento e o faturamento ficam com o caixa';
export const PAYMENT_CONDITION_REQUIRED =
  'Informe a condição de pagamento para aprovar';
export const DOWN_PAYMENT_DUE_DATE_REQUIRED =
  'A entrada deste orçamento está sem data de vencimento. Edite as condições de pagamento e informe a data antes de aprovar.';
export const INACTIVE_PRODUCT_ITEMS =
  'Este orçamento não pode ser aprovado: troque ou retire os itens com produto inativo';

// A conta a pagar do terceirizado avulso (T-3): fora da conta "tem
// financeiro?" da venda, que decide se gera receber e pagar no pedido
const OUTSOURCED = 'OUTSOURCED' as const;
const NOT_OUTSOURCED = { not: OUTSOURCED };

/** O que a aprovação lê do orçamento para a O.S., a agenda e o financeiro. */
const APPROVAL_INCLUDE = Prisma.validator<Prisma.QuotationInclude>()({
  deliveryInfo: {
    select: {
      id: true,
      estimatedDate: true,
      daysAfterApproval: true,
      cost: true,
      value: true,
      supplierId: true,
      deliveryType: true,
    },
  },
  quotationPayment: {
    select: {
      billing: true,
      totalValue: true,
      finalValue: true,
      discountTotal: true,
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
});

export type ApprovalQuotation = Prisma.QuotationGetPayload<{
  include: typeof APPROVAL_INCLUDE;
}>;

/**
 * O "Cobrar" da venda rápida (VR-5): recebe as partes na mesma transação da
 * aprovação, para a venda não ficar aprovada sem o recebimento.
 */
export type QuickSaleCharge = (
  prisma: Prisma.TransactionClient,
  quotation: ApprovalQuotation,
) => Promise<void>;

/** A O.S. da aprovação, com o projeto de produção que nasceu (ou nulo). */
export type ApprovedOrder = Order & {
  productionProject: { id: string; tasks: number; status: string } | null;
};

/**
 * A aprovação com pendência (PA-4): a venda espera o pagamento, sem O.S.
 * A tela reconhece pelo `pendingPayment`.
 */
export type HeldSale = {
  pendingPayment: true;
  quotationId: string;
  holdReason: 'PREPAYMENT' | 'CREDIT_LIMIT';
  holdAmount: number;
  receivableId: string;
};

/** Quanto existe de cada passo da aprovação; o reprocesso compara antes e depois. */
type ApprovalState = {
  order: number;
  deliverySchedule: number;
  receivables: number;
  payables: number;
  productionStages: number;
  snapshots: number;
  outsourcedPayables: number;
  productionProject: number;
};

export type ApprovalReprocessResult = {
  orderId: string;
  /** Os passos que o reprocesso completou; vazio quando nada faltava. */
  created: (keyof ApprovalState)[];
  /** Os passos de depois da aprovação que falharam de novo. */
  failed: { step: string; message: string }[];
};

/**
 * QuotationWorkflowService
 * Responsável por mudanças de status e workflow do orçamento.
 */
@Injectable()
export class QuotationWorkflowService implements PaymentHoldReleaser {
  private readonly logger = new Logger(QuotationWorkflowService.name);

  constructor(
    private prisma: PrismaService,
    private financialService: QuotationFinancialService,
    private deliveryScheduleService: DeliveryScheduleService,
    private planControl: PlanControlService,
    private productSale: ProductSaleService,
    private credit: CreditCheckService,
    private production: ProductionProjectService,
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
   * A agenda da venda aprovada nasce em produção só para quem vê as abas de
   * produção (`delivery_production_tabs`); sem a chave (o Start e o teste
   * gratuito, na composição padrão), a venda vai direto para a entrega. A
   * regra olhava o nome do plano, e um Start com a chave de cortesia pulava a
   * produção mesmo assim.
   *
   * Sem assinatura (empresa migrada ainda sem plano) ou com erro na leitura,
   * nasce em produção, como antes.
   */
  private async startsInProduction(companyId: string): Promise<boolean> {
    try {
      const planInfo = await this.planControl.getCompanyPlanInfo(companyId);
      if (!planInfo) return true;
      return !!planInfo.features['delivery_production_tabs'];
    } catch (error) {
      this.logger.error(
        'Error checking delivery production tabs feature:',
        error.stack,
      );
      return true;
    }
  }

  /**
   * Valida se o cliente pode ter o orçamento aprovado
   */
  /** O perfil do vendedor só envia ao caixa (FC-12.1); o Admin não. */
  private async onlySendsToCash(userId: string | undefined, companyId: string) {
    if (!userId) return false;
    const employee = await this.prisma.employee.findFirst({
      where: { userId, companyId },
      select: {
        role: { select: { name: true } },
        sellerProfile: { select: { onlySendToCash: true } },
      },
    });
    if (!employee || employee.role?.name === 'Admin') return false;
    return !!employee.sellerProfile?.onlySendToCash;
  }

  /** O cliente de balcão da venda rápida da empresa (VR-5). */
  private async isCounterClient(companyId: string, clientId?: string | null) {
    if (!clientId) return false;
    const settings = await this.prisma.quickSaleSettings.findUnique({
      where: { companyId },
      select: { clientId: true },
    });
    return settings?.clientId === clientId;
  }

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
   * O item montado na hora sem nenhuma etapa fica marcado e o orçamento
   * não conclui nem aprova até as etapas existirem (MS-12, ORC-11).
   */
  /**
   * O cliente bloqueado recusa sempre (pacote de 26/10/2026): aprovar, o
   * "Cobrar" e o "Enviar ao caixa" da venda rápida e faturar. Mesmo formato
   * da conferência de crédito (409 CREDIT_CHECK), que a tela já trata.
   */
  private assertClientNotBlocked(
    client: { blockClient?: boolean | null } | null | undefined,
  ) {
    if (!client?.blockClient) return;
    throw new ConflictException({
      statusCode: 409,
      code: 'CREDIT_CHECK',
      message: `${CLIENT_BLOCKED_MESSAGE} ${CREDIT_APPROVAL_HINT}`,
      issues: [{ code: 'CLIENT_BLOCKED' }],
    });
  }

  /**
   * O limite de desconto do vendedor (EC-2, ALT-8): o desconto sobre a soma
   * dos preços base do cadastro (baixar o preço do item conta como desconto),
   * a mesma conta da tela (lib/discountLimit). Acréscimo e linhas ficam
   * fora; item sem preço base também. O /finish, a aprovação e o "Cobrar" da
   * venda rápida conferem (pacote de 26/10/2026; antes, sobre o valor
   * digitado).
   */
  private async assertDiscountLimit(
    quotationId: string,
    companyId: string,
    generalDiscount: number | null | undefined,
    maxDiscount: number | null | undefined,
  ) {
    if (maxDiscount === null || maxDiscount === undefined) return;
    const items = await this.prisma.quotationProduct.findMany({
      where: { quotationId },
      select: BASE_PRICE_ITEM_SELECT,
    });
    const context = await basePriceContext(
      this.prisma,
      this.planControl,
      companyId,
      items.filter((item) => item.origin === 'COMPOSED').map((item) => item.id),
    );
    const { base, percentage } = discountOverBase(
      items,
      context,
      generalDiscount ?? 0,
    );
    if (base > 0 && percentage > maxDiscount) {
      throw new BadRequestException(
        `O desconto aplicado (${percentage.toFixed(2)}%) excede o limite máximo permitido para este vendedor (${maxDiscount}%).`,
      );
    }
  }

  private async assertComposedReady(
    quotationId: string,
    action: 'concluir' | 'aprovar',
  ) {
    const pending = await this.prisma.quotationProduct.findMany({
      where: {
        quotationId,
        origin: 'COMPOSED',
        OR: [
          { draftId: null },
          { draft: { is: { assembly: { is: null } } } },
          { draft: { is: { assembly: { is: { blocks: { none: {} } } } } } },
        ],
      },
      select: { id: true, description: true },
    });
    if (!pending.length) return;
    throw new BadRequestException({
      statusCode: 400,
      message: `${
        pending.length === 1
          ? 'O item montado está sem etapas'
          : 'Itens montados estão sem etapas'
      }: monte as etapas antes de ${action}.`,
      items: pending.map((item) => ({
        itemId: item.id,
        name: item.description || 'Item montado',
      })),
    });
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
   * Cria o agendamento de entrega para o orçamento aprovado. A venda que já
   * tem agenda fica como está: o reprocesso passa por aqui de novo.
   */
  private async createDeliveryScheduleForApproval(
    quotation: {
      id: string;
      companyId: string;
      approvedAt: Date | null;
      deliveryInfo: {
        id: string;
        daysAfterApproval: number | null;
      } | null;
    },
    order: Order,
    startsInProduction: boolean,
    prisma: Prisma.TransactionClient,
  ): Promise<void> {
    if (!quotation.deliveryInfo) return;

    const existing = await prisma.deliverySchedule.findFirst({
      where: {
        OR: [
          { quotationId: quotation.id },
          { deliveryInfoId: quotation.deliveryInfo.id },
        ],
      },
      select: { id: true },
    });
    if (existing) return;

    const deliveryStatus = startsInProduction ? 'IN_PRODUCTION' : 'DELIVERING';
    const approvedAt = quotation.approvedAt ?? new Date();

    const estimatedDate = quotation.deliveryInfo.daysAfterApproval
      ? add(approvedAt, {
          days: quotation.deliveryInfo.daysAfterApproval,
        })
      : approvedAt;

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
    const [existingReceivables, existingPayables, held] = await Promise.all([
      prisma.receivable.findMany({
        where: { quotationId, releasesQuotation: false },
        select: { id: true },
      }),
      prisma.payable.findMany({
        where: { quotationId, financialType: NOT_OUTSOURCED },
        select: { id: true },
      }),
      this.heldReceivableTypes(quotationId, prisma),
    ]);

    if (
      existingReceivables.length === 0 &&
      existingPayables.length === 0 &&
      quotation.quotationPayment?.billing === 'ON_ORDER'
    ) {
      await this.generateRestOfReceivables(quotation, held, prisma);
      await this.financialService.generatePayableFromQuotation(
        quotation,
        prisma,
      );
    }
  }

  /**
   * Os tipos de título "⚠️ Pendência" que a venda já tem (PA-5): a
   * liberação gera só o resto.
   */
  private async heldReceivableTypes(
    quotationId: string,
    prisma: Prisma.TransactionClient,
  ): Promise<string[]> {
    const rows = await prisma.receivable.findMany({
      where: {
        quotationId,
        releasesQuotation: true,
        status: { not: 'CANCELED' },
      },
      select: { financialType: true },
    });
    return rows.map((row) => row.financialType);
  }

  /** O título da venda sem o que já nasceu com a pendência. */
  private async generateRestOfReceivables(
    quotation: QuotationForFinancial,
    held: string[],
    prisma: Prisma.TransactionClient,
  ) {
    if (held.includes('MAIN')) return null;
    return this.financialService.generateReceivableFromQuotation(
      quotation,
      prisma,
      { skipDownPayment: held.includes('DOWN_PAYMENT') },
    );
  }

  // =====================================================
  // MAIN WORKFLOW METHODS
  // =====================================================

  /**
   * Aprova um orçamento e cria a O.S., em três passos:
   * 1. confere antes de gravar: orçamento ainda não aprovado, informações de
   *    entrega, cadastro do cliente e o crédito dele (a importação não
   *    confere o crédito: a venda já foi aprovada no sistema de origem);
   * 2. numa transação só, APPROVED, O.S., agenda e financeiro: uma falha no
   *    financeiro (venda sem parcelas, por exemplo) desfaz a aprovação
   *    inteira, em vez de deixar a venda aprovada pela metade;
   * 3. depois da transação, o que o reprocesso (`reprocessApproval`) refaz:
   *    hoje, as etapas de produção da agenda.
   *
   * O recebimento é da série (VR-5, revista em 26/10/2026): o orçamento
   * cuja série fatura na frente de caixa (`billing === 'ON_CHECKOUT'`),
   * rápido ou comum, aprova sem condição de pagamento e sem título. Sem o
   * `options.charge`, aprovar é enviar ao caixa (FC-12); com ele, o vendedor
   * cobra à vista na hora. A venda rápida é só a abertura do orçamento.
   */
  async approve(
    quotationId: string,
    userId?: string,
    approvedAt?: Date,
    options: { creditCheck?: boolean; charge?: QuickSaleCharge } = {},
  ): Promise<ApprovedOrder | HeldSale> {
    const current = await this.prisma.quotation.findUnique({
      where: { id: quotationId },
      select: {
        companyId: true,
        status: true,
        quickSale: true,
        totalValue: true,
        pendingSale: { select: { id: true } },
        client: { select: { id: true, status: true, blockClient: true } },
        deliveryInfo: { select: { id: true } },
        // O limite de desconto do vendedor do orçamento (EC-2)
        seller: {
          select: { sellerProfile: { select: { maxDiscount: true } } },
        },
        quotationPayment: {
          select: {
            billing: true,
            finalValue: true,
            discountTotal: true,
            discountValue: true,
            discountType: true,
            downPayment: true,
            downPaymentDueDate: true,
            _count: { select: { quotationInstallment: true } },
          },
        },
        quotationProduct: {
          select: {
            id: true,
            description: true,
            totalValue: true,
            addition: true,
            linesTotal: true,
            product: { select: { name: true, isActive: true } },
            // O material de venda direta inativado trava como o produto
            material: { select: { name: true, active: true } },
            lines: {
              where: { kind: 'PART' },
              select: { product: { select: { isActive: true } } },
            },
          },
        },
      },
    });

    if (!current) {
      throw new NotFoundException(
        `Quotation with ID '${quotationId}' not found.`,
      );
    }
    // Frente de caixa ou "Cobrar na venda": aprova sem condição de pagamento
    // e sem título (VR-10, 14/11/2026)
    const billing = current.quotationPayment?.billing;
    const atCheckout = receivesOutsideOrder(billing);
    if (atCheckout && current.pendingSale) {
      throw new ConflictException(QUICK_SALE_ALREADY_SENT);
    }
    if (current.status === QuotationStatus.APPROVED) {
      throw new ConflictException(ALREADY_APPROVED_MESSAGE);
    }
    if (current.status === QuotationStatus.PENDING_PAYMENT) {
      throw new ConflictException(ALREADY_PENDING_PAYMENT);
    }
    // Uma série é um ou outro (VR-10): a que cobra na venda não envia ao
    // caixa, e a da frente de caixa não é cobrada pelo vendedor
    if (billing === 'ON_SALE' && !options.charge) {
      throw new BadRequestException(CHARGES_AT_SALE);
    }
    if (billing === 'ON_CHECKOUT' && options.charge) {
      throw new BadRequestException(NOT_AT_CHECKOUT);
    }
    // Enviar ao caixa só com a frente de caixa no plano: senão a venda
    // ficaria numa fila que ninguém atende
    if (
      atCheckout &&
      !options.charge &&
      !(await this.planControl.hasFeature(current.companyId, 'pdv_screen'))
    ) {
      throw new BadRequestException(CASH_FRONT_NOT_IN_PLAN);
    }
    // Somente enviar ao caixa (FC-12.1): esse vendedor só envia a venda à
    // frente de caixa; cobrar na hora, ou aprovar o orçamento com forma de
    // pagamento, é com o caixa. A importação não passa por aqui
    if (
      options.creditCheck !== false &&
      (!atCheckout || options.charge) &&
      (await this.onlySendsToCash(userId, current.companyId))
    ) {
      throw new ForbiddenException(ONLY_SEND_TO_CASH);
    }
    // O cliente bloqueado no cadastro não compra: é decisão explícita de quem
    // o bloqueou, vale sempre (em qualquer plano e antes da data de corte do
    // crédito), também na venda rápida. A importação não confere
    if (options.creditCheck !== false) {
      this.assertClientNotBlocked(current.client);
    }
    if (!current.deliveryInfo) {
      throw new BadRequestException(
        'Informações de entrega ausentes na venda.',
      );
    }
    // Todo orçamento nasce com a condição padrão: sem condição é sem as
    // parcelas definidas. Só a série da frente de caixa aprova assim: a
    // forma é com o caixa (FC-1). A cobrança sem nota não tem parcelas
    const payment = current.quotationPayment;
    const hasCondition =
      payment?.billing === 'NO_INVOICE' ||
      (payment?._count.quotationInstallment ?? 0) > 0;
    if (!atCheckout && !hasCondition) {
      throw new BadRequestException(PAYMENT_CONDITION_REQUIRED);
    }
    // Entrada com valor e sem vencimento: a parcela da entrada não tem data
    // (`dueDate` é NOT NULL) e o financeiro falharia no meio da transação.
    // Recusa aqui, com o que corrigir. A série da frente de caixa não gera o
    // título, e a cobrança sem nota não tem parcelas
    if (
      !atCheckout &&
      payment?.billing !== 'NO_INVOICE' &&
      (payment?.downPayment ?? 0) > 0 &&
      !payment?.downPaymentDueDate
    ) {
      throw new BadRequestException(DOWN_PAYMENT_DUE_DATE_REQUIRED);
    }
    // Produto, ou parte de uma linha, inativado depois de lançado (PAD-7):
    // a tela recebe os itens a trocar ou retirar
    const inactive = (current.quotationProduct ?? []).filter(
      (item) =>
        item.product?.isActive === false ||
        item.material?.active === false ||
        (item.lines ?? []).some((line) => line.product?.isActive === false),
    );
    if (inactive.length) {
      throw new BadRequestException({
        statusCode: 400,
        message: INACTIVE_PRODUCT_ITEMS,
        items: inactive.map((item) => ({
          itemId: item.id,
          name:
            item.description || item.product?.name || item.material?.name || '',
        })),
      });
    }
    await this.assertComposedReady(quotationId, 'aprovar');
    // O limite de desconto do vendedor vale aqui também: a venda da frente
    // de caixa vai direto ao "Cobrar" ou ao caixa, sem o /finish. A
    // importação não confere
    if (options.creditCheck !== false) {
      await this.assertDiscountLimit(
        quotationId,
        current.companyId,
        current.quotationPayment?.discountTotal,
        current.seller?.sellerProfile?.maxDiscount,
      );
    }
    // O cadastro do cliente (pré-cadastro só com o "Aprova pré-cadastro" do
    // perfil) vale também no "Cobrar" e no "Enviar ao caixa" da série da
    // frente de caixa (pacote de 27/10/2026, 4.2.2). Fica de fora o cliente
    // de balcão da venda rápida: o consumidor sem cadastro, que o
    // faturamento para o cliente confere na frente de caixa (FC-4)
    if (
      !atCheckout ||
      !(await this.isCounterClient(current.companyId, current.client?.id))
    ) {
      await this.validateClientForApproval(current.client, userId, this.prisma);
    }
    // O crédito recusa, ou pede o pagamento antes (PA, 12/11/2026). A
    // frente de caixa já recebe antes de liberar (PA-9)
    let hold: PaymentHold = null;
    if (options.creditCheck !== false && !atCheckout) {
      hold = await this.credit.assertApproval(quotationId);
    }
    // A cobrança sem nota não gera título: não há o que receber antes. Sem
    // isso, a pendência quebrava no financeiro com um 400 sem caminho
    if (hold && payment?.billing === 'NO_INVOICE') {
      throw new ConflictException(PREPAYMENT_NEEDS_INVOICE);
    }
    if (hold) return this.holdForPayment(quotationId, hold, userId);

    const startsInProduction = await this.startsInProduction(current.companyId);

    const { quotation, order } = await this.prisma.$transaction(
      async (prisma) => {
        // Só uma aprovação passa: com dois cliques, a segunda espera a
        // primeira terminar e encontra o orçamento já aprovado
        const claimed = await prisma.quotation.updateMany({
          where: {
            id: quotationId,
            status: {
              notIn: [
                QuotationStatus.APPROVED,
                QuotationStatus.PENDING_PAYMENT,
              ],
            },
          },
          data: {
            status: QuotationStatus.APPROVED,
            approvedAt: approvedAt ?? new Date(),
          },
        });
        if (claimed.count === 0) {
          throw new ConflictException(ALREADY_APPROVED_MESSAGE);
        }

        const quotation = await prisma.quotation.findUniqueOrThrow({
          where: { id: quotationId },
          include: APPROVAL_INCLUDE,
        });
        const order = await this.completeApproval(
          quotation,
          startsInProduction,
          prisma,
          atCheckout,
        );
        if (atCheckout && !options.charge) {
          await ensurePendingSale(
            prisma,
            quotation,
            current.quickSale ? 'QUICK' : 'QUOTATION',
          );
        }
        if (options.charge) await options.charge(prisma, quotation);
        return { quotation, order };
      },
      { timeout: 20000 },
    );

    // Fora da transação: uma falha aqui não desfaz a venda, e o reprocesso
    // cria o que faltar
    for (const failure of await this.afterApproval(quotationId)) {
      this.logger.error(
        `${failure.step} não criado na aprovação do orçamento ${quotationId} (o reprocesso refaz): ${failure.message}`,
      );
    }

    // History: register approval
    if (userId) {
      const userName = await this.resolveUserName(userId);
      await this.createQuotationHistoryEntry({
        quotationId,
        action: 'APPROVED',
        description: `${
          atCheckout && !options.charge
            ? 'Venda enviada ao caixa'
            : options.charge
              ? 'Venda cobrada e aprovada'
              : 'Orçamento aprovado'
        } por ${userName || 'Usuário'}`,
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
    const paymentCondition = quotation.quotationPayment?.paymentCondition;
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

    // O projeto de produção que nasceu (ELITE), ou nulo
    return Object.assign(order, {
      productionProject: await this.production.summaryOf(quotationId),
    });
  }

  /**
   * O.S., agenda e financeiro da venda aprovada. Cada passo confere o que já
   * existe: o reprocesso completa uma aprovação antiga sem duplicar nada.
   * A venda da série da frente de caixa recebe no caixa ou no "Cobrar": a
   * condição de pagamento dela não gera título.
   */
  private async completeApproval(
    quotation: ApprovalQuotation,
    startsInProduction: boolean,
    prisma: Prisma.TransactionClient,
    atCheckout = false,
  ): Promise<Order> {
    const order = await this.createOrUpdateOrder(quotation, prisma);
    await this.createDeliveryScheduleForApproval(
      quotation,
      order,
      startsInProduction,
      prisma,
    );
    if (!atCheckout) {
      await this.handleApprovalFinancials(quotation.id, quotation, prisma);
    }
    return order;
  }

  /**
   * Completa a aprovação de uma venda já aprovada: O.S., agenda, financeiro e
   * etapas de produção que faltarem. Não muda status nem data de aprovação, e
   * rodar de novo não duplica nada. Serve para as vendas aprovadas pela
   * metade antes da transação única e para as etapas que falharam depois da
   * aprovação.
   */
  async reprocessApproval(
    quotationId: string,
    userId?: string,
  ): Promise<ApprovalReprocessResult> {
    const current = await this.prisma.quotation.findUnique({
      where: { id: quotationId },
      select: {
        companyId: true,
        status: true,
        quotationPayment: { select: { billing: true } },
        order: { select: { status: true } },
      },
    });

    if (!current) {
      throw new NotFoundException(
        `Orçamento com ID '${quotationId}' não encontrado.`,
      );
    }
    if (current.status !== QuotationStatus.APPROVED) {
      throw new ConflictException(
        'Só a venda aprovada pode ter a aprovação reprocessada.',
      );
    }
    if (current.order?.status === OrderStatus.CANCELED) {
      throw new ConflictException(
        'A ordem de serviço desta venda foi cancelada.',
      );
    }

    const startsInProduction = await this.startsInProduction(current.companyId);
    const atCheckout = receivesOutsideOrder(current.quotationPayment?.billing);
    const before = await this.approvalState(quotationId);

    const order = await this.prisma.$transaction(
      async (prisma) => {
        const quotation = await prisma.quotation.findUniqueOrThrow({
          where: { id: quotationId },
          include: APPROVAL_INCLUDE,
        });
        return this.completeApproval(
          quotation,
          startsInProduction,
          prisma,
          atCheckout,
        );
      },
      { timeout: 20000 },
    );

    const failed: ApprovalReprocessResult['failed'] =
      await this.afterApproval(quotationId);
    for (const failure of failed) {
      this.logger.error(
        `Reprocesso da aprovação do orçamento ${quotationId}: ${failure.step}: ${failure.message}`,
      );
    }

    const after = await this.approvalState(quotationId);
    const created = (Object.keys(after) as (keyof ApprovalState)[]).filter(
      (step) => after[step] > before[step],
    );

    if (userId && created.length > 0) {
      const userName = await this.resolveUserName(userId);
      await this.createQuotationHistoryEntry({
        quotationId,
        action: 'APPROVAL_REPROCESSED',
        description: `Aprovação reprocessada por ${userName || 'Usuário'}`,
        metadata: { created },
        createdBy: userId,
        createdByName: userName,
      });
    }

    return { orderId: order.id, created, failed };
  }

  private async approvalState(quotationId: string): Promise<ApprovalState> {
    const [
      order,
      deliverySchedule,
      receivables,
      payables,
      productionStages,
      snapshots,
      outsourcedPayables,
      productionProject,
    ] = await Promise.all([
      this.prisma.order.count({ where: { quotationId } }),
      this.prisma.deliverySchedule.count({ where: { quotationId } }),
      this.prisma.receivable.count({ where: { quotationId } }),
      this.prisma.payable.count({
        where: { quotationId, financialType: NOT_OUTSOURCED },
      }),
      this.prisma.productionStage.count({
        where: { schedule: { quotationId } },
      }),
      this.prisma.quotationItemSnapshot.count({
        where: { quotationProduct: { quotationId } },
      }),
      this.prisma.payable.count({
        where: { quotationId, financialType: OUTSOURCED },
      }),
      this.prisma.productionProject.count({ where: { quotationId } }),
    ]);
    return {
      order,
      deliverySchedule,
      receivables,
      payables,
      productionStages,
      snapshots,
      outsourcedPayables,
      productionProject,
    };
  }

  /**
   * Os passos de depois da aprovação, cada um idempotente e isolado: a
   * falha de um não impede os outros e volta na lista para o reprocesso.
   */
  private async afterApproval(
    quotationId: string,
  ): Promise<ApprovalReprocessResult['failed']> {
    const steps: [string, () => Promise<void>][] = [
      ['productionStages', () => this.ensureProductionStages(quotationId)],
      ['snapshots', () => this.ensureSnapshots(quotationId)],
      ['outsourcedPayables', () => this.ensureOutsourcedPayables(quotationId)],
      // Depois do retrato: as tarefas nascem dele (ELITE, Fase 6)
      [
        'productionProject',
        () => this.production.ensureFromQuotation(quotationId),
      ],
    ];
    const failed: ApprovalReprocessResult['failed'] = [];
    for (const [step, run] of steps) {
      try {
        await run();
      } catch (error) {
        failed.push({ step, message: error.message });
      }
    }
    return failed;
  }

  /**
   * O retrato da venda (ORC-10) de cada item com composição liberada que
   * ainda não tem (lançado antes da Fase 4, ou com falha no cálculo): com
   * as escolhas guardadas no item. Da aprovação em diante, o retrato não
   * muda: a edição da O.S. não refaz a conta.
   */
  private async ensureSnapshots(quotationId: string): Promise<void> {
    const items = await this.prisma.quotationProduct.findMany({
      where: {
        quotationId,
        snapshot: { is: null },
        product: {
          assemblies: { some: { variationKey: '', status: 'RELEASED' } },
        },
      },
      select: {
        id: true,
        productId: true,
        variationId: true,
        quantity: true,
        composition: true,
        items: { select: { width: true, height: true }, take: 1 },
        product: { select: { companyId: true } },
        quotation: { select: { companyId: true } },
      },
    });
    const errors: string[] = [];
    for (const item of items) {
      try {
        const { snapshot } = await this.productSale.itemComposition(
          item.product.companyId ?? item.quotation.companyId,
          item.productId,
          item.variationId,
          {
            quantity: item.quantity,
            width: item.items[0]?.width || undefined,
            height: item.items[0]?.height || undefined,
          },
          (item.composition as SaleChoicesDto | null) ?? {},
        );
        await this.prisma.quotationItemSnapshot.create({
          data: {
            quotationProductId: item.id,
            data: JSON.parse(JSON.stringify(snapshot)),
          },
        });
      } catch (error) {
        errors.push(`item ${item.id}: ${error.message}`);
      }
    }
    if (errors.length) throw new Error(errors.join('; '));
  }

  /**
   * O custo do terceirizado vira conta a pagar ao fornecedor (T-3, T-5):
   * uma por linha avulsa e uma por item de produto terceirizado, parcela
   * única em 30 dias, como a da entrega. Com as contas já criadas, fica
   * como está.
   */
  private async ensureOutsourcedPayables(quotationId: string): Promise<void> {
    const existing = await this.prisma.payable.count({
      where: { quotationId, financialType: OUTSOURCED },
    });
    if (existing) return;
    const quotation = await this.prisma.quotation.findUnique({
      where: { id: quotationId },
      select: {
        companyId: true,
        quotationNumber: true,
        series: { select: { code: true } },
      },
    });
    if (!quotation) return;
    const entries = await this.outsourcedCosts(quotationId);
    if (!entries.length) return;
    const sale = [quotation.quotationNumber, quotation.series?.code]
      .filter(Boolean)
      .join('-');
    const bankAccount = await this.prisma.bankAccount.findFirst({
      where: { companyId: quotation.companyId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    await this.prisma.$transaction(async (prisma) => {
      for (const entry of entries) {
        const payable = await prisma.payable.create({
          data: {
            referenceDate: new Date(),
            description: `Terceirizado da venda ${sale}: ${entry.name}${entry.supplierName ? ` (${entry.supplierName})` : ''}`,
            totalAmount: entry.cost,
            totalValue: entry.cost,
            mainAdditionalFee: 0,
            installmentQty: 1,
            status: 'PENDING',
            supplierId: entry.supplierId,
            companyId: quotation.companyId,
            quotationId,
            financialType: OUTSOURCED,
          },
        });
        await prisma.payableInstallment.create({
          data: {
            payableId: payable.id,
            installmentNumber: 1,
            dueDate: add(new Date(), { days: 30 }),
            amount: entry.cost,
            additionalFee: 0,
            paymentConditionId: null,
            bankAccountId: bankAccount?.id ?? null,
            status: 'PENDING',
            paidDate: null,
          },
        });
      }
    });
  }

  /**
   * O que a venda deve aos fornecedores: as linhas avulsas (custo informado
   * na hora) e os produtos terceirizados do catálogo (custo do fornecedor
   * por unidade × a medida vendida × a quantidade). A medida sai do item
   * como foi vendido: preço ÷ preço por unidade; no produto por unidade, 1.
   * Devolve também o preço, para a trava de venda abaixo do custo (T-5).
   */
  async outsourcedCosts(quotationId: string) {
    const [lines, products] = await Promise.all([
      this.prisma.quotationItemLine.findMany({
        where: {
          kind: 'LOOSE',
          cost: { gt: 0 },
          quotationProduct: { quotationId },
        },
        select: {
          name: true,
          cost: true,
          price: true,
          supplierId: true,
          supplierName: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.quotationProduct.findMany({
        where: { quotationId, product: { isOutsourced: true } },
        select: {
          id: true,
          description: true,
          quantity: true,
          finalValue: true,
          // O fornecedor escolhido no item (12/11/2026)
          supplier: { select: { id: true, name: true } },
          product: {
            select: {
              name: true,
              outsourcedCost: true,
              suppliers: {
                take: 1,
                orderBy: { name: 'asc' },
                select: { id: true, name: true },
              },
            },
          },
          // A medida vendida de cada linha, como o formulário a calcula
          items: {
            select: {
              unitKind: true,
              quantity: true,
              width: true,
              height: true,
              length: true,
              volume: true,
              weight: true,
              distance: true,
              duration: true,
            },
          },
        },
      }),
    ]);
    const fromLines = lines.map((line) => ({
      name: line.name,
      cost: line.cost,
      price: line.price as number | null,
      supplierId: line.supplierId,
      supplierName: line.supplierName,
    }));
    const fromProducts = products
      .map((item) => {
        const unitCost = item.product?.outsourcedCost ?? 0;
        // A medida vendida já leva a quantidade (a da linha, e a do item no
        // produto de várias linhas); sem linha, a quantidade do item
        const measure = item.items?.length
          ? soldMeasureOf(item)
          : item.quantity || 1;
        // O escolhido no item; sem escolha, o primeiro do produto
        const supplier = item.supplier ?? (item.product?.suppliers ?? [])[0];
        return {
          name: item.description || item.product?.name || 'Terceirizado',
          cost: Math.round(unitCost * measure),
          price: (item.finalValue ?? 0) as number | null,
          supplierId: supplier?.id ?? null,
          supplierName: supplier?.name ?? null,
        };
      })
      .filter((entry) => entry.cost > 0);
    return [...fromLines, ...fromProducts];
  }

  /**
   * O terceirizado nunca vende abaixo do custo (T-5, 24/10/2026): só o
   * administrador aprova um item assim.
   */
  async assertOutsourcedAboveCost(quotationId: string, isAdmin?: boolean) {
    if (isAdmin) return;
    const below = (await this.outsourcedCosts(quotationId)).filter(
      (entry) => entry.price !== null && entry.price < entry.cost,
    );
    if (!below.length) return;
    throw new BadRequestException(
      `O item "${below[0].name}" está abaixo do custo do terceirizado. Só o administrador aprova assim.`,
    );
  }

  /**
   * Faturamento manual de um orçamento
   */
  async billQuotation(quotationId: string) {
    const owner = await this.prisma.quotation.findUnique({
      where: { id: quotationId },
      select: { client: { select: { blockClient: true } } },
    });
    this.assertClientNotBlocked(owner?.client);
    const existingFinancials = await this.prisma.$transaction(
      async (prisma) => {
        const [existingReceivables, existingPayables] = await Promise.all([
          prisma.receivable.findMany({
            where: { quotationId, releasesQuotation: false },
            select: { id: true },
          }),
          prisma.payable.findMany({
            where: { quotationId, financialType: NOT_OUTSOURCED },
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
            totalValue: true,
            finalValue: true,
            discountTotal: true,
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
          receivable = await this.generateRestOfReceivables(
            quotation,
            await this.heldReceivableTypes(quotationId, prisma),
            prisma,
          );
        }

        const payable =
          await this.financialService.generatePayableFromQuotation(
            quotation,
            prisma,
          );

        // A empresa vai inteira no include: sem as chaves do provedor fiscal
        return {
          quotation: {
            ...quotation,
            company: companyWithoutKeys(quotation.company),
          },
          receivable,
          payable,
        };
      },
      {
        timeout: 20000,
      },
    );
  }

  /**
   * Cria etapas de produção para o orçamento (erros vão para o log)
   */
  async createProductionStages(quotationId: string) {
    try {
      await this.ensureProductionStages(quotationId);
    } catch (error) {
      this.logger.error('Erro ao criar etapas de produção:', error.stack);
    }
  }

  /**
   * As etapas de produção da agenda: uma por setor ativo nos produtos da
   * venda, mais "Entrega" ou "Cliente Retira". A agenda que já tem etapas
   * fica como está: aprovar e reprocessar não duplicam.
   */
  private async ensureProductionStages(quotationId: string): Promise<void> {
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

    const scheduleId = quotation.deliveryInfo?.deliverySchedule?.id;
    if (!scheduleId) return;

    const existingStages = await this.prisma.productionStage.count({
      where: { scheduleId },
    });
    if (existingStages > 0) return;

    // O item sem produto (material, montado na hora) fica fora da busca
    const quotationProductsIds = quotation.quotationProduct
      .map((product) => product.productId)
      .filter(Boolean);

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

    // O material de venda direta passa pelo setor dele, quando o setor é
    // etapa de produção (PO, 14/10/2026)
    const materialIds = quotation.quotationProduct
      .map((item) => item.materialId)
      .filter(Boolean);
    const materialSectors = materialIds.length
      ? await this.prisma.material.findMany({
          where: {
            id: { in: materialIds },
            sector: { isProductionStage: true, isActive: true },
          },
          select: { sectorId: true },
        })
      : [];

    // O item montado na hora passa pelos setores das etapas dele, quando
    // são etapa de produção (ORC-11, PO 14/10/2026)
    const composedSnapshots = await this.prisma.quotationItemSnapshot.findMany({
      where: { quotationProduct: { quotationId, origin: 'COMPOSED' } },
      select: { data: true },
    });
    const composedSectorIds = [
      ...new Set(
        composedSnapshots
          .flatMap((row) => snapshotStages(row.data))
          .map((stage) => stage.sectorId)
          .filter(Boolean),
      ),
    ];
    const composedSectors = composedSectorIds.length
      ? await this.prisma.companySector.findMany({
          where: {
            id: { in: composedSectorIds },
            companyId: quotation.companyId,
            isProductionStage: true,
            isActive: true,
          },
          select: { id: true },
        })
      : [];

    const allStages: ProductionStageJson[] = [
      ...products.flatMap((product) => {
        const stages =
          typeof product.productionStages === 'string'
            ? JSON.parse(product.productionStages)
            : product.productionStages;

        return stages.filter((stage: ProductionStageJson) => stage.isActive);
      }),
      ...materialSectors.map((material) => ({
        id: material.sectorId,
        isActive: true,
      })),
      ...composedSectors.map((sector) => ({
        id: sector.id,
        isActive: true,
      })),
    ];

    const uniqueStages = Array.from(
      new Map(allStages.map((stage) => [stage.id, stage])).values(),
    );

    const productionStages = uniqueStages.map((stage, index) => ({
      stageId: stage.id,
      order: index + 1,
      prevStatus: null,
      scheduleId,
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
          scheduleId,
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
          scheduleId,
        });
      }
    }

    if (productionStages.length > 0) {
      await this.prisma.productionStage.createMany({
        data: productionStages,
      });
      this.logger.log('Etapas de produção criadas com sucesso!');
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
      select: { status: true, companyId: true },
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
    // Desistir da venda pendente cancela o título "⚠️ Pendência" (PA-8)
    if (quotation.status === QuotationStatus.PENDING_PAYMENT) {
      await this.cancelHold(quotationId, 'Venda pendente rejeitada', userId);
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
      // O motivo é da empresa do orçamento
      const reason = await this.prisma.reasons.findFirst({
        where: { id: dto.reasonId, companyId: quotation.companyId },
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
      // O motivo não encontrado chegava como "Erro interno ao cancelar a ordem."
      if (error instanceof HttpException) throw error;
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
            addition: true,
            linesTotal: true,
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
    if (quotation.status === QuotationStatus.PENDING_PAYMENT) {
      throw new BadRequestException(PENDING_PAYMENT_LOCKED);
    }
    await this.assertComposedReady(quotationId, 'concluir');

    // Concluir sem condição de pagamento (sem as parcelas) pode, decisão de
    // 05/10/2026: só a aprovação exige. A tela avisa antes o que falta

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

    // Validação de desconto máximo, sobre o preço base (ALT-8)
    await this.assertDiscountLimit(
      quotationId,
      quotation.companyId,
      quotation.quotationPayment?.discountTotal,
      maxDiscount,
    );

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
    // Voltar a venda pendente para digitação cancela o título (PA-8)
    if (quotation.status === QuotationStatus.PENDING_PAYMENT) {
      await this.cancelHold(
        quotationId,
        'Venda pendente voltou para digitação',
        userId,
      );
    }

    try {
      const updatedQuotation = await this.prisma.quotation.update({
        where: { id: quotationId },
        data: {
          status: QuotationStatus.OPEN,
          finishedAt: null,
          dueDate: null,
          holdReason: null,
          holdAmount: null,
          holdAt: null,
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

  // =====================================================
  // PAGAMENTO ANTECIPADO (PA, 12/11/2026)
  // =====================================================

  /**
   * A aprovação com pendência (PA-4): a venda fica PENDING_PAYMENT, sem O.S.,
   * agenda nem produção, e nasce só o título do valor exigido, marcado
   * "⚠️ Pendência" (PA-5): a entrada (limite) ou a venda inteira (cliente
   * com "Exigir pagamento antecipado"). Sempre passa por aqui, mesmo pago
   * no Pix na hora: a baixa do título é que libera (decisão de 12/11).
   */
  private async holdForPayment(
    quotationId: string,
    hold: NonNullable<PaymentHold>,
    userId?: string,
  ): Promise<HeldSale> {
    const receivable = await this.prisma.$transaction(
      async (prisma) => {
        const claimed = await prisma.quotation.updateMany({
          where: {
            id: quotationId,
            status: {
              notIn: [
                QuotationStatus.APPROVED,
                QuotationStatus.PENDING_PAYMENT,
              ],
            },
          },
          data: {
            status: QuotationStatus.PENDING_PAYMENT,
            holdReason: hold.reason,
            holdAmount: hold.amount,
            holdAt: new Date(),
            holdReleasedAt: null,
            holdReleaseNote: null,
            holdReleasedBy: null,
          },
        });
        if (claimed.count === 0) {
          throw new ConflictException(ALREADY_PENDING_PAYMENT);
        }
        const quotation = await prisma.quotation.findUniqueOrThrow({
          where: { id: quotationId },
          include: APPROVAL_INCLUDE,
        });
        return this.financialService.generateReceivableFromQuotation(
          quotation,
          prisma,
          {
            only: hold.scope === 'DOWN_PAYMENT' ? 'DOWN_PAYMENT' : undefined,
            releasesQuotation: true,
          },
        );
      },
      { timeout: 20000 },
    );

    if (userId) {
      const userName = await this.resolveUserName(userId);
      await this.createQuotationHistoryEntry({
        quotationId,
        action: 'PENDING_PAYMENT',
        description: `${
          hold.reason === 'PREPAYMENT'
            ? 'Venda aprovada com pagamento antecipado'
            : 'Venda aprovada com entrada'
        } por ${userName || 'Usuário'}: aguarda o pagamento no financeiro para virar ordem de serviço`,
        metadata: { holdReason: hold.reason, holdAmount: hold.amount },
        createdBy: userId,
        createdByName: userName,
      });
    }

    return {
      pendingPayment: true,
      quotationId,
      holdReason: hold.reason,
      holdAmount: hold.amount,
      receivableId: receivable.id,
    };
  }

  /** As parcelas dos títulos "⚠️ Pendência" ativos da venda. */
  private async heldInstallments(quotationId: string) {
    return this.prisma.receivableInstallment.findMany({
      where: {
        status: { not: 'CANCELED' },
        receivable: {
          quotationId,
          releasesQuotation: true,
          status: { not: 'CANCELED' },
        },
      },
      select: {
        id: true,
        status: true,
        amount: true,
        additionalFee: true,
        paidAmount: true,
        dueDate: true,
        installmentNumber: true,
        receivableId: true,
      },
      orderBy: { dueDate: 'asc' },
    });
  }

  /**
   * A situação da pendência, para a faixa do orçamento e a aba Pendente. Se
   * o título já foi pago e a liberação não rodou (falha depois da baixa),
   * libera aqui.
   */
  async paymentHold(quotationId: string, userId?: string) {
    const quotation = await this.prisma.quotation.findUnique({
      where: { id: quotationId },
      select: {
        status: true,
        holdReason: true,
        holdAmount: true,
        holdAt: true,
        holdReleasedAt: true,
        holdReleaseNote: true,
        holdReleasedBy: true,
      },
    });
    if (!quotation) {
      throw new NotFoundException(
        `Orçamento com ID '${quotationId}' não encontrado.`,
      );
    }
    if (quotation.status === QuotationStatus.PENDING_PAYMENT) {
      const { released } = await this.releaseHold(quotationId, { userId });
      if (released) return this.paymentHold(quotationId);
    }
    const installments = quotation.holdReason
      ? await this.heldInstallments(quotationId)
      : [];
    const paid = installments
      .filter((item) => item.status === 'PAID')
      .reduce(
        (sum, item) =>
          sum + (item.paidAmount ?? item.amount + (item.additionalFee || 0)),
        0,
      );
    return {
      pending: quotation.status === QuotationStatus.PENDING_PAYMENT,
      reason: quotation.holdReason,
      amount: quotation.holdAmount,
      paid: Math.round(paid),
      since: quotation.holdAt,
      releasedAt: quotation.holdReleasedAt,
      releaseNote: quotation.holdReleaseNote,
      releasedBy: quotation.holdReleasedBy,
      receivableIds: [...new Set(installments.map((i) => i.receivableId))],
      installments,
    };
  }

  /**
   * Libera a venda pendente (PA-6 e PA-7): com os títulos "⚠️ Pendência"
   * pagos, ou sem o pagamento, com o motivo (no financeiro). A venda é
   * aprovada de fato: O.S., agenda, o resto do financeiro e a produção.
   */
  async releaseHold(
    quotationId: string,
    options: ReleaseOptions = {},
  ): Promise<{ released: boolean; orderId?: string }> {
    const manual = options.manualReason !== undefined;
    if (manual && !options.manualReason?.trim()) {
      throw new BadRequestException(HOLD_RELEASE_REASON_REQUIRED);
    }
    const current = await this.prisma.quotation.findUnique({
      where: { id: quotationId },
      select: { companyId: true, status: true, holdAmount: true },
    });
    if (!current) {
      throw new NotFoundException(
        `Orçamento com ID '${quotationId}' não encontrado.`,
      );
    }
    if (current.status !== QuotationStatus.PENDING_PAYMENT) {
      if (manual) throw new ConflictException(HOLD_NOT_PENDING);
      return { released: false };
    }
    // Libera quando entrou o valor exigido (o que passa do limite pode ser
    // parte do título à vista) ou quando os títulos estão todos pagos
    if (!manual) {
      const installments = await this.heldInstallments(quotationId);
      const allPaid =
        installments.length > 0 &&
        installments.every((item) => item.status === 'PAID');
      const paid = installments
        .filter((item) => item.status === 'PAID')
        .reduce(
          (sum, item) =>
            sum + (item.paidAmount ?? item.amount + (item.additionalFee || 0)),
          0,
        );
      const enough =
        (current.holdAmount ?? 0) > 0 &&
        Math.round(paid) >= (current.holdAmount ?? 0);
      if (!allPaid && !enough) return { released: false };
    }

    const startsInProduction = await this.startsInProduction(current.companyId);
    const userName = options.userId
      ? await this.resolveUserName(options.userId)
      : null;
    const order = await this.prisma.$transaction(
      async (prisma) => {
        const claimed = await prisma.quotation.updateMany({
          where: { id: quotationId, status: QuotationStatus.PENDING_PAYMENT },
          data: {
            status: QuotationStatus.APPROVED,
            approvedAt: new Date(),
            holdReleasedAt: new Date(),
            ...(manual
              ? {
                  holdReleaseNote: options.manualReason.trim(),
                  holdReleasedBy: userName || options.userId || null,
                }
              : {}),
          },
        });
        // Duas baixas ao mesmo tempo: a segunda encontra a venda liberada
        if (claimed.count === 0) return null;
        const quotation = await prisma.quotation.findUniqueOrThrow({
          where: { id: quotationId },
          include: APPROVAL_INCLUDE,
        });
        return this.completeApproval(quotation, startsInProduction, prisma);
      },
      { timeout: 20000 },
    );
    if (!order) return { released: false };

    for (const failure of await this.afterApproval(quotationId)) {
      this.logger.error(
        `${failure.step} não criado na liberação da venda ${quotationId} (o reprocesso refaz): ${failure.message}`,
      );
    }

    const description = manual
      ? `Venda liberada sem o pagamento antecipado por ${userName || 'Usuário'}: ${options.manualReason.trim()}`
      : `Pagamento antecipado recebido; venda aprovada`;
    await this.createQuotationHistoryEntry({
      quotationId,
      action: manual ? 'HOLD_RELEASED_MANUALLY' : 'HOLD_PAID',
      description,
      metadata: manual ? { reason: options.manualReason.trim() } : undefined,
      createdBy: options.userId,
      createdByName: userName,
    });
    await this.createOrderHistoryEntry({
      orderId: order.id,
      action: 'CREATED',
      description: manual
        ? 'Ordem de serviço criada na liberação sem o pagamento antecipado'
        : 'Ordem de serviço criada com o pagamento antecipado recebido',
      metadata: { quotationId },
      createdBy: options.userId,
      createdByName: userName,
    });
    return { released: true, orderId: order.id };
  }

  /**
   * Cancela os títulos "⚠️ Pendência" da venda que desiste ou volta para
   * digitação (PA-8). Com algo já recebido, recusa e diz o caminho.
   */
  /**
   * Desfaz a pendência (PA-8): cancela o título "⚠️ Pendência" se nada foi
   * recebido. Toma a venda numa transação, condicionada a PENDING_PAYMENT
   * (passa a OPEN; quem chama grava a situação final): se a liberação ou a
   * baixa ganhou antes, recusa em vez de cancelar o título de uma venda que
   * já virou O.S. (12/11/2026).
   */
  private async cancelHold(
    quotationId: string,
    reason: string,
    userId?: string,
  ): Promise<void> {
    const userName = userId ? await this.resolveUserName(userId) : null;
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.quotation.updateMany({
        where: { id: quotationId, status: QuotationStatus.PENDING_PAYMENT },
        data: { status: QuotationStatus.OPEN },
      });
      if (!claimed.count) {
        throw new ConflictException(
          'A venda mudou de situação (o pagamento pode ter acabado de entrar). Atualize a tela e confira antes de desistir.',
        );
      }
      const installments = await tx.receivableInstallment.findMany({
        where: {
          status: { not: 'CANCELED' },
          receivable: {
            quotationId,
            releasesQuotation: true,
            status: { not: 'CANCELED' },
          },
        },
        select: {
          status: true,
          amount: true,
          additionalFee: true,
          paidAmount: true,
          receivableId: true,
        },
      });
      const paid = installments
        .filter((item) => item.status === 'PAID')
        .reduce(
          (sum, item) =>
            sum + (item.paidAmount ?? item.amount + (item.additionalFee || 0)),
          0,
        );
      if (paid > 0) {
        throw new ConflictException(holdPaidMessage(Math.round(paid)));
      }
      const receivableIds = [
        ...new Set(installments.map((i) => i.receivableId)),
      ];
      if (!receivableIds.length) return;
      await tx.receivableInstallment.updateMany({
        where: { receivableId: { in: receivableIds }, status: { not: 'PAID' } },
        data: { status: 'CANCELED' },
      });
      // Uma baixa que entrou no meio aparece aqui: desfaz tudo
      const paidNow = await tx.receivableInstallment.count({
        where: { receivableId: { in: receivableIds }, status: 'PAID' },
      });
      if (paidNow) {
        throw new ConflictException(
          'Entrou um pagamento do título "⚠️ Pendência" agora. Atualize a tela e confira antes de desistir.',
        );
      }
      await tx.receivable.updateMany({
        where: { id: { in: receivableIds } },
        data: { status: 'CANCELED', cancelReason: reason },
      });
      if (userId) {
        await tx.receivableHistory.createMany({
          data: receivableIds.map((receivableId) => ({
            receivableId,
            action: 'CANCEL',
            description: reason,
            createdBy: userId,
            createdByName: userName,
          })),
        });
      }
    });
  }
}
