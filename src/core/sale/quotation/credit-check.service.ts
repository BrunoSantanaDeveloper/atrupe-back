import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ClientKind, Prisma } from '@prisma/client';
import { PrismaService } from 'nestjs-prisma';
import { isObservingNow } from '../../plan/decorators/observe-feature.decorator';
import { PlanControlService } from '../../plan/plan-control.service';

/**
 * A data (AAAA-MM-DD) em que a aprovação passa a ser recusada pelo crédito.
 * Volta em 12/11/2026 (decisão do Bruno): o limite é do LITE para cima, e o
 * padrão da empresa dá R$ 2.000/5.000 a todo cliente; travar sem a data
 * reteria vendas de quem nunca definiu limite. O pagamento antecipado
 * marcado no cliente vale sempre.
 */
export const CREDIT_ENFORCE_ENV = 'CREDIT_LIMIT_ENFORCE_FROM';

/** Cartão: o cliente pagou no ato; as parcelas são da operadora. */
const CARD_METHODS = ['CRD', 'DEB'];

export const CLIENT_BLOCKED_MESSAGE =
  'Este cliente está bloqueado no cadastro.';
export const CREDIT_APPROVAL_HINT =
  'Quem pode alterar o limite ou desbloquear o cliente faz isso no cadastro do cliente.';

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});
export const brl = (cents: number) => BRL.format(cents / 100);

/**
 * O limite estourado diz o caminho (PA-2, 12/11/2026): quanto passa, a
 * entrada sugerida e com quem falar para mudar o limite.
 */
export const creditExceededMessage = (values: {
  limit: number;
  used: number;
  excess: number;
  suggestedDownPayment: number;
  /** A entrada é toda a parte a prazo: não é entrada, é pagamento integral */
  fullPayment?: boolean;
}) => {
  const over = `Esta venda passa ${brl(values.excess)} do limite de crédito do cliente (limite de ${brl(values.limit)}${
    values.used > 0 ? `, com ${brl(values.used)} já em aberto` : ''
  }).`;
  // Lista Lite 19/11, item 3: quando a "entrada" seria a venda inteira, o
  // texto diz pagamento integral à vista, e que ele precisa ser recebido
  if (values.fullPayment) {
    return [
      over,
      `Para concluir esta venda, será necessário o pagamento integral de ${brl(values.suggestedDownPayment)} à vista, recebido antes da liberação.`,
      'Você pode encaminhar a venda para a confirmação do pagamento ou pedir ao financeiro uma revisão do limite de crédito.',
    ].join(' ');
  }
  return [
    over,
    `Sugestão: uma entrada de ${brl(values.suggestedDownPayment)}, que precisa ser paga para liberar a venda.`,
    'Para mudar o limite, fale com o financeiro.',
  ].join(' ');
};
/** O mesmo caminho, sem os números, para quem não vê valores. */
export const CREDIT_EXCEEDED_NO_VALUES =
  'Esta venda passa do limite de crédito do cliente. Uma entrada, paga antes, libera a venda. Para mudar o limite, fale com o financeiro.';

/**
 * A conferência sem os números do crédito, para quem não tem
 * values:values:view: o @MoneyFields tira os campos, e aqui sai o texto do
 * limite, que leva R$ (12/11/2026).
 */
export function creditWithoutValues<T extends { issues?: unknown[] }>(
  credit: T,
): T {
  if (!credit?.issues) return credit;
  return {
    ...credit,
    issues: credit.issues.map((issue: any) =>
      issue?.code === 'CREDIT_LIMIT_EXCEEDED'
        ? { ...issue, message: CREDIT_EXCEEDED_NO_VALUES }
        : issue,
    ),
  };
}

