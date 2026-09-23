import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { AsaasGatewayService } from '../asaas-gateway.service';
import { SubscriptionQuoteService } from '../pricing/subscription-quote.service';
import { PricingCycle, QuoteResult } from '../pricing/pricing.engine';
import { INSTALLMENT_SUBSCRIPTION_PREFIX } from '../billing-mode';
import { CheckoutDto } from '../dto/checkout.dto';
import { CompanyRegistryService } from './company-registry.service';
import {
  ContractAcceptanceService,
  CurrentTerms,
} from './contract-acceptance.service';
import { CompanySessionService } from './company-session.service';
import { verifyRepresentative } from './representatives';
import {
  assertCanContract,
  assertCycleAvailable,
  assertInstallments,
  assertTermsAccepted,
  ContractingUser,
  FIRST_DUE_DAYS,
  GatewayContract,
  IN_FLIGHT_WINDOW_MS,
  MIN_CHARGE_CENTS,
  openGatewayContract,
  recordContractCharges,
  releaseReservation,
} from './contracting-steps';

export type CheckoutUser = ContractingUser;

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

interface ResolvedContractor {
  type: 'PF' | 'PJ';
  document: string;
  name: string;
  tradeName: string | null;
  email: string;
  representative: {
    cpf: string;
    name: string;
    verified: boolean;
    isSessionUser: boolean;
  } | null;
  registrySnapshot: Record<string, any> | null;
}

/**
 * Contratação em três etapas: plano, contrato e pagamento.
 *
 * O preço sai do mesmo motor do orçamento exibido na tela, e a contratação é
 * recusada se ele tiver mudado. O cartão continua sendo digitado na fatura do
 * Asaas: aqui se escolhe a forma de pagamento e se registra a contratação.
 *
 * Contratação registrada LIBERA O ACESSO, com o pagamento ainda em aberto: a
 * pendência vira aviso, não bloqueio. O que depende de valor pago (crédito de
 * evolução, desbloqueio) só vem com o pagamento confirmado.
 *
 * É uma saga em três passos, com compensação:
 * 1. reserva local (assinatura INACTIVE, cupom reservado), sob trava da empresa;
 * 2. Asaas (cliente, assinatura, ajuste da primeira cobrança);
 * 3. ativação local (ACTIVE, trial encerrado, cobrança, aceite do contrato).
 * Falhando o 2 ou o 3, a assinatura do Asaas é cancelada e a reserva desfeita:
 * nada fica cobrando sem uma contratação registrada por trás.
 */
