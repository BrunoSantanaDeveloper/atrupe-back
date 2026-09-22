/**
 * Motor de preço da contratação.
 *
 * É a ÚNICA fonte do valor cobrado: o orçamento exibido na tela (quote), a
 * contratação e, nas fases seguintes, a evolução e a renovação leem daqui.
 * Antes, a mesma aritmética existia em cinco lugares do SubscriptionsService e
 * mais um no webhook, cada um com uma regra ligeiramente diferente.
 *
 * Funções puras, sem banco e sem relógio implícito, e tudo em CENTAVOS
 * inteiros: é assim que o preço fica igual no servidor, na tela e nos testes.
 *
 * As regras vêm do protótipo (prototype/packages/dominio/src/precos.ts e
 * planos.ts), com as decisões de produto tomadas na adaptação:
 * - cupom abate só a primeira cobrança, nunca a renovação;
 * - cupom de valor fixo no ciclo anual abate doze vezes;
 * - evolução a partir de ciclo anual só para outro anual (regra do serviço);
 * - assinatura sem data de contratação não gera crédito;
 * - complemento incluído depois da contratação entra na próxima mensalidade,
 *   sem cobrança proporcional.
 */

/** O anual cobra 11 mensalidades: "pague 11 meses, ganhe 1 grátis". */
export const ANNUAL_BILLED_MONTHS = 11;
export const CARD_MAX_INSTALLMENTS = 12;
export const MAX_ADDITIONAL_USERS = 20;
/**
 * Menor parcela que se oferece. O Asaas recusa cobrança abaixo de um valor
 * mínimo; R$ 5,00 é o valor documentado e precisa ser confirmado no sandbox.
 * Com os preços atuais nunca entra em jogo (o menor anual em 12x passa de
 * R$ 100), mas impede oferecer uma parcela que o gateway não emitiria.
 */
export const MIN_INSTALLMENT_CENTS = 500;

/** Ordem de evolução do Método Atrupe: sempre para o próximo, sem pular etapa. */
export const PLAN_SEQUENCE = ['START', 'LITE', 'PRO', 'ELITE', 'FULL'] as const;
export type SequencePlanType = (typeof PLAN_SEQUENCE)[number];

export type PricingCycle = 'MONTHLY' | 'YEARLY';

export interface PricingPlanInput {
  name: string;
  basePriceCents: number;
  additionalUserPriceCents: number;
}

export interface PricingModuleInput {
  key: string;
  name: string;
  priceCents: number;
}

export interface PricingCouponInput {
  code: string;
  discountType: 'PERCENT' | 'VALUE';
  /** Percentual (0–100) no PERCENT; centavos no VALUE. */
  discountValue: number;
  minPlanValueCents?: number | null;
}

export interface EvolutionCredit {
  creditCents: number;
  remainingDays: number;
  totalDays: number;
  planName: string;
}

export interface QuoteInput {
  plan: PricingPlanInput;
  modules?: PricingModuleInput[];
  additionalUsers?: number;
  cycle: PricingCycle;
  billingType?: string | null;
  installmentCount?: number | null;
  coupon?: PricingCouponInput | null;
  evolutionCredit?: EvolutionCredit | null;
}

export interface QuoteLine {
  kind: 'PLAN' | 'MODULE' | 'ADDITIONAL_USERS';
  label: string;
  quantity?: number;
  /** Sempre o valor mensal: é assim que a tela mostra cada linha. */
  monthlyCents: number;
}

export interface QuoteDiscount {
  kind: 'FREE_MONTH' | 'COUPON' | 'EVOLUTION_CREDIT';
  label: string;
  amountCents: number;
}

export interface CouponOutcome {
  code: string;
  applied: boolean;
  /**
   * MIN_VALUE é decidido aqui; INVALID vem da validação do cupom (existência,
   * validade, limite de usos), que depende do banco e fica no serviço.
   */
  reason?: 'MIN_VALUE' | 'INVALID';
  minPlanValueCents?: number;
  message?: string;
}

