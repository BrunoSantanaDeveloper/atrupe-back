import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { PlanControlService } from '../../plan/plan-control.service';
import { SubscriptionQuoteService } from '../pricing/subscription-quote.service';
import { SubscriptionBlockService } from '../subscription-block.service';

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
  /** Contratação registrada e a primeira cobrança ainda não paga. */
  paymentPending: boolean;
  /**
   * O plano contratado espera esse pagamento para ser liberado (contratação
   * a partir de 20/10). Falso quando a contratação já liberou o acesso — as
   * de antes de 20/10 e a evolução.
   */
  activationPending: boolean;
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

/** Intervalo mínimo entre duas conferências da mesma empresa com o Asaas. */
const GATEWAY_CHECK_INTERVAL_MS = 60_000;

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

  /** Última conferência com o Asaas, por empresa. */
  private readonly lastGatewayCheck = new Map<string, number>();

  /** Quanto a resposta espera pelo Asaas antes de seguir com o banco. */
  private readonly gatewayCheckTimeoutMs = 8_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly planControl: PlanControlService,
    private readonly quoteService: SubscriptionQuoteService,
    private readonly subscriptionBlock: SubscriptionBlockService,
  ) {}

  /**
   * A sessão que o cliente consulta — ao abrir o app, ao voltar à aba e a cada
   * 5 minutos —, conferida com o Asaas quando há cobrança em foco.
   *
   * O banco só ficava sabendo de um pagamento pelo webhook, que não chega à
   * API, ou pela rotina das 03:00. Quem contratava e pagava na hora seguia
   * vendo "Pagamento da contratação pendente" até o dia seguinte (Zip Ideias,
   * 19/10). Com cobrança em foco — a primeira ainda não paga, ou uma vencida —,
   * as cobranças da empresa são alinhadas ao Asaas antes de responder; a
   * contratação que esperava o pagamento, se paga, é liberada nesse
   * alinhamento.
   *
   * No máximo uma conferência por empresa a cada minuto. A resposta não espera
   * mais que o tempo-limite: passado ele, sai o que o banco diz, e o
   * alinhamento, que segue sozinho, vale na atualização seguinte. Falha no
   * Asaas não derruba a sessão.
   */
  async buildWithGatewayCheck(
    companyId: string,
    userId?: string,
    now: Date = new Date(),
  ): Promise<CompanySessionBlock> {
    const block = await this.build(companyId, userId, now);
    if (!block.billing.chargeInFocus || !this.claimGatewayCheck(companyId)) {
      return block;
    }

    const sync = this.subscriptionBlock
      .syncCompanyCharges(companyId)
      .then(
        ({ created, updated, canceled, activated }) =>
          created + updated + canceled + activated > 0,
      )
      .catch((error) => {
        this.logger.warn(
          `Cobranças da empresa ${companyId} não conferidas no Asaas: ${error.message}`,
        );
        return false;
      });

    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), this.gatewayCheckTimeoutMs);
    });
    const changed = await Promise.race([sync, timedOut]).finally(() =>
      clearTimeout(timer),
    );

    return changed ? this.build(companyId, userId, now) : block;
  }

  /** Reserva a conferência da empresa; falso se houve uma há menos de um minuto. */
  private claimGatewayCheck(companyId: string): boolean {
    const now = Date.now();
    const last = this.lastGatewayCheck.get(companyId);
    if (last !== undefined && now - last < GATEWAY_CHECK_INTERVAL_MS) {
      return false;
    }
    this.lastGatewayCheck.set(companyId, now);
    return true;
  }

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
    const paymentPending = ctx.firstChargePending || ctx.awaitingActivation;
    // Em foco: a vencida mais antiga; sem vencida, a primeira cobrança de uma
    // contratação que ainda não foi paga. Renovação futura não é pendência.
    const focus = overdue ?? (paymentPending ? (open[0] ?? null) : null);

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
      paymentPending,
      activationPending: ctx.awaitingActivation,
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
