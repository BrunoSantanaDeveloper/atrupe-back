import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { CouponsService } from '../../coupons/coupons.service';
import { QuoteSubscriptionDto } from '../dto/quote-subscription.dto';
import {
  addCalendarCycle,
  computeEvolutionCredit,
  computePlanStates,
  computeQuote,
  PaidPeriod,
  PlanTrailItem,
  PricingCouponInput,
  PricingCycle,
  QuoteResult,
} from './pricing.engine';

export type ContractingIntent = 'NEW' | 'EVOLUTION' | 'REGULARIZATION';

export type QuoteIneligibility =
  | 'REGULARIZATION_REQUIRED'
  | 'NOT_RELEASED'
  | 'CURRENT_PLAN'
  | 'ALREADY_COMPLETED'
  | 'OUT_OF_SEQUENCE'
  | 'ANNUAL_TO_MONTHLY_NOT_ALLOWED';

export interface SubscriptionQuoteResponse {
  intent: ContractingIntent;
  eligible: boolean;
  ineligibilityReason?: QuoteIneligibility;
  plan: { id: string; name: string; planType: string };
  /** Ausente quando o plano ainda não foi liberado: o preço não é exibido. */
  quote: QuoteResult | null;
}

const PAID = ['CONFIRMED', 'RECEIVED'];

/**
 * Orçamento da contratação e estado da trilha de planos.
 *
 * Toda leitura do banco fica aqui; a aritmética e as regras ficam no motor
 * (pricing.engine.ts), que é puro. Nada aqui cria ou altera registro.
 */