export interface InstallmentOption {
  count: number;
  /** Valor exibido de cada parcela. */
  amountCents: number;
  /** A última absorve o arredondamento, para a soma bater com o total. */
  lastAmountCents: number;
}

export interface QuoteResult {
  cycle: PricingCycle;
  lines: QuoteLine[];
  grossMonthlyCents: number;
  subtotalCents: number;
  freeMonthCents: number;
  couponDiscountCents: number;
  creditCents: number;
  discounts: QuoteDiscount[];
  /** O que se paga agora, na primeira cobrança. */
  totalCents: number;
  /** A renovação: o ciclo cheio, sem cupom e sem crédito. */
  recurringCents: number;
  totalSuffix: '/mês' | '/ano';
  coupon: CouponOutcome | null;
  installments: {
    allowed: boolean;
    max: number;
    selected: number;
    options: InstallmentOption[];
  };
}

function assertCents(value: number, name: string) {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(
      `${name} precisa ser um inteiro não negativo em centavos`,
    );
  }
}

/**
 * Soma um ciclo de calendário a uma data, em UTC. Um mês a partir de 31/01 é
 * 28/02 (ou 29/02): o dia é limitado ao último do mês de destino, em vez de
 * transbordar para março como faria o Date puro.
 */
export function addCalendarCycle(date: Date, cycle: PricingCycle): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + (cycle === 'YEARLY' ? 12 : 1));
  const lastDayOfTargetMonth = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDayOfTargetMonth));
  return result;
}

/**
 * Opções de parcelamento de um total. Parcela pelo valor, não pelo número: é
 * por ele que a pessoa decide em quantas vezes cabe. A última parcela absorve
 * a diferença do arredondamento — a divisão real do Asaas precisa ser
 * confirmada no sandbox antes de o ciclo anual entrar em produção.
 */
export function installmentOptions(
  totalCents: number,
  max: number = CARD_MAX_INSTALLMENTS,
): InstallmentOption[] {
  assertCents(totalCents, 'totalCents');
  const options: InstallmentOption[] = [];
  for (let count = 1; count <= max; count++) {
    const amountCents = Math.round(totalCents / count);
    const lastAmountCents = totalCents - amountCents * (count - 1);
    if (
      count > 1 &&
      Math.min(amountCents, lastAmountCents) < MIN_INSTALLMENT_CENTS
    ) {
      break;
    }
    options.push({ count, amountCents, lastAmountCents });
  }
  return options;
}

/** O período que uma cobrança paga cobre, e quanto foi pago por ele. */
export interface PaidPeriod {
  /** O valor do período antes de algum crédito anterior, em centavos. */
  grossCents: number;
  start: Date;
  end: Date;
}

const DAY_MS = 86_400_000;

/**
 * Crédito do tempo não usado do que já foi pago, para abater da primeira
 * cobrança de uma evolução.
 *
 * A base é o PERÍODO que cada cobrança paga cobre, medido pelo calendário
 * real — não a data de contratação. Numa assinatura mensal, o ciclo em curso é
 * o da última renovação paga: medir a partir da contratação zerava o crédito a
 * partir do segundo mês. Uma renovação paga adiantada, com o período ainda por
 * começar, é creditada inteira.
 *
 * Só entram aqui cobranças pagas: creditar um ciclo que não foi pago seria dar
 * desconto por uma cobrança que falhou. E não há crédito sem data de
 * contratação — as assinaturas antigas, por decisão de produto.
 */