/** O corpo do 409 do crédito sem os números, para quem não vê valores. */
export function creditRefusalWithoutValues(body: {
  message?: string;
  issues?: { code: string }[];
}) {
  const issues = (body.issues ?? []).map((issue) =>
    issue.code === 'CREDIT_LIMIT_EXCEEDED' ? { code: issue.code } : issue,
  );
  const hasLimit = issues.some(
    (issue) => issue.code === 'CREDIT_LIMIT_EXCEEDED',
  );
  return {
    ...body,
    issues,
    ...(hasLimit
      ? {
          message: (body.message ?? '').replace(
            /Esta venda passa .*?Para mudar o limite, fale com o financeiro\./,
            CREDIT_EXCEEDED_NO_VALUES,
          ),
        }
      : {}),
  };
}

export const conditionNotAllowedMessage = (names: string[]) =>
  names.length === 1
    ? `A condição ${names[0]} não está entre as permitidas para este cliente.`
    : `As condições ${names.join(', ')} não estão entre as permitidas para este cliente.`;

export type CreditIssue =
  | { code: 'CLIENT_BLOCKED'; message: string }
  | {
      code: 'CONDITION_NOT_ALLOWED';
      message: string;
      conditions: { id: string; name: string }[];
    }
  | {
      code: 'CREDIT_LIMIT_EXCEEDED';
      message: string;
      /** Quanto a venda passa do limite (centavos) */
      excess: number;
      /** A entrada que resolve: a diferença, até o que a venda tem a prazo */
      suggestedDownPayment: number;
      /** A entrada cobre toda a parte a prazo: é pagamento integral */
      fullPayment: boolean;
    };

/**
 * O que a aprovação faz quando o pagamento precisa entrar antes (PA, 12/11):
 * a venda fica pendente até o valor exigido (centavos) ser pago.
 */
export type PaymentHold = {
  reason: 'PREPAYMENT' | 'CREDIT_LIMIT';
  amount: number;
  /**
   * Os títulos que nascem na pendência: só a entrada, ou a venda inteira
   * (pagamento antecipado, ou a parcela à vista da condição)
   */
  scope: 'DOWN_PAYMENT' | 'ALL';
} | null;

/** A situação de crédito do cliente, sem venda nenhuma. */
export type ClientCredit = {
  /** O plano confere o crédito (`credit_limit_enforcement`). */
  applies: boolean;
  /** A aprovação já é recusada (a data de CREDIT_LIMIT_ENFORCE_FROM chegou). */
  enforcing: boolean;
  blockClient: boolean;
  /** "Exigir pagamento antecipado" no cadastro (PA-1) */
  requirePrepayment: boolean;
  /** Centavos; null sem limite cadastrado (não confere). */
  limit: number | null;
  /** Parcelas em aberto no financeiro (fora as de cartão). */
  openBalance: number;
  /** Vendas aprovadas que ainda não geraram título. */
  pendingApproved: number;
  /** openBalance + pendingApproved. */
  used: number;
  available: number | null;
  /** null: qualquer condição. */
  allowedConditionIds: string[] | null;
};

/** A conferência de um orçamento: a do cliente mais esta venda. */
export type QuotationCredit = ClientCredit & {
  /** O que desta venda é crédito. */
  requested: number;
  issues: CreditIssue[];
  /** A aprovação, se feita agora, deixa a venda pendente deste valor (PA) */
  hold: PaymentHold;
};

type Parcel = {
  value: number;
  dueDate: Date | null;
  methodCode: string | null;
  /** A entrada ou uma parcela da condição (a pendência sabe qual título nasce) */
  kind?: 'DOWN' | 'MAIN';
};

const SAO_PAULO_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
});

/**
 * O que da venda é crédito: a parcela que vence depois do dia de referência
 * (a aprovação). A que vence no dia é paga no ato, e cartão é da operadora:
 * nenhuma das duas conta (decisão do PO, 14/10/2026).
 */