@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly asaasGateway: AsaasGatewayService,
    private readonly quoteService: SubscriptionQuoteService,
    private readonly registry: CompanyRegistryService,
    private readonly acceptance: ContractAcceptanceService,
    private readonly session: CompanySessionService,
  ) {}

  async checkout(user: CheckoutUser, dto: CheckoutDto, meta: RequestMeta) {
    assertCanContract(user);

    const cycle = dto.cycle ?? 'MONTHLY';
    const installmentCount = dto.installmentCount ?? 1;
    assertCycleAvailable(cycle);

    const response = await this.quoteService.quote(user.companyId, {
      planId: dto.planId,
      cycle,
      billingType: dto.billingType as any,
      installmentCount,
      modules: dto.modules,
      additionalUsers: dto.additionalUsers,
      couponCode: dto.couponCode,
    });
    const quote = this.assertQuotable(response, dto);
    assertInstallments(quote, installmentCount);

    const terms = await this.acceptance.currentTerms();
    assertTermsAccepted(dto.termsAcceptance, terms);

    const contractor = await this.resolveContractor(user, dto);

    const [plan, features, sessionUser, coupon] = await Promise.all([
      this.prisma.plan.findUniqueOrThrow({ where: { id: dto.planId } }),
      dto.modules?.length
        ? this.prisma.feature.findMany({
            where: {
              key: { in: dto.modules },
              isActive: true,
              price: { gt: 0 },
            },
          })
        : Promise.resolve([]),
      this.prisma.user.findUniqueOrThrow({
        where: { id: user.userId },
        select: { id: true, name: true, email: true },
      }),
      quote.coupon?.applied
        ? this.prisma.coupon.findUnique({ where: { code: quote.coupon.code } })
        : Promise.resolve(null),
    ]);

    const customer = await this.provisionCustomer(user.companyId, contractor);
    const firstDueDate = new Date(
      Date.now() + FIRST_DUE_DAYS * 24 * 60 * 60 * 1000,
    );

    // 1. Reserva
    const reserved = await this.reserve({
      user,
      dto,
      quote,
      cycle,
      customerId: customer.id,
      planId: plan.id,
      features,
      coupon,
      firstDueDate,
    });

    // 2. Asaas: a assinatura recorrente, ou o parcelamento do anual no cartão.
    // A assinatura nasce com o valor CHEIO da renovação; cupom e crédito abatem
    // só a primeira cobrança.
    let contract: GatewayContract | null = null;
    let activated: Awaited<ReturnType<CheckoutService['activate']>>;
    try {
      contract = await openGatewayContract(this.asaasGateway, this.logger, {
        customer: customer.asaasCustomerId,
        billingType: dto.billingType,
        cycle,
        installmentCount,
        quote,
        chargesNow: true,
        firstDueDate,
        description: `Assinatura ${plan.name}`,
        externalReference: reserved.id,
      });

      // 3. Ativação
      activated = await this.activate({
        user,
        dto,
        quote,
        cycle,
        installmentCount,
        terms,
        contractor,
        sessionUser,
        reservedId: reserved.id,
        contract,
        asaasCustomerId: customer.asaasCustomerId,
        meta,
      });
    } catch (error) {
      await releaseReservation(this.prisma, this.asaasGateway, this.logger, {
        subscriptionId: reserved.id,
        couponId: coupon?.id ?? null,
        asaasSubscriptionId: contract?.asaasSubscriptionId ?? null,
        asaasInstallmentId: contract?.asaasInstallmentId ?? null,
      });
      this.logger.error(
        `Contratação da empresa ${user.companyId} falhou: ${error.message}`,
      );
      throw new BadGatewayException({
        code: 'GATEWAY_ERROR',
        message:
          'Não foi possível concluir a contratação no gateway de pagamento. Nada foi cobrado; tente novamente.',
      });
    }

    // Daqui em diante a contratação está registrada: nada abaixo pode
    // desfazê-la. Sem a sessão, a tela a busca de novo.
    const session = await this.session
      .build(user.companyId, user.userId)
      .catch((error) => {
        this.logger.warn(
          `Sessão não montada após a contratação ${reserved.id}: ${error.message}`,
        );
        return null;
      });

    const { payment, acceptance } = activated;
    return {
      subscription: {
        id: reserved.id,
        status: 'ACTIVE' as const,
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
      paymentUrl: payment.invoiceUrl,
      acceptance,
      session,
    };
  }

  /** Passo 3: a ativação local, numa transação só. */
  private async activate(input: {
    user: CheckoutUser;
    dto: CheckoutDto;
    quote: QuoteResult;
    cycle: PricingCycle;
    installmentCount: number;
    terms: CurrentTerms;
    contractor: ResolvedContractor;
    sessionUser: { id: string; name: string; email: string };
    reservedId: string;
    contract: GatewayContract;
    asaasCustomerId: string;
    meta: RequestMeta;
  }) {
    const { user, dto, quote, terms, contractor, sessionUser, contract, meta } =
      input;
    const reserved = { id: input.reservedId };
    const installment = contract.billingMode === 'ASAAS_INSTALLMENT';

    const { payment, acceptance } = await this.prisma.$transaction(
      async (tx) => {
        const now = new Date();
        await tx.subscription.update({
          where: { id: reserved.id },
          data: {
            // O parcelado não tem assinatura no Asaas: o id local o marca.
            asaasSubscriptionId:
              contract.asaasSubscriptionId ??
              `${INSTALLMENT_SUBSCRIPTION_PREFIX}${reserved.id}`,
            asaasInstallmentId: contract.asaasInstallmentId,
            billingMode: contract.billingMode,
            installmentCount: installment ? input.installmentCount : null,
            nextDueDate: contract.nextDueDate,
            status: 'ACTIVE',
            contractedAt: now,
          },
        });

        const trial = await tx.subscription.findFirst({
          where: {
            companyId: user.companyId,
            status: 'ACTIVE',
            plan: { planType: 'TRIAL' },
          },
        });
        if (trial) {
          await tx.subscription.update({
            where: { id: trial.id },
            data: { status: 'INACTIVE' },
          });
          await tx.subscriptionHistory.create({
            data: {
              subscriptionId: trial.id,
              action: 'DEACTIVATED',
              description: 'Teste encerrado pela contratação',
              changes: {
                before: { status: 'ACTIVE' },
                after: { status: 'INACTIVE' },
              },
              metadata: { newSubscriptionId: reserved.id },
              createdBy: user.userId,
              createdByName: sessionUser.name,
            },
          });
        }

        const [payment] = await recordContractCharges(tx, this.asaasGateway, {
          subscriptionId: reserved.id,
          asaasCustomerId: input.asaasCustomerId,
          billingType: dto.billingType,
          cycle: input.cycle,
          quote,
          contract,
          kind: 'CONTRACT',
          now,
        });

        await tx.subscriptionHistory.create({
          data: {
            subscriptionId: reserved.id,
            action: 'CONTRACTED',
            description:
              'Contratação registrada; acesso liberado com o pagamento em aberto',
            metadata: {
              paymentId: payment.asaasPaymentId,
              cycle: input.cycle,
              totalCents: quote.totalCents,
              recurringCents: quote.recurringCents,
              ...(installment
                ? {
                    installmentCount: input.installmentCount,
                    asaasInstallmentId: contract.asaasInstallmentId,
                  }
                : {}),
            },
            createdBy: user.userId,
            createdByName: sessionUser.name,
          },
        });

        const acceptance = await this.acceptance.record(tx, {
          terms,
          companyId: user.companyId,
          subscriptionId: reserved.id,
          context: 'NEW_CONTRACT',
          acceptedBy: {
            userId: sessionUser.id,
            name: sessionUser.name,
            email: sessionUser.email,
          },
          contractor,
          representative: contractor.representative,
          registrySnapshot: contractor.registrySnapshot,
          ipAddress: meta.ip ?? null,
          userAgent: meta.userAgent ?? null,
        });

        // "Sou eu quem responde pela empresa": o CPF vai para o cadastro de
        // quem contratou — é onde ele fica desde que saiu do cadastro da
        // conta. Não sobrescreve um CPF já informado.
        if (contractor.representative?.isSessionUser) {
          await tx.employee.updateMany({
            where: {
              companyId: user.companyId,
              userId: user.userId,
              cpf: null,
            },
            data: { cpf: contractor.representative.cpf },
          });
        }

        // Contas antigas sem titular: quem contrata passa a sê-lo.
        await tx.company.updateMany({
          where: { id: user.companyId, ownerUserId: null },
          data: { ownerUserId: user.userId },
        });

        return { payment, acceptance };
      },
    );

    return { payment, acceptance };
  }

  private assertQuotable(
    response: Awaited<ReturnType<SubscriptionQuoteService['quote']>>,
    dto: CheckoutDto,
  ): QuoteResult {
    if (response.intent === 'REGULARIZATION') {
      throw new ConflictException({
        code: 'REGULARIZATION_REQUIRED',
        message:
          'Há uma cobrança em aberto. Regularize-a antes de uma nova contratação.',
      });
    }
    // Quem já tem plano evolui (POST /subscriptions/evolution) ou inclui
    // complementos: a contratação nova não substitui uma assinatura em curso.
    if (response.intent === 'EVOLUTION') {
      throw new UnprocessableEntityException({
        code: 'EVOLUTION_NOT_AVAILABLE',
        message:
          'Você já tem um plano contratado. Para evoluir ou incluir complementos, use a página de planos.',
      });
    }
    if (!response.eligible || !response.quote) {
      throw new UnprocessableEntityException({
        code: 'PLAN_NOT_AVAILABLE',
        reason: response.ineligibilityReason,
        message: 'Este plano não está disponível para contratação.',
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
    if (quote.totalCents < MIN_CHARGE_CENTS) {
      throw new UnprocessableEntityException({
        code: 'TOTAL_BELOW_GATEWAY_MINIMUM',
        message:
          'O valor da primeira cobrança ficou abaixo do mínimo aceito pelo meio de pagamento.',
      });
    }
    return quote;
  }

  /**
   * Quem contrata e quem responde pela empresa.
   *
   * Empresa: o CNPJ é confirmado pela consulta pública, e o CPF do
   * representante é conferido contra o quadro societário quando ele existe —
   * não conferindo, a contratação não segue. Sem quadro para conferir, o CPF
   * é aceito com o nome informado, e o aceite registra que não houve
   * conferência.
   */
  private async resolveContractor(
    user: CheckoutUser,
    dto: CheckoutDto,
  ): Promise<ResolvedContractor> {
    const c = dto.contractor;
    const email = c.email.trim().toLowerCase();

    if (c.type === 'PF') {
      return {
        type: 'PF',
        document: String(c.cpf).replace(/\D/g, ''),
        name: String(c.name).trim(),
        tradeName: null,
        email,
        representative: null,
        registrySnapshot: null,
      };
    }

    const cnpj = String(c.cnpj).replace(/\D/g, '');
    const rep = dto.representative;
    if (!rep) {
      throw new UnprocessableEntityException({
        code: 'REPRESENTATIVE_REQUIRED',
        message: 'Informe o CPF de quem responde legalmente pela empresa.',
      });
    }

    let record = null;
    try {
      record = await this.registry.lookup(cnpj);
    } catch (error) {
      // Base pública fora do ar não impede a contratação: segue com os dados
      // informados, sem conferência.
      this.logger.warn(`CNPJ ${cnpj} sem consulta: ${error.message}`);
    }

    const legalName = record?.legalName ?? c.legalName?.trim();
    if (!legalName) {
      throw new UnprocessableEntityException({
        code: 'LEGAL_NAME_REQUIRED',
        message: 'Informe a razão social da empresa.',
      });
    }

    const cpf = rep.cpf.replace(/\D/g, '');
    const verdict = record
      ? verifyRepresentative(record.partners, cpf)
      : ({ status: 'UNVERIFIABLE' } as const);

    if (verdict.status === 'NOT_IN_REGISTRY') {
      throw new UnprocessableEntityException({
        code: 'REPRESENTATIVE_NOT_IN_REGISTRY',
        message:
          'Este CPF não consta como representante legal desta empresa no registro público.',
      });
    }

    let representativeName: string;
    if (verdict.status === 'VERIFIED') {
      // O nome é o que o registro publica, não o que a pessoa digitaria.
      representativeName = verdict.name;
    } else {
      representativeName = rep.name?.trim() ?? '';
      if (representativeName.length < 2) {
        throw new UnprocessableEntityException({
          code: 'REPRESENTATIVE_NAME_REQUIRED',
          message: 'Informe o nome de quem responde legalmente pela empresa.',
        });
      }
    }

    return {
      type: 'PJ',
      document: cnpj,
      name: legalName,
      tradeName: record?.tradeName ?? c.tradeName?.trim() ?? null,
      email,
      representative: {
        cpf,
        name: representativeName,
        verified: verdict.status === 'VERIFIED',
        isSessionUser: rep.isSelf,
      },
      // Só o que sustentou a conferência — não o quadro inteiro.
      registrySnapshot: record
        ? {
            source: 'brasilapi',
            fetchedAt: record.fetchedAt,
            legalName: record.legalName,
            registrationStatus: record.registrationStatus,
            verification: verdict.status,
            ...(verdict.status === 'VERIFIED'
              ? { qualification: verdict.qualification }
              : {}),
          }
        : { source: 'none', verification: 'UNVERIFIABLE' },
    };
  }

  /**
   * O cliente de cobrança acompanha quem contrata: se a empresa já tem um no
   * Asaas, seus dados são atualizados para o contratante atual.
   */
  private async provisionCustomer(
    companyId: string,
    contractor: ResolvedContractor,
  ) {
    const data = {
      name: contractor.name,
      cpfCnpj: contractor.document,
      email: contractor.email,
    };
    const existing = await this.prisma.customer.findFirst({
      where: { companyId },
    });

    try {
      if (existing?.asaasCustomerId?.startsWith('cus_')) {
        await this.asaasGateway.updateAsaasCustomer(
          existing.asaasCustomerId,
          data,
        );
        return this.prisma.customer.update({
          where: { id: existing.id },
          data: {
            name: data.name,
            document: data.cpfCnpj,
            email: data.email,
          },
        });
      }

      const created = await this.asaasGateway.createAsaasCustomer({
        ...data,
        externalReference: existing?.id ?? companyId,
      });
      if (existing) {
        return this.prisma.customer.update({
          where: { id: existing.id },
          data: {
            asaasCustomerId: created.id,
            name: data.name,
            document: data.cpfCnpj,
            email: data.email,
          },
        });
      }
      return this.prisma.customer.create({
        data: {
          name: data.name,
          email: data.email,
          document: data.cpfCnpj,
          asaasCustomerId: created.id,
          companyId,
        },
      });
    } catch (error) {
      // Recusa do gateway sobre os dados do cliente é erro de entrada.
      throw new BadRequestException({
        code: 'CUSTOMER_REJECTED',
        message:
          error.message ||
          'O meio de pagamento recusou os dados do contratante.',
      });
    }
  }

  /** Passo 1: a reserva local, sob trava da empresa. */
  private async reserve(input: {
    user: CheckoutUser;
    dto: CheckoutDto;
    quote: QuoteResult;
    cycle: PricingCycle;
    customerId: string;
    planId: string;
    features: { id: string; price: number }[];
    coupon: { id: string; discountType: any } | null;
    firstDueDate: Date;
  }) {
    const { user, dto, quote, coupon } = input;
    return this.prisma.$transaction(async (tx) => {
      // Duas contratações simultâneas da mesma empresa (duplo clique, duas
      // abas) se enfileiram aqui, e a segunda encontra a primeira.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`checkout:${user.companyId}`}))`;

      const inFlight = await tx.subscription.findFirst({
        where: {
          companyId: user.companyId,
          plan: { planType: { not: 'TRIAL' } },
          OR: [
            { status: 'ACTIVE' },
            {
              status: 'INACTIVE',
              payments: { some: { status: { in: ['PENDING', 'OVERDUE'] } } },
            },
            {
              status: 'INACTIVE',
              asaasSubscriptionId: { startsWith: 'temp_' },
              createdAt: { gte: new Date(Date.now() - IN_FLIGHT_WINDOW_MS) },
            },
          ],
        },
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
          // O valor da assinatura é o da renovação; o desconto da primeira
          // cobrança fica registrado em discountValue.
          value: quote.recurringCents / 100,
          status: 'INACTIVE',
          couponId: coupon?.id ?? null,
          couponCode: coupon ? (quote.coupon?.code ?? null) : null,
          discountValue: coupon ? quote.couponDiscountCents : null,
          discountType: coupon?.discountType ?? null,
          recurringValueCents: quote.recurringCents,
          evolutionCreditCents: quote.creditCents || null,
          pricingSnapshot: {
            engine: 'pricing.engine/v1',
            source: 'checkout',
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
}