export function computeEvolutionCredit(input: {
  contractedAt: Date | null | undefined;
  paidPeriods: PaidPeriod[];
  planName: string;
  now: Date;
}): EvolutionCredit | null {
  if (!input.contractedAt) return null;
  const now = input.now.getTime();

  let creditCents = 0;
  let firstStart = Infinity;
  let lastEnd = -Infinity;
  for (const period of input.paidPeriods) {
    assertCents(period.grossCents, 'grossCents');
    const start = new Date(period.start).getTime();
    const end = new Date(period.end).getTime();
    if (Number.isNaN(start) || Number.isNaN(end)) continue;

    const periodDays = Math.round((end - start) / DAY_MS);
    // Fração de dia conta como dia inteiro: quem contratou hoje à tarde ainda
    // tem o dia de hoje.
    const unusedDays = Math.min(
      periodDays,
      Math.max(0, Math.ceil((end - Math.max(now, start)) / DAY_MS)),
    );
    if (periodDays <= 0 || unusedDays <= 0) continue;

    creditCents += Math.round((period.grossCents * unusedDays) / periodDays);
    firstStart = Math.min(firstStart, start);
    lastEnd = Math.max(lastEnd, end);
  }
  if (creditCents <= 0) return null;

  return {
    creditCents,
    remainingDays: Math.ceil((lastEnd - now) / DAY_MS),
    totalDays: Math.round((lastEnd - firstStart) / DAY_MS),
    planName: input.planName,
  };
}

export interface ComplementsChangeInput {
  /** O valor da renovação hoje, como está no gateway. */
  currentRecurringCents: number;
  cycle: PricingCycle;
  additionalUserPriceCents: number;
  currentAdditionalUsers: number;
  targetAdditionalUsers: number;
  addedModules?: PricingModuleInput[];
  removedModules?: PricingModuleInput[];
}

export interface ComplementsChange {
  /** O que entra, com o valor mensal de cada item. */
  lines: QuoteLine[];
  deltaMonthlyCents: number;
  /** Diferença por ciclo de cobrança: é o que muda na renovação. */
  deltaCycleCents: number;
  currentRecurringCents: number;
  recurringCents: number;
  /** Nada é cobrado na hora: o complemento entra na próxima mensalidade. */
  chargedNowCents: 0;
}

/**
 * Inclusão (ou retirada) de complementos numa assinatura em curso.
 *
 * Decisão de produto: o complemento é liberado na hora e passa a ser cobrado
 * a partir da próxima mensalidade — sem cobrança proporcional e sem cupom,
 * porque não há cobrança agora para o cupom abater.
 *
 * A base é a renovação ATUAL, não o preço de tabela do plano: incluir um
 * módulo não pode reprecificar o plano nem apagar um desconto que a
 * assinatura já tem.
 */
export function computeComplementsChange(
  input: ComplementsChangeInput,
): ComplementsChange {
  const added = input.addedModules ?? [];
  const removed = input.removedModules ?? [];
  assertCents(input.currentRecurringCents, 'currentRecurringCents');
  assertCents(input.additionalUserPriceCents, 'additionalUserPriceCents');
  [...added, ...removed].forEach((m) =>
    assertCents(m.priceCents, `módulo ${m.key}`),
  );
  // O teto de usuários vale para o pedido (validado na entrada); uma
  // assinatura antiga pode já ter passado dele.
  for (const [name, users] of [
    ['currentAdditionalUsers', input.currentAdditionalUsers],
    ['targetAdditionalUsers', input.targetAdditionalUsers],
  ] as const) {
    if (!Number.isInteger(users) || users < 0) {
      throw new RangeError(`${name} precisa ser um inteiro não negativo`);
    }
  }

  const usersDelta = input.targetAdditionalUsers - input.currentAdditionalUsers;
  const lines: QuoteLine[] = added.map((m) => ({
    kind: 'MODULE',
    label: m.name,
    monthlyCents: m.priceCents,
  }));
  if (usersDelta > 0) {
    lines.push({
      kind: 'ADDITIONAL_USERS',
      label: 'Usuários adicionais',
      quantity: usersDelta,
      monthlyCents: usersDelta * input.additionalUserPriceCents,
    });
  }

  const deltaMonthlyCents =
    added.reduce((sum, m) => sum + m.priceCents, 0) -
    removed.reduce((sum, m) => sum + m.priceCents, 0) +
    usersDelta * input.additionalUserPriceCents;
  const deltaCycleCents =
    deltaMonthlyCents * (input.cycle === 'YEARLY' ? ANNUAL_BILLED_MONTHS : 1);
  const recurringCents = input.currentRecurringCents + deltaCycleCents;
  if (recurringCents < 0) {
    throw new RangeError('A renovação não pode ficar negativa');
  }

  return {
    lines,
    deltaMonthlyCents,
    deltaCycleCents,
    currentRecurringCents: input.currentRecurringCents,
    recurringCents,
    chargedNowCents: 0,
  };
}