export function creditPartOf(parcels: Parcel[], reference: Date): number {
  const day = SAO_PAULO_DAY.format(reference);
  const total = parcels
    .filter(
      (parcel) =>
        !CARD_METHODS.includes(parcel.methodCode ?? '') &&
        !!parcel.dueDate &&
        SAO_PAULO_DAY.format(parcel.dueDate) > day,
    )
    .reduce((sum, parcel) => sum + (parcel.value || 0), 0);
  return Math.round(total);
}

/**
 * O pagamento que precisa entrar antes de a venda virar O.S. (PA, 12/11):
 * - "Exigir pagamento antecipado" no cliente: o total da venda, sempre,
 *   mesmo pago no Pix na hora (a aprovação com pendência gera o título);
 * - o que passa do limite: o que vence no dia da aprovação (a entrada ou a
 *   venda à vista, fora cartão) só é pago no ato se for pago de fato. Se,
 *   contado como crédito, faz a venda passar do limite, o que passa precisa
 *   entrar antes de liberar (Maicol, 12/11/2026: "a venda inteira no Pix à
 *   vista deve ter pagamento adiantado do valor que excede o limite").
 *   O que vence depois e já passa do limite é recusado (409) antes daqui.
 */
export function holdOf(
  credit: Pick<ClientCredit, 'requirePrepayment' | 'limit' | 'used'>,
  requested: number,
  parcels: Parcel[],
  payment: { finalValue?: number | null } | null,
  reference: Date,
): PaymentHold {
  if (!payment) return null;
  if (credit.requirePrepayment) {
    const total = parcels.reduce((sum, parcel) => sum + parcel.value, 0);
    const amount = Math.round(total || payment.finalValue || 0);
    return amount > 0 ? { reason: 'PREPAYMENT', amount, scope: 'ALL' } : null;
  }
  if (credit.limit === null) return null;
  const day = SAO_PAULO_DAY.format(reference);
  const upfront = parcels.filter(
    (parcel) =>
      !CARD_METHODS.includes(parcel.methodCode ?? '') &&
      (!parcel.dueDate || SAO_PAULO_DAY.format(parcel.dueDate) <= day),
  );
  const upfrontTotal = Math.round(
    upfront.reduce((sum, parcel) => sum + parcel.value, 0),
  );
  if (upfrontTotal <= 0) return null;
  const excess = credit.used + requested + upfrontTotal - credit.limit;
  if (excess <= 0) return null;
  return {
    reason: 'CREDIT_LIMIT',
    amount: Math.min(Math.round(excess), upfrontTotal),
    scope: upfront.some((parcel) => parcel.kind === 'MAIN')
      ? 'ALL'
      : 'DOWN_PAYMENT',
  };
}

const METHOD_CODE = {
  select: { paymentMethod: { select: { code: true } } },
} as const;

/** As parcelas do orçamento: a entrada e as da condição. */
const PARCELS_SELECT = Prisma.validator<Prisma.QuotationPaymentSelect>()({
  downPayment: true,
  downPaymentAdditionalFee: true,
  downPaymentDueDate: true,
  downPaymentCondition: METHOD_CODE,
  quotationInstallment: {
    select: {
      value: true,
      additionalFee: true,
      dueDate: true,
      paymentConditionId: true,
      paymentCondition: METHOD_CODE,
    },
  },
});

type PaymentParcels = Prisma.QuotationPaymentGetPayload<{
  select: typeof PARCELS_SELECT;
}>;

function parcelsOf(payment: PaymentParcels | null): Parcel[] {
  if (!payment) return [];
  const parcels: Parcel[] = payment.quotationInstallment.map((item) => ({
    value: item.value + (item.additionalFee || 0),
    dueDate: item.dueDate,
    methodCode: item.paymentCondition?.paymentMethod?.code ?? null,
    kind: 'MAIN' as const,
  }));
  if (payment.downPayment > 0) {
    parcels.push({
      value: payment.downPayment + (payment.downPaymentAdditionalFee || 0),
      dueDate: payment.downPaymentDueDate,
      methodCode: payment.downPaymentCondition?.paymentMethod?.code ?? null,
      kind: 'DOWN',
    });
  }
  return parcels;
}

