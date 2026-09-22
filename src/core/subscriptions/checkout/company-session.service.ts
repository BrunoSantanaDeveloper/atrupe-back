import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { PlanControlService } from '../../plan/plan-control.service';
import { SubscriptionQuoteService } from '../pricing/subscription-quote.service';

export type BillingSituationKind =
  | 'EM_DIA'
  | 'ATRASADA'
  | 'BLOQUEADA'
  | 'INATIVA';

export interface ChargeInFocus {
  asaasPaymentId: string;
  dueDate: string;
  /** Em reais, como o Asaas e a tabela de cobranças guardam. */
  value: number;
  billingType: string;
  status: string;
  invoiceUrl: string | null;
}

export interface BillingSituation {
  situation: BillingSituationKind;
  daysOverdue: number;
  /** Contratação registrada, com acesso liberado, e a primeira cobrança ainda não paga. */
  paymentPending: boolean;
  chargeInFocus: ChargeInFocus | null;
}

/**
 * O bloco `company` da sessão, no formato que o `update()` do NextAuth já
 * consome — mais a situação da cobrança e se quem está logado é o titular.
 */
export interface CompanySessionBlock {
  plan: {
    name: string;
    active: boolean;
    trialEndsAt: string | null;
    features: string[];
    limits: Record<string, any>;
  };
  blockLevel: 'NONE' | 'PARTIAL' | 'FULL';
  billing: BillingSituation;
  isOwner: boolean;
}

const DAY_MS = 86_400_000;

/**
 * Monta a sessão da empresa a partir do banco.
 *
 * Existe para que contratar, pagar ou regularizar reflita na tela SEM novo
 * login: antes, bloqueio e fim do teste só mudavam na sessão no login seguinte,
 * e quem pagava continuava preso até sair e entrar de novo.
 */
@Injectable()
export class CompanySessionService {
  private readonly logger = new Logger(CompanySessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly planControl: PlanControlService,
    private readonly quoteService: SubscriptionQuoteService,
  ) {}

  async build(
    companyId: string,
    userId?: string,
    now: Date = new Date(),
  ): Promise<CompanySessionBlock> {
    const [planInfo, company, ctx] = await Promise.all([
      this.planControl.getCompanyPlanInfo(companyId).catch((error) => {
        this.logger.warn(
          `Plano da empresa ${companyId} indisponível: ${error.message}`,
        );
        return null;
      }),
      this.prisma.company.findUnique({
        where: { id: companyId },
        select: { blockLevel: true, ownerUserId: true },
      }),
      this.quoteService.getBillingContext(companyId, now),
    ]);

    const features = planInfo
      ? Object.keys(planInfo.features).filter((key) => planInfo.features[key])
      : [];
    const blockLevel = (company?.blockLevel ?? 'NONE') as
      | 'NONE'
      | 'PARTIAL'
      | 'FULL';

    return {
      plan: {
        name: planInfo?.planType ?? 'TRIAL',
        active: !!planInfo && planInfo.planType !== 'TRIAL',
        trialEndsAt: planInfo?.trialEndsAt
          ? new Date(planInfo.trialEndsAt).toISOString()
          : null,
        features,
        limits: planInfo?.limits ?? {},
      },
      blockLevel,
      billing: this.billingSituation(ctx, blockLevel, now),
      isOwner: !!userId && company?.ownerUserId === userId,
    };
  }

  private billingSituation(
    ctx: Awaited<ReturnType<SubscriptionQuoteService['getBillingContext']>>,
    blockLevel: 'NONE' | 'PARTIAL' | 'FULL',
    now: Date,
  ): BillingSituation {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    const open = (ctx.current?.payments ?? [])
      .filter((p) => p.status === 'OVERDUE' || p.status === 'PENDING')
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());

    const overdue = open.find(
      (p) => p.status === 'OVERDUE' || this.localDay(p.dueDate) < today,
    );
    // Em foco: a vencida mais antiga; sem vencida, a primeira cobrança de uma
    // contratação que ainda não foi paga. Renovação futura não é pendência.
    const focus =
      overdue ?? (ctx.firstChargePending ? (open[0] ?? null) : null);

    const daysOverdue = overdue
      ? Math.max(
          0,
          Math.floor(
            (today.getTime() - this.localDay(overdue.dueDate).getTime()) /
              DAY_MS,
          ),
        )
      : 0;

    const situation: BillingSituationKind =
      blockLevel === 'FULL'
        ? 'INATIVA'
        : blockLevel === 'PARTIAL'
          ? 'BLOQUEADA'
          : daysOverdue >= 1
            ? 'ATRASADA'
            : 'EM_DIA';

    return {
      situation,
      daysOverdue,
      paymentPending: ctx.firstChargePending,
      chargeInFocus: focus
        ? {
            asaasPaymentId: focus.asaasPaymentId,
            dueDate: focus.dueDate.toISOString(),
            value: focus.value,
            billingType: focus.billingType,
            status: focus.status,
            invoiceUrl: focus.invoiceUrl ?? null,
          }
        : null,
    };
  }

  /**
   * A data de vencimento é gravada como meia-noite UTC do dia; comparar com
   * "hoje" local exige o mesmo dia à meia-noite local, senão o atraso ganha
   * um dia inteiro em fuso negativo.
   */
  private localDay(date: Date): Date {
    const d = new Date(date);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
}