/**
 * O orçamento da contratação. A ordem da aritmética é a do protótipo e não
 * deve ser invertida: bruto mensal → ciclo → mês grátis → cupom sobre o que
 * sobrou → crédito por último, limitado ao valor devido.
 */
export function computeQuote(input: QuoteInput): QuoteResult {
  const { plan, cycle } = input;
  const modules = input.modules ?? [];
  const additionalUsers = input.additionalUsers ?? 0;

  assertCents(plan.basePriceCents, 'basePriceCents');
  assertCents(plan.additionalUserPriceCents, 'additionalUserPriceCents');
  modules.forEach((m) => assertCents(m.priceCents, `módulo ${m.key}`));
  if (
    !Number.isInteger(additionalUsers) ||
    additionalUsers < 0 ||
    additionalUsers > MAX_ADDITIONAL_USERS
  ) {
    throw new RangeError(
      `additionalUsers precisa ser um inteiro entre 0 e ${MAX_ADDITIONAL_USERS}`,
    );
  }

  const lines: QuoteLine[] = [
    { kind: 'PLAN', label: plan.name, monthlyCents: plan.basePriceCents },
    ...modules.map<QuoteLine>((m) => ({
      kind: 'MODULE',
      label: m.name,
      monthlyCents: m.priceCents,
    })),
  ];
  if (additionalUsers > 0) {
    lines.push({
      kind: 'ADDITIONAL_USERS',
      label: 'Usuários adicionais',
      quantity: additionalUsers,
      monthlyCents: additionalUsers * plan.additionalUserPriceCents,
    });
  }

  const grossMonthlyCents = lines.reduce((sum, l) => sum + l.monthlyCents, 0);
  const isYearly = cycle === 'YEARLY';
  const subtotalCents = grossMonthlyCents * (isYearly ? 12 : 1);
  const freeMonthCents = isYearly ? grossMonthlyCents : 0;
  const afterFreeMonth = subtotalCents - freeMonthCents;

  const discounts: QuoteDiscount[] = [];
  if (freeMonthCents > 0) {
    discounts.push({
      kind: 'FREE_MONTH',
      label: '1 mês grátis (pagamento anual)',
      amountCents: freeMonthCents,
    });
  }

  // Cupom: só a primeira cobrança. O valor mínimo é comparado com a
  // mensalidade bruta, como já era.
  let couponDiscountCents = 0;
  let coupon: CouponOutcome | null = null;
  if (input.coupon) {
    const c = input.coupon;
    if (c.minPlanValueCents && grossMonthlyCents < c.minPlanValueCents) {
      coupon = {
        code: c.code,
        applied: false,
        reason: 'MIN_VALUE',
        minPlanValueCents: c.minPlanValueCents,
      };
    } else {
      const raw =
        c.discountType === 'PERCENT'
          ? Math.round((afterFreeMonth * c.discountValue) / 100)
          : // Valor fixo no anual abate doze vezes (decisão de produto).
            Math.round(c.discountValue) * (isYearly ? 12 : 1);
      couponDiscountCents = Math.min(Math.max(0, raw), afterFreeMonth);
      coupon = { code: c.code, applied: true };
      if (couponDiscountCents > 0) {
        discounts.push({
          kind: 'COUPON',
          label:
            c.discountType === 'PERCENT'
              ? `Cupom ${c.code} (-${c.discountValue}%)`
              : `Cupom ${c.code}`,
          amountCents: couponDiscountCents,
        });
      }
    }
  }

  const dueBeforeCredit = afterFreeMonth - couponDiscountCents;
  // O crédito entra por último e nunca deixa o total negativo: a evolução
  // pode zerar a fatura, e o excedente não vira saldo.
  const creditCents = input.evolutionCredit
    ? Math.min(Math.max(0, input.evolutionCredit.creditCents), dueBeforeCredit)
    : 0;
  if (creditCents > 0 && input.evolutionCredit) {
    discounts.push({
      kind: 'EVOLUTION_CREDIT',
      label: `Crédito do ${input.evolutionCredit.planName} (${input.evolutionCredit.remainingDays} dias restantes)`,
      amountCents: creditCents,
    });
  }

  const totalCents = dueBeforeCredit - creditCents;

  // Parcelamento só no anual, no cartão, e com algo a pagar.
  const allowed =
    isYearly && input.billingType === 'CREDIT_CARD' && totalCents > 0;
  const options = allowed ? installmentOptions(totalCents) : [];
  const requested = input.installmentCount ?? 1;
  const selected = options.some((o) => o.count === requested) ? requested : 1;

  return {
    cycle,
    lines,
    grossMonthlyCents,
    subtotalCents,
    freeMonthCents,
    couponDiscountCents,
    creditCents,
    discounts,
    totalCents,
    recurringCents: afterFreeMonth,
    totalSuffix: isYearly ? '/ano' : '/mês',
    coupon,
    installments: {
      allowed,
      max: options.length,
      selected,
      options,
    },
  };
}