/**
 * Limite de crédito na venda (decisões do PO de 13 e 14/10/2026):
 * - conta como usado todo o saldo em aberto do cliente no financeiro e as
 *   vendas aprovadas que ainda não geraram título; a venda paga no ato não;
 * - o limite é o do cliente ou, sem ele, o padrão da empresa para o tipo de
 *   cliente; sem nenhum, não confere;
 * - cliente bloqueado e condição fora das permitidas também recusam;
 * - concluir só avisa; a aprovação recusa, e ninguém aprova acima do limite.
 *
 * A recusa vale sempre (11/11/2026). Antes havia um período de observação
 * (CREDIT_LIMIT_ENFORCE_FROM) para não travar quem nunca definiu limite; o
 * limite de crédito é do LITE, e nenhuma empresa usa o LITE ainda.
 */
@Injectable()
export class CreditCheckService {
  private readonly logger = new Logger(CreditCheckService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly planControl: PlanControlService,
  ) {}

  /** A situação do cliente, para o aviso ao escolhê-lo no orçamento. */
  async clientCredit(
    companyId: string,
    clientId: string,
  ): Promise<ClientCredit | null> {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, companyId },
      select: {
        id: true,
        type: true,
        blockClient: true,
        requirePrepayment: true,
        maxValue: true,
        paymentConditions: {
          where: { isActive: true },
          select: { paymentConditionId: true },
        },
      },
    });
    if (!client) return null;
    return this.creditOf(companyId, client);
  }

  /** A conferência do orçamento, para o aviso e para a aprovação. */
  async quotationCredit(quotationId: string): Promise<QuotationCredit | null> {
    const quotation = await this.prisma.quotation.findUnique({
      where: { id: quotationId },
      select: {
        companyId: true,
        clientId: true,
        approvedAt: true,
        holdAt: true,
        quotationPayment: {
          select: {
            ...PARCELS_SELECT,
            finalValue: true,
            paymentCondition: { select: { id: true, name: true } },
            downPaymentConditionId: true,
          },
        },
        // Título cancelado (a pendência desfeita ao voltar para digitação)
        // não conta: a nova aprovação confere o crédito de novo
        _count: {
          select: { receivable: { where: { status: { not: 'CANCELED' } } } },
        },
        client: {
          select: {
            id: true,
            type: true,
            blockClient: true,
            requirePrepayment: true,
            maxValue: true,
            paymentConditions: {
              where: { isActive: true },
              select: { paymentConditionId: true },
            },
          },
        },
      },
    });
    if (!quotation?.client) return null;

    const credit = await this.creditOf(
      quotation.companyId,
      quotation.client,
      quotationId,
    );
    const payment = quotation.quotationPayment;
    const reference = quotation.approvedAt ?? quotation.holdAt ?? new Date();
    // Com título gerado, a venda já está no saldo em aberto
    const requested =
      quotation._count.receivable > 0
        ? 0
        : creditPartOf(parcelsOf(payment), reference);

    const issues: CreditIssue[] = [];
    if (credit.blockClient) {
      issues.push({ code: 'CLIENT_BLOCKED', message: CLIENT_BLOCKED_MESSAGE });
    }
    if (credit.allowedConditionIds && payment) {
      const used = await this.conditionsOf(payment);
      const refused = used.filter(
        (condition) => !credit.allowedConditionIds.includes(condition.id),
      );
      if (refused.length) {
        issues.push({
          code: 'CONDITION_NOT_ALLOWED',
          message: conditionNotAllowedMessage(refused.map((c) => c.name)),
          conditions: refused,
        });
      }
    }
    if (credit.limit !== null && requested > 0) {
      const excess = credit.used + requested - credit.limit;
      if (excess > 0) {
        // A entrada da diferença (PA-2): com ela paga no ato, o que fica a
        // prazo cabe no limite. Se o cliente já passou do limite sem esta
        // venda, a sugestão é a parte a prazo inteira
        const suggestedDownPayment = Math.min(excess, requested);
        const fullPayment = suggestedDownPayment >= requested;
        issues.push({
          code: 'CREDIT_LIMIT_EXCEEDED',
          message: creditExceededMessage({
            limit: credit.limit,
            used: credit.used,
            excess,
            suggestedDownPayment,
            fullPayment,
          }),
          excess,
          suggestedDownPayment,
          fullPayment,
        });
      }
    }
    // Antes da data de corte o limite só é registrado: a pendência pelo
    // limite espera a data, e a do pagamento antecipado do cliente vale já
    const hold =
      credit.applies &&
      (!credit.enforcing || !issues.length) &&
      quotation._count.receivable === 0
        ? holdOf(
            credit.enforcing ? credit : { ...credit, limit: null },
            requested,
            parcelsOf(payment),
            payment,
            reference,
          )
        : null;
    return { ...credit, requested, issues, hold };
  }

  /**
   * Na aprovação: recusa (409) quando o plano confere e há motivo; antes da
   * data de corte, só registra (e a pendência do pagamento antecipado do
   * cliente segue valendo). Os valores da recusa saem só para quem os vê:
   * o controller tira os números do corpo (`withoutValues`).
   */
  async assertApproval(quotationId: string): Promise<PaymentHold> {
    const credit = await this.quotationCredit(quotationId);
    if (!credit?.applies) return null;
    if (!credit.issues.length) return credit.hold;
    if (!credit.enforcing) {
      this.logger.warn(
        `[CREDIT] observando: a aprovação do orçamento ${quotationId} seria recusada (${credit.issues
          .map((issue) => issue.code)
          .join(', ')})`,
      );
      return credit.hold;
    }

    // O limite estourado já diz o caminho (PA-2); o aviso do cadastro fica
    // para o bloqueio e a condição
    const onlyLimit = credit.issues.every(
      (issue) => issue.code === 'CREDIT_LIMIT_EXCEEDED',
    );
    const message = [
      ...credit.issues.map((issue) => issue.message),
      ...(onlyLimit ? [] : [CREDIT_APPROVAL_HINT]),
    ].join(' ');
    throw new ConflictException({
      statusCode: 409,
      code: 'CREDIT_CHECK',
      message,
      issues: credit.issues.map((issue) =>
        issue.code === 'CONDITION_NOT_ALLOWED'
          ? { code: issue.code, conditions: issue.conditions }
          : issue.code === 'CREDIT_LIMIT_EXCEEDED'
            ? {
                code: issue.code,
                limit: credit.limit,
                used: credit.used,
                requested: credit.requested,
                excess: issue.excess,
                suggestedDownPayment: issue.suggestedDownPayment,
                fullPayment: issue.fullPayment,
              }
            : { code: issue.code },
      ),
    });
  }

  private async creditOf(
    companyId: string,
    client: {
      id: string;
      type: ClientKind;
      blockClient: boolean;
      requirePrepayment: boolean;
      maxValue: number | null;
      paymentConditions: { paymentConditionId: string }[];
    },
    excludeQuotationId?: string,
  ): Promise<ClientCredit> {
    const [applies, fallback] = await Promise.all([
      this.planControl.hasFeature(companyId, 'credit_limit_enforcement'),
      this.prisma.creditLimitDefault.findFirst({
        where: { companyId, type: client.type },
        orderBy: { createdAt: 'asc' },
        select: {
          maxValue: true,
          paymentConditions: {
            where: { isActive: true },
            select: { paymentConditionId: true },
          },
        },
      }),
    ]);

    const limit =
      client.maxValue && client.maxValue > 0
        ? Math.round(client.maxValue)
        : fallback?.maxValue && fallback.maxValue > 0
          ? Math.round(fallback.maxValue)
          : null;
    // Nenhuma condição marcada no cliente nem no padrão: todas valem (o
    // padrão nasce com todas desmarcadas)
    const allowed = client.paymentConditions.length
      ? client.paymentConditions
      : (fallback?.paymentConditions ?? []);

    const [openBalance, pendingApproved] = await Promise.all([
      this.openBalanceOf(companyId, client.id),
      this.pendingApprovedOf(companyId, client.id, excludeQuotationId),
    ]);
    const used = openBalance + pendingApproved;
    return {
      applies,
      enforcing: !isObservingNow({ untilEnv: CREDIT_ENFORCE_ENV }),
      blockClient: client.blockClient,
      requirePrepayment: client.requirePrepayment,
      limit,
      openBalance,
      pendingApproved,
      used,
      available: limit === null ? null : limit - used,
      allowedConditionIds: allowed.length
        ? allowed.map((row) => row.paymentConditionId)
        : null,
    };
  }

  /** Parcelas a receber pendentes ou vencidas do cliente, fora as de cartão. */
  private async openBalanceOf(companyId: string, clientId: string) {
    const sum = await this.prisma.receivableInstallment.aggregate({
      _sum: { amount: true },
      where: {
        status: { in: ['PENDING', 'OVERDUE'] },
        receivable: { companyId, clientId, status: { not: 'CANCELED' } },
        OR: [
          { paymentConditionId: null },
          {
            paymentCondition: {
              paymentMethod: { code: { notIn: CARD_METHODS } },
            },
          },
        ],
      },
    });
    return Math.round(sum._sum.amount ?? 0);
  }

  /**
   * Vendas aprovadas do cliente que ainda não geraram título (faturar na
   * entrega): o que é crédito em cada uma, pelo dia em que foi aprovada.
   */
  private async pendingApprovedOf(
    companyId: string,
    clientId: string,
    excludeQuotationId?: string,
  ) {
    const rows = await this.prisma.quotation.findMany({
      where: {
        companyId,
        clientId,
        isActive: true,
        isImported: false,
        // A pendente pela entrada (PA-2) só tem o título da entrada: o resto
        // é crédito comprometido. A do pagamento antecipado já tem todos
        OR: [
          // Sem o título principal: a liberada pela entrada que fatura na
          // entrega só tem o da entrada até a entrega
          {
            status: 'APPROVED',
            receivable: {
              none: { financialType: 'MAIN', status: { not: 'CANCELED' } },
            },
          },
          // Sem o título principal: só a entrada nasceu na pendência
          {
            status: 'PENDING_PAYMENT',
            holdReason: 'CREDIT_LIMIT',
            receivable: {
              none: { financialType: 'MAIN', status: { not: 'CANCELED' } },
            },
          },
        ],
        NOT: [
          { order: { is: { status: 'CANCELED' } } },
          ...(excludeQuotationId ? [{ id: excludeQuotationId }] : []),
        ],
      },
      select: {
        approvedAt: true,
        holdAt: true,
        quotationPayment: { select: PARCELS_SELECT },
      },
    });
    return rows.reduce(
      (sum, row) =>
        sum +
        creditPartOf(
          parcelsOf(row.quotationPayment),
          row.approvedAt ?? row.holdAt ?? new Date(),
        ),
      0,
    );
  }

  /** As condições que a venda usa: a principal, a da entrada e as parcelas. */
  private async conditionsOf(payment: {
    paymentCondition: { id: string; name: string } | null;
    downPayment: number;
    downPaymentConditionId: string | null;
    quotationInstallment: { paymentConditionId: string }[];
  }) {
    const ids = new Set<string>();
    if (payment.paymentCondition) ids.add(payment.paymentCondition.id);
    for (const item of payment.quotationInstallment) {
      ids.add(item.paymentConditionId);
    }
    if (payment.downPayment > 0 && payment.downPaymentConditionId) {
      ids.add(payment.downPaymentConditionId);
    }
    if (!ids.size) return [];
    return this.prisma.paymentCondition.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }
}
