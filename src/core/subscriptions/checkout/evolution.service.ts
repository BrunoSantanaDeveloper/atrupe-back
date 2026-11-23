import {
  BadGatewayException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { AsaasGatewayService } from '../asaas-gateway.service';
import { SubscriptionQuoteService } from '../pricing/subscription-quote.service';
import {
  addCalendarCycle,
  PricingCycle,
  QuoteResult,
} from '../pricing/pricing.engine';
import {
  billingModeOf,
  INSTALLMENT_SUBSCRIPTION_PREFIX,
  isBilledByGateway,
} from '../billing-mode';
import { EvolutionDto } from '../dto/checkout.dto';
import {
  ContractAcceptanceService,
  CurrentTerms,
} from './contract-acceptance.service';
import { CompanySessionService } from './company-session.service';
import { RequestMeta } from './checkout.service';
import {
  assertCanContract,
  assertCycleAvailable,
  assertPrincipalAdmin,
  assertInstallments,
  assertTermsAccepted,
  ContractingUser,
  ContractorOnFile,
  contractorOnFile,
  FIRST_DUE_DAYS,
  GatewayContract,
  IN_FLIGHT_WINDOW_MS,
  MIN_CHARGE_CENTS,
  openGatewayContract,
  recordContractCharges,
  releaseReservation,
  representativeOnFile,
} from './contracting-steps';

type BillingContext = Awaited<
  ReturnType<SubscriptionQuoteService['getBillingContext']>
>;
type CurrentSubscription = NonNullable<BillingContext['current']>;

const DAY_MS = 86_400_000;

/**
 * Evolução para o próximo plano da trilha, com crédito do tempo não usado.
 *
 * A evolução reinicia o ciclo: nasce uma cobrança nova no Asaas — assinatura
 * recorrente, ou parcelamento no anual no cartão — com o valor do plano novo,
 * e a primeira cobrança sai com o crédito abatido. Os complementos seguem o
 * que a pessoa escolheu: chegam marcados como estão na assinatura em curso.
 * Do anual só se evolui para outro anual (regra do orçamento).
 *
 * Com algo a pagar, o plano novo espera o pagamento (regra de 20/10): a nova
 * fica INACTIVE e a anterior segue valendo — e cobrando — até lá. Quem faz a
 * troca é a confirmação do pagamento (SubscriptionBlockService
 * .activateIfContractPaid), que encerra a anterior no Asaas e aqui. Nunca
 * paga, a evolução é desfeita sem tocar na anterior. Os passos:
 * 1. a anterior conferida no Asaas: com cobrança vencida, nada feito;
 * 2. reserva local, sob a trava da empresa;
 * 3. a cobrança nova no Asaas, com a primeira cobrança ajustada;
 * 4. registro local numa transação, com a nova à espera do pagamento.
 * Falhando o 3 ou o 4, a nova é desfeita e a reserva também.
 *
 * Crédito que cobre a primeira cobrança inteira (ou deixa menos que o mínimo
 * do Asaas) não gera cobrança, e não há o que esperar: a troca é na hora. O
 * ciclo coberto pelo crédito fica registrado numa cobrança local de valor
 * zero, a anterior é encerrada no Asaas — as cobranças futuras dela apagadas
 * antes — e a nova começa a cobrar no ciclo seguinte.
 */
@Injectable()
export class EvolutionService {
  private readonly logger = new Logger(EvolutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly asaasGateway: AsaasGatewayService,
    private readonly quoteService: SubscriptionQuoteService,
    private readonly acceptance: ContractAcceptanceService,
    private readonly session: CompanySessionService,
  ) {}

  async evolve(user: ContractingUser, dto: EvolutionDto, meta: RequestMeta) {
    assertCanContract(
      user,
      'Somente administradores da empresa podem evoluir o plano.',
    );
    await assertPrincipalAdmin(
      this.prisma,
      user,
      'Somente o administrador principal da conta (Usuário nº 1) pode alterar o plano.',
    );

    const cycle: PricingCycle = dto.cycle ?? 'MONTHLY';
    const installmentCount = dto.installmentCount ?? 1;
    assertCycleAvailable(cycle);

    const now = new Date();
    const response = await this.quoteService.quote(
      user.companyId,
      {
        planId: dto.planId,
        cycle,
        billingType: dto.billingType as any,
        installmentCount,
        modules: dto.modules,
        additionalUsers: dto.additionalUsers,
        couponCode: dto.couponCode,
      },
      now,
    );
    const quote = this.assertEvolvable(response, dto);
    assertInstallments(quote, installmentCount);

    const terms = await this.acceptance.currentTerms();
    assertTermsAccepted(dto.termsAcceptance, terms);

    const ctx = await this.quoteService.getBillingContext(user.companyId, now);
    const current = ctx.current;
    if (!current || ctx.intent !== 'EVOLUTION') {
      throw new ConflictException({
        code: 'SUBSCRIPTION_CHANGED',
        message:
          'A assinatura mudou enquanto a evolução era preparada. Recarregue a página.',
      });
    }

    const [plan, features, sessionUser, coupon, customer, lastAcceptance] =
      await Promise.all([
        this.prisma.plan.findUniqueOrThrow({ where: { id: dto.planId } }),
        dto.modules?.length
          ? this.prisma.feature.findMany({
              where: {
                key: { in: dto.modules },
                isActive: true,
                price: { gt: 0 },
                // O que o plano novo já inclui não vira módulo pago.
                planFeatures: { none: { planId: dto.planId, isActive: true } },
                // Fora do catálogo (a faixa de 1 TB), só o que a assinatura
                // em curso já tem segue para o plano novo; o orçamento já
                // recusou o resto
                OR: [
                  { listed: true },
                  {
                    subscriptionFeatures: {
                      some: {
                        subscriptionId: current.id,
                        isActive: true,
                        grantSource: null,
                      },
                    },
                  },
                ],
              },
            })
          : Promise.resolve([]),
        this.prisma.user.findUniqueOrThrow({
          where: { id: user.userId },
          select: { id: true, name: true, email: true },
        }),
        quote.coupon?.applied
          ? this.prisma.coupon.findUnique({
              where: { code: quote.coupon.code },
            })
          : Promise.resolve(null),
        this.prisma.customer.findUnique({ where: { id: current.customerId } }),
        this.prisma.contractAcceptance.findFirst({
          where: { companyId: user.companyId },
          orderBy: { createdAt: 'desc' },
        }),
      ]);

    // Assinatura atribuída à mão, sem cliente no Asaas, não tem onde cobrar.
    if (!customer?.asaasCustomerId?.startsWith('cus_')) {
      throw new UnprocessableEntityException({
        code: 'BILLING_ACCOUNT_REQUIRED',
        message:
          'Esta assinatura não tem cadastro de cobrança. Fale com a Atrupe para evoluir o plano.',
      });
    }
    const contractor = contractorOnFile(lastAcceptance, customer)!;
    const representative = representativeOnFile(lastAcceptance, user.userId);

    const chargesNow = quote.totalCents >= MIN_CHARGE_CENTS;
    const firstDueDate = chargesNow
      ? new Date(now.getTime() + FIRST_DUE_DAYS * DAY_MS)
      : addCalendarCycle(now, cycle);
    // Com algo a pagar, a troca espera o pagamento; a anterior é conferida
    // agora, antes de abrir a cobrança nova.
    const awaitPayment = chargesNow;
    if (awaitPayment) await this.previousCharges(current, now);

    // 1. Reserva
    const reserved = await this.reserve({
      user,
      dto,
      quote,
      cycle,
      current,
      customerId: customer.id,
      planId: plan.id,
      features,
      coupon,
      firstDueDate,
    });

    let contract: GatewayContract | null = null;
    let previousClosed = false;
    let registered: Awaited<ReturnType<EvolutionService['register']>>;
    try {
      // 2. A cobrança nova, com o valor do plano novo
      contract = await openGatewayContract(this.asaasGateway, this.logger, {
        customer: customer.asaasCustomerId,
        billingType: dto.billingType,
        cycle,
        installmentCount,
        quote,
        chargesNow,
        firstDueDate,
        description: `Assinatura ${plan.name}`,
        externalReference: reserved.id,
      });

      // Coberta pelo crédito, a anterior deixa de cobrar já.
      if (!awaitPayment) {
        await this.closePrevious(current, now);
        previousClosed = true;
      }

      // Registro. Uma segunda tentativa antes de desistir: sem pagamento a
      // esperar, desfazer já não devolve a assinatura anterior ao Asaas.
      const input = {
        user,
        dto,
        quote,
        cycle,
        installmentCount,
        terms,
        contractor,
        representative,
        sessionUser,
        reservedId: reserved.id,
        current,
        planName: plan.name,
        contract,
        asaasCustomerId: customer.asaasCustomerId,
        meta,
        now,
        awaitPayment,
      };
      registered = await this.register(input).catch((error) => {
        this.logger.warn(
          `Registro da evolução ${reserved.id} falhou; nova tentativa: ${error.message}`,
        );
        return this.register(input);
      });
    } catch (error) {
      if (previousClosed) {
        this.logger.error(
          `RECONCILIAR: a assinatura ${current.asaasSubscriptionId} da empresa ${user.companyId} foi encerrada no Asaas pela evolução ${reserved.id}, que não foi registrada: ${error.message}`,
        );
      }
      await releaseReservation(this.prisma, this.asaasGateway, this.logger, {
        subscriptionId: reserved.id,
        couponId: coupon?.id ?? null,
        asaasSubscriptionId: contract?.asaasSubscriptionId ?? null,
        asaasInstallmentId: contract?.asaasInstallmentId ?? null,
      });
      if (error instanceof HttpException) throw error;
      this.logger.error(
        `Evolução da empresa ${user.companyId} falhou: ${error.message}`,
      );
      throw new BadGatewayException({
        code: 'GATEWAY_ERROR',
        message:
          'Não foi possível concluir a evolução no gateway de pagamento. Nada foi cobrado e o plano atual continua valendo; tente novamente.',
      });
    }

    // A evolução está registrada: nada abaixo pode desfazê-la.
    const session = await this.session
      .build(user.companyId, user.userId)
      .catch((error) => {
        this.logger.warn(
          `Sessão não montada após a evolução ${reserved.id}: ${error.message}`,
        );
        return null;
      });

    const { payment, acceptance } = registered;
    return {
      subscription: {
        id: reserved.id,
        // Com algo a pagar, o plano novo é liberado quando o pagamento for
        // confirmado.
        status: awaitPayment ? ('INACTIVE' as const) : ('ACTIVE' as const),
        planId: plan.id,
        planName: plan.name,
        cycle,
        billingType: dto.billingType,
        installmentCount:
          contract.billingMode === 'ASAAS_INSTALLMENT'
            ? installmentCount
            : null,
        nextDueDate: contract.nextDueDate,
      },
      payment: {
        id: payment.id,
        asaasPaymentId: payment.asaasPaymentId,
        status: payment.status,
        valueCents: Math.round(payment.value * 100),
        dueDate: payment.dueDate,
        invoiceUrl: payment.invoiceUrl,
      },
      // Sem cobrança agora quando o crédito cobriu o primeiro ciclo.
      paymentUrl: chargesNow ? payment.invoiceUrl : null,
      creditCents: quote.creditCents,
      acceptance,
      session,
    };
  }

  private assertEvolvable(
    response: Awaited<ReturnType<SubscriptionQuoteService['quote']>>,
    dto: EvolutionDto,
  ): QuoteResult {
    if (response.intent === 'REGULARIZATION') {
      throw new ConflictException({
        code: 'REGULARIZATION_REQUIRED',
        message:
          'Há uma cobrança em aberto. Regularize-a antes de evoluir o plano.',
      });
    }
    if (response.intent === 'NEW') {
      throw new UnprocessableEntityException({
        code: 'NOTHING_TO_EVOLVE',
        message: 'Não há plano contratado para evoluir.',
      });
    }
    if (!response.eligible || !response.quote) {
      throw new UnprocessableEntityException({
        code: 'PLAN_NOT_AVAILABLE',
        reason: response.ineligibilityReason,
        message:
          response.ineligibilityReason === 'ANNUAL_TO_MONTHLY_NOT_ALLOWED'
            ? 'Do plano anual, a evolução é para outro plano anual.'
            : 'Este plano não está disponível para evolução.',
      });
    }
    const quote = response.quote;
    if (quote.coupon && !quote.coupon.applied) {
      throw new UnprocessableEntityException({
        code: 'COUPON_NOT_APPLIED',
        message: quote.coupon.message ?? 'O cupom não pôde ser aplicado.',
      });
    }
    if (
      dto.expectedTotalCents != null &&
      dto.expectedTotalCents !== quote.totalCents
    ) {
      throw new ConflictException({
        code: 'PRICE_CHANGED',
        message:
          'O valor mudou desde que o resumo foi exibido. Confira o novo total.',
        quote,
      });
    }
    return quote;
  }

  /** Passo 1: a reserva local, sob a mesma trava da contratação. */
  private async reserve(input: {
    user: ContractingUser;
    dto: EvolutionDto;
    quote: QuoteResult;
    cycle: PricingCycle;
    current: CurrentSubscription;
    customerId: string;
    planId: string;
    features: { id: string; price: number }[];
    coupon: { id: string; discountType: any } | null;
    firstDueDate: Date;
  }) {
    const { user, dto, quote, current, coupon } = input;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`checkout:${user.companyId}`}))`;

      // O que se evolui é a assinatura orçada. Se ela mudou no caminho (outra
      // evolução, um cancelamento), o pedido se refaz sobre a situação nova.
      const stillCurrent = await tx.subscription.findFirst({
        where: { id: current.id, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!stillCurrent) {
        throw new ConflictException({
          code: 'SUBSCRIPTION_CHANGED',
          message:
            'A assinatura mudou enquanto a evolução era preparada. Recarregue a página.',
        });
      }
      const inFlight = await tx.subscription.findFirst({
        where: {
          companyId: user.companyId,
          status: 'INACTIVE',
          asaasSubscriptionId: { startsWith: 'temp_' },
          createdAt: { gte: new Date(Date.now() - IN_FLIGHT_WINDOW_MS) },
        },
        select: { id: true },
      });
      if (inFlight) {
        throw new ConflictException({
          code: 'CHECKOUT_IN_PROGRESS',
          message: 'Já existe uma contratação em andamento para esta empresa.',
        });
      }

      const subscription = await tx.subscription.create({
        data: {
          customerId: input.customerId,
          planId: input.planId,
          companyId: user.companyId,
          additionalUsers: dto.additionalUsers ?? 0,
          asaasSubscriptionId: `temp_${randomUUID()}`,
          nextDueDate: input.firstDueDate,
          cycle: input.cycle,
          billingType: dto.billingType,
          value: quote.recurringCents / 100,
          status: 'INACTIVE',
          couponId: coupon?.id ?? null,
          couponCode: coupon ? (quote.coupon?.code ?? null) : null,
          discountValue: coupon ? quote.couponDiscountCents : null,
          discountType: coupon?.discountType ?? null,
          recurringValueCents: quote.recurringCents,
          evolutionCreditCents: quote.creditCents || null,
          previousSubscriptionId: current.id,
          pricingSnapshot: {
            engine: 'pricing.engine/v1',
            source: 'evolution',
            fromSubscriptionId: current.id,
            quote,
          } as any,
        },
      });

      for (const feature of input.features) {
        await tx.subscriptionFeature.create({
          data: {
            subscriptionId: subscription.id,
            featureId: feature.id,
            price: feature.price,
            isActive: true,
          },
        });
      }

      // O que a empresa tem sem cobrança — mantido quando o recurso saiu do
      // plano, ou cortesia — segue com a evolução, a não ser que o plano novo
      // já o inclua.
      const grants = await tx.subscriptionFeature.findMany({
        where: {
          subscriptionId: current.id,
          isActive: true,
          grantSource: { not: null },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          feature: {
            planFeatures: { none: { planId: input.planId, isActive: true } },
          },
        },
      });
      if (grants.length > 0) {
        await tx.subscriptionFeature.createMany({
          data: grants.map((grant) => ({
            subscriptionId: subscription.id,
            featureId: grant.featureId,
            price: 0,
            isActive: true,
            grantSource: grant.grantSource,
            grantedBy: grant.grantedBy,
            grantedByName: grant.grantedByName,
            grantReason: grant.grantReason,
            expiresAt: grant.expiresAt,
          })),
          skipDuplicates: true,
        });
      }

      if (coupon) {
        await tx.couponUsage.create({
          data: {
            couponId: coupon.id,
            companyId: user.companyId,
            subscriptionId: subscription.id,
            discountApplied: quote.couponDiscountCents,
            originalValue: quote.totalCents + quote.couponDiscountCents,
            finalValue: quote.totalCents,
          },
        });
        await tx.coupon.update({
          where: { id: coupon.id },
          data: { currentUses: { increment: 1 } },
        });
      }

      return subscription;
    });
  }

  /**
   * As cobranças da anterior no Asaas, que precisa estar em dia. Quem responde
   * se há cobrança em aberto é o Asaas: uma vencida que o banco não viu seria
   * apagada junto na troca, e isso seria perdoar a dívida.
   */
  private async previousCharges(current: CurrentSubscription, now: Date) {
    // Atribuída à mão, teste, ou parcelado cujo ano o crédito pagou: não há
    // cobrança no Asaas.
    if (!isBilledByGateway(current)) return [];

    const payments = await this.asaasGateway.getChargesOf(current);
    const today = now.toISOString().slice(0, 10);
    const open = payments.some(
      (p) =>
        p.status === 'OVERDUE' ||
        p.status === 'AWAITING_RISK_ANALYSIS' ||
        (p.status === 'PENDING' && String(p.dueDate) < today),
    );
    if (open) {
      throw new ConflictException({
        code: 'REGULARIZATION_REQUIRED',
        message:
          'Há uma cobrança em aberto. Regularize-a antes de evoluir o plano.',
      });
    }
    return payments;
  }

  /**
   * A cobrança anterior deixa de correr, na evolução que o crédito pagou.
   *
   * As cobranças futuras que o Asaas já gerou são apagadas ANTES de encerrar a
   * assinatura: com ela viva, apagar não tem ambiguidade. No parcelado não há
   * assinatura a encerrar — só as parcelas ainda não pagas, como a renovação
   * do ano seguinte, já criada.
   */
  private async closePrevious(current: CurrentSubscription, now: Date) {
    if (!isBilledByGateway(current)) return;
    const mode = billingModeOf(current);
    const payments = await this.previousCharges(current, now);

    const deleted: string[] = [];
    try {
      for (const payment of payments.filter((p) => p.status === 'PENDING')) {
        await this.asaasGateway.deleteAsaasPayment(payment.id);
        deleted.push(payment.id);
      }
      if (mode === 'ASAAS_SUBSCRIPTION') {
        await this.asaasGateway.cancelAsaasSubscription(
          current.asaasSubscriptionId,
        );
      }
    } catch (error) {
      // A evolução vai ser desfeita e a anterior segue valendo — sem as
      // cobranças já apagadas, que o Asaas não gera de novo.
      if (deleted.length > 0) {
        this.logger.error(
          `RECONCILIAR: evolução não concluída; as cobranças ${deleted.join(', ')} da assinatura ${current.id}, que segue valendo, foram apagadas: ${error.message}`,
        );
      }
      throw error;
    }
  }

  /**
   * O registro local, numa transação só. Esperando o pagamento, a nova segue
   * INACTIVE e a anterior, intacta; coberta pelo crédito, a nova entra no
   * lugar da anterior já.
   */
  private async register(input: {
    user: ContractingUser;
    dto: EvolutionDto;
    quote: QuoteResult;
    cycle: PricingCycle;
    installmentCount: number;
    terms: CurrentTerms;
    contractor: ContractorOnFile;
    representative: ReturnType<typeof representativeOnFile>;
    sessionUser: { id: string; name: string; email: string };
    reservedId: string;
    current: CurrentSubscription;
    planName: string;
    contract: GatewayContract;
    asaasCustomerId: string;
    meta: RequestMeta;
    now: Date;
    awaitPayment: boolean;
  }) {
    const {
      user,
      dto,
      quote,
      current,
      reservedId,
      sessionUser,
      contract,
      now,
    } = input;
    const installment = contract.billingMode === 'ASAAS_INSTALLMENT';
    const chargedNow = contract.charges.length > 0;

    const { payment, acceptance } = await this.prisma.$transaction(
      async (tx) => {
        await tx.subscription.update({
          where: { id: reservedId },
          data: {
            // O parcelado não tem assinatura no Asaas: o id local o marca.
            asaasSubscriptionId:
              contract.asaasSubscriptionId ??
              `${INSTALLMENT_SUBSCRIPTION_PREFIX}${reservedId}`,
            asaasInstallmentId: contract.asaasInstallmentId,
            billingMode: contract.billingMode,
            installmentCount: installment ? input.installmentCount : null,
            nextDueDate: contract.nextDueDate,
            ...(input.awaitPayment ? {} : { status: 'ACTIVE' as const }),
            contractedAt: now,
          },
        });

        if (!input.awaitPayment) {
          await tx.subscription.update({
            where: { id: current.id },
            data: { status: 'CANCELED', endedReason: 'EVOLVED' },
          });
          // As cobranças futuras da anterior foram apagadas no Asaas.
          await tx.payment.updateMany({
            where: { subscriptionId: current.id, status: 'PENDING' },
            data: { status: 'CANCELED' },
          });
          await tx.subscriptionHistory.create({
            data: {
              subscriptionId: current.id,
              action: 'EVOLVED',
              description: `Assinatura substituída pela evolução para o ${input.planName}`,
              changes: {
                before: { status: 'ACTIVE' },
                after: { status: 'CANCELED' },
              },
              metadata: { newSubscriptionId: reservedId },
              createdBy: user.userId,
              createdByName: sessionUser.name,
            },
          });
        }

        const [payment] = await recordContractCharges(tx, this.asaasGateway, {
          subscriptionId: reservedId,
          asaasCustomerId: input.asaasCustomerId,
          billingType: dto.billingType,
          cycle: input.cycle,
          quote,
          contract,
          kind: 'EVOLUTION',
          now,
        });

        await tx.subscriptionHistory.create({
          data: {
            subscriptionId: reservedId,
            action: 'EVOLUTION_CONTRACTED',
            description: input.awaitPayment
              ? `Evolução do ${current.plan.name} para o ${input.planName} registrada; o ${input.planName} é liberado com a confirmação do pagamento`
              : `Evolução do ${current.plan.name} para o ${input.planName} registrada; o crédito cobriu o primeiro ciclo`,
            metadata: {
              // A marca que a liberação pelo pagamento procura.
              ...(input.awaitPayment ? { accessAfterPayment: true } : {}),
              fromSubscriptionId: current.id,
              fromPlan: current.plan.name,
              cycle: input.cycle,
              creditCents: quote.creditCents,
              totalCents: quote.totalCents,
              recurringCents: quote.recurringCents,
              ...(installment
                ? {
                    installmentCount: input.installmentCount,
                    asaasInstallmentId: contract.asaasInstallmentId,
                  }
                : {}),
              ...(chargedNow
                ? { paymentId: payment.asaasPaymentId }
                : // Abaixo do mínimo do Asaas, o que sobrou não é cobrado.
                  { waivedCents: quote.totalCents }),
            },
            createdBy: user.userId,
            createdByName: sessionUser.name,
          },
        });

        const acceptance = await this.acceptance.record(tx, {
          terms: input.terms,
          companyId: user.companyId,
          subscriptionId: reservedId,
          context: 'EVOLUTION',
          acceptedBy: {
            userId: sessionUser.id,
            name: sessionUser.name,
            email: sessionUser.email,
          },
          contractor: {
            type: input.contractor.type,
            document: input.contractor.document,
            name: input.contractor.name,
            tradeName: input.contractor.tradeName,
            email: input.contractor.email,
          },
          // A evolução não muda quem responde pela empresa.
          representative: input.representative,
          ipAddress: input.meta.ip ?? null,
          userAgent: input.meta.userAgent ?? null,
        });

        await tx.company.updateMany({
          where: { id: user.companyId, ownerUserId: null },
          data: { ownerUserId: user.userId },
        });

        return { payment, acceptance };
      },
    );

    return { payment, acceptance };
  }
}