@Injectable()
export class SubscriptionQuoteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly couponsService: CouponsService,
  ) {}

  /**
   * Qual contratação está em curso e se há cobrança em aberto.
   *
   * "Em curso" é a assinatura paga ativa ou, na falta dela, a contratação
   * ainda não paga (INACTIVE com cobrança pendente ou vencida). Assinaturas
   * canceladas, expiradas ou abandonadas não contam: quem não tem contratação
   * em curso começa pela entrada da trilha.
   */
  async getBillingContext(companyId: string, now: Date = new Date()) {
    const include = {
      plan: true,
      payments: { orderBy: { dueDate: 'desc' as const } },
    };

    const active = await this.prisma.subscription.findFirst({
      where: {
        companyId,
        status: 'ACTIVE',
        plan: { planType: { not: 'TRIAL' } },
      },
      orderBy: { createdAt: 'desc' },
      include,
    });

    const pendingCheckout = active
      ? null
      : await this.prisma.subscription.findFirst({
          where: {
            companyId,
            status: 'INACTIVE',
            plan: { planType: { not: 'TRIAL' } },
            payments: { some: { status: { in: ['PENDING', 'OVERDUE'] } } },
          },
          orderBy: { createdAt: 'desc' },
          include,
        });

    const current = active ?? pendingCheckout;
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const hasOverdue = !!current?.payments.some(
      (p) =>
        p.status === 'OVERDUE' ||
        (p.status === 'PENDING' && p.dueDate < startOfToday),
    );
    const confirmedPayment =
      current?.payments.find((p) => PAID.includes(p.status)) ?? null;

    // Contratação ainda não paga também é cobrança em aberto: o que resta a
    // fazer com ela é regularizar, não evoluir. São dois formatos: o legado,
    // em que a assinatura fica INACTIVE até o pagamento, e o atual, em que a
    // contratação registrada já libera o acesso (ACTIVE) com a primeira
    // cobrança ainda pendente.
    const firstChargePending =
      !!active &&
      !confirmedPayment &&
      active.payments.some((p) => p.status === 'PENDING');
    const hasOpenCharge = !!pendingCheckout || hasOverdue || firstChargePending;

    const intent: ContractingIntent = !current
      ? 'NEW'
      : hasOpenCharge
        ? 'REGULARIZATION'
        : 'EVOLUTION';

    return {
      current,
      hasOpenCharge,
      hasOverdue,
      firstChargePending,
      confirmedPayment,
      intent,
    };
  }

  private async globalPlans() {
    return this.prisma.plan.findMany({
      where: { companyId: null, planType: { not: 'TRIAL' } },
      orderBy: { order: 'asc' },
    });
  }

  /** A trilha de planos, com o estado de cada um para esta empresa. */
  async getPlanStates(companyId: string) {
    this.assertCompany(companyId);
    const [plans, ctx] = await Promise.all([
      this.globalPlans(),
      this.getBillingContext(companyId),
    ]);

    const items = computePlanStates({
      plans,
      currentPlanType: ctx.current?.plan.planType ?? null,
      hasOpenCharge: ctx.hasOpenCharge,
    });
    const byId = new Map(plans.map((p) => [p.id, p]));

    return {
      intent: ctx.intent,
      hasOpenCharge: ctx.hasOpenCharge,
      currentPlanId: ctx.current?.planId ?? null,
      currentCycle: ctx.current?.cycle ?? null,
      plans: items.map((item) => {
        const plan = byId.get(item.planId)!;
        return {
          ...item,
          name: plan.name,
          // Plano não liberado não mostra preço, como já é na tela pública.
          priceMonthlyCents: plan.isActive ? Math.round(plan.basePrice) : null,
        };
      }),
    };
  }

  /** O orçamento de uma contratação, sem efeito colateral. */
  async quote(
    companyId: string,
    dto: QuoteSubscriptionDto,
    now: Date = new Date(),
  ): Promise<SubscriptionQuoteResponse> {
    this.assertCompany(companyId);

    const plan = await this.prisma.plan.findFirst({
      where: {
        id: dto.planId,
        companyId: null,
        planType: { not: 'TRIAL' },
      },
    });
    if (!plan) {
      throw new BadRequestException('Plano não encontrado.');
    }

    const [plans, ctx] = await Promise.all([
      this.globalPlans(),
      this.getBillingContext(companyId, now),
    ]);
    const trail = computePlanStates({
      plans,
      currentPlanType: ctx.current?.plan.planType ?? null,
      hasOpenCharge: ctx.hasOpenCharge,
    });
    const state = trail.find((t) => t.planId === plan.id);
    const cycle: PricingCycle = dto.cycle ?? 'MONTHLY';

    const response = (
      eligible: boolean,
      quote: QuoteResult | null,
      ineligibilityReason?: QuoteIneligibility,
    ): SubscriptionQuoteResponse => ({
      intent: ctx.intent,
      eligible,
      ...(ineligibilityReason ? { ineligibilityReason } : {}),
      plan: { id: plan.id, name: plan.name, planType: plan.planType },
      quote,
    });

    // Plano não liberado: nem o preço é revelado.
    if (!plan.isActive) return response(false, null, 'NOT_RELEASED');

    const modules = await this.loadModules(dto.modules ?? [], plan.id);
    const { coupon, couponFailure } = await this.loadCoupon(
      dto.couponCode,
      companyId,
      plan.id,
    );

    const evolutionCredit =
      ctx.intent === 'EVOLUTION' && ctx.current
        ? computeEvolutionCredit({
            contractedAt: ctx.current.contractedAt,
            paidPeriods: this.paidPeriods(ctx.current),
            planName: ctx.current.plan.name,
            now,
          })
        : null;

    const quote = computeQuote({
      plan: {
        name: plan.name,
        basePriceCents: Math.round(plan.basePrice),
        additionalUserPriceCents: Math.round(plan.additionalUserPrice ?? 0),
      },
      modules,
      additionalUsers: dto.additionalUsers ?? 0,
      cycle,
      billingType: dto.billingType ?? null,
      installmentCount: dto.installmentCount ?? null,
      coupon,
      evolutionCredit,
    });
    if (couponFailure) quote.coupon = couponFailure;

    const reason = this.ineligibility(ctx, state, cycle);
    return response(!reason, quote, reason);
  }

  private ineligibility(
    ctx: Awaited<ReturnType<SubscriptionQuoteService['getBillingContext']>>,
    state: PlanTrailItem | undefined,
    cycle: PricingCycle,
  ): QuoteIneligibility | undefined {
    if (ctx.intent === 'REGULARIZATION') return 'REGULARIZATION_REQUIRED';
    switch (state?.state) {
      case 'ELEGIVEL':
        break;
      case 'ATUAL':
        return 'CURRENT_PLAN';
      case 'CONCLUIDO':
        return 'ALREADY_COMPLETED';
      case 'EM_BREVE':
        return 'NOT_RELEASED';
      default:
        return 'OUT_OF_SEQUENCE';
    }
    // Sair do anual para o mensal jogaria fora quase um ano pago: o crédito
    // não cabe numa fatura mensal e o excedente não vira saldo.
    if (
      ctx.intent === 'EVOLUTION' &&
      ctx.current?.cycle === 'YEARLY' &&
      cycle === 'MONTHLY'
    ) {
      return 'ANNUAL_TO_MONTHLY_NOT_ALLOWED';
    }
    return undefined;
  }

  private async loadModules(keys: string[], planId: string) {
    if (keys.length === 0) return [];
    const unique = [...new Set(keys)];
    const features = await this.prisma.feature.findMany({
      where: { key: { in: unique }, isActive: true, price: { gt: 0 } },
      include: { planFeatures: { where: { planId }, select: { id: true } } },
    });
    const missing = unique.filter((k) => !features.some((f) => f.key === k));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Módulo indisponível para contratação: ${missing.join(', ')}.`,
      );
    }
    // Módulo que o plano já inclui não é cobrado à parte — na evolução, o
    // complemento pago no plano anterior pode vir incluído no seguinte.
    return features
      .filter((f) => !f.planFeatures?.length)
      .map((f) => ({
        key: f.key,
        name: f.name,
        priceCents: Math.round(f.price),
      }));
  }

  /**
   * Validação do cupom (existência, vigência, limite de usos, planos em que
   * vale). Um cupom recusado não derruba o orçamento: ele volta sem o
   * desconto e com o motivo, para a tela mostrar ao lado do campo.
   */
  private async loadCoupon(
    code: string | undefined,
    companyId: string,
    planId: string,
  ): Promise<{
    coupon: PricingCouponInput | null;
    couponFailure: QuoteResult['coupon'];
  }> {
    const normalized = code?.trim().toUpperCase();
    if (!normalized) return { coupon: null, couponFailure: null };
    try {
      const c = await this.couponsService.validateCoupon(
        normalized,
        companyId,
        planId,
        false,
      );
      return {
        coupon: {
          code: c.code,
          discountType: c.discountType as 'PERCENT' | 'VALUE',
          discountValue: c.discountValue,
          minPlanValueCents:
            c.minPlanValue != null ? Math.round(c.minPlanValue) : null,
        },
        couponFailure: null,
      };
    } catch (error) {
      return {
        coupon: null,
        couponFailure: {
          code: normalized,
          applied: false,
          reason: 'INVALID',
          message: error?.message ?? 'Cupom inválido ou expirado.',
        },
      };
    }
  }

  /**
   * O período que cada cobrança paga cobre. As cobranças da contratação e da
   * evolução gravam o período; a renovação cobre um ciclo a partir do
   * vencimento. O valor é o de antes de algum crédito anterior (reais →
   * centavos): o crédito que pagou um ciclo continua valendo na evolução
   * seguinte.
   */
  private paidPeriods(subscription: {
    cycle: string | null;
    payments: {
      status: string;
      value: number;
      grossValue: number | null;
      dueDate: Date;
      periodStart?: Date | null;
      periodEnd?: Date | null;
    }[];
  }): PaidPeriod[] {
    const cycle = this.pricingCycleOf(subscription.cycle);
    return subscription.payments
      .filter((p) => PAID.includes(p.status))
      .map((p) => ({
        grossCents: Math.max(0, Math.round((p.grossValue ?? p.value) * 100)),
        start: p.periodStart ?? p.dueDate,
        end: p.periodEnd ?? addCalendarCycle(p.dueDate, cycle),
      }));
  }

  private pricingCycleOf(cycle: string | null): PricingCycle {
    return cycle === 'YEARLY' ? 'YEARLY' : 'MONTHLY';
  }

  private assertCompany(companyId: string | undefined) {
    if (!companyId) {
      throw new BadRequestException(
        'Orçamento disponível apenas para usuários de uma empresa.',
      );
    }
  }
}