export type PlanTrailState =
  | 'CONCLUIDO'
  | 'ATUAL'
  | 'ELEGIVEL'
  | 'BLOQUEADO'
  | 'EM_BREVE';

export type PlanTrailReason = 'SEQUENCE' | 'OPEN_CHARGE' | 'NOT_RELEASED';

export interface PlanTrailItem {
  planId: string;
  planType: SequencePlanType;
  state: PlanTrailState;
  reason?: PlanTrailReason;
}

/**
 * Estado de cada plano da trilha. A sequência vem do protótipo; a
 * disponibilidade vem da produção (`Plan.isActive`, que o admin do sistema
 * liga no painel de planos).
 *
 * Sem contratação, só o START é oferecido. Com contratação, só o próximo da
 * sequência — e só se já tiver sido liberado: o próximo ainda não liberado
 * aparece "em breve", não como contratável. Com cobrança em aberto, nada é
 * oferecido: a única tarefa é regularizar o que já foi contratado.
 */
export function computePlanStates(input: {
  plans: { id: string; planType: string; isActive: boolean }[];
  currentPlanType: string | null;
  hasOpenCharge: boolean;
}): PlanTrailItem[] {
  const indexOf = (planType: string) =>
    PLAN_SEQUENCE.indexOf(planType as SequencePlanType);
  const currentIndex = input.currentPlanType
    ? indexOf(input.currentPlanType)
    : -1;
  const targetIndex = currentIndex < 0 ? 0 : currentIndex + 1;

  return input.plans
    .filter((p) => indexOf(p.planType) >= 0)
    .sort((a, b) => indexOf(a.planType) - indexOf(b.planType))
    .map<PlanTrailItem>((p) => {
      const index = indexOf(p.planType);
      const base = { planId: p.id, planType: p.planType as SequencePlanType };
      if (currentIndex >= 0 && index < currentIndex) {
        return { ...base, state: 'CONCLUIDO' };
      }
      if (index === currentIndex) return { ...base, state: 'ATUAL' };
      if (index === targetIndex) {
        if (input.hasOpenCharge) {
          return { ...base, state: 'BLOQUEADO', reason: 'OPEN_CHARGE' };
        }
        if (!p.isActive) {
          return { ...base, state: 'EM_BREVE', reason: 'NOT_RELEASED' };
        }
        return { ...base, state: 'ELEGIVEL' };
      }
      return { ...base, state: 'BLOQUEADO', reason: 'SEQUENCE' };
    });
}
