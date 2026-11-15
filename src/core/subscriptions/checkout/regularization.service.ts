import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { AsaasGatewayService } from '../asaas-gateway.service';
import { SubscriptionQuoteService } from '../pricing/subscription-quote.service';
import {
  CHECKOUT_BILLING_TYPES,
  CheckoutBillingType,
  RegularizationDto,
} from '../dto/checkout.dto';
import { isInstallmentBilling } from '../billing-mode';
import { ContractAcceptanceService } from './contract-acceptance.service';
import { CompanySessionService } from './company-session.service';
import { CheckoutUser, RequestMeta } from './checkout.service';
import {
  assertTermsAccepted,
  contractorOnFile,
  representativeOnFile,
} from './contracting-steps';

export type RegularizationReason =
  | 'FIRST_CHARGE_PENDING'
  | 'OVERDUE'
  | 'CHECKOUT_PENDING'
  | 'EVOLUTION_PENDING';

/**
 * Regularização de uma cobrança em aberto.
 *
 * Não cria assinatura nem cobrança nova: reemite a cobrança em aberto, com a
 * forma de pagamento escolhida e, se estiver vencida, com vencimento hoje. O
 * plano e o ciclo são os da assinatura, o contratante aparece em leitura, não
 * há crédito — e o aceite dos Termos é pedido de novo, como em toda
 * contratação.
 */
@Injectable()
export class RegularizationService {
  private readonly logger = new Logger(RegularizationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly asaasGateway: AsaasGatewayService,
    private readonly quoteService: SubscriptionQuoteService,
    private readonly acceptance: ContractAcceptanceService,
    private readonly session: CompanySessionService,
  ) {}

  async view(companyId: string) {
    if (!companyId) {
      throw new BadRequestException(
        'Regularização disponível apenas para usuários de uma empresa.',
      );
    }
    const ctx = await this.quoteService.getBillingContext(companyId);
    if (!ctx.hasOpenCharge || !ctx.current) return { required: false as const };

    // A contratação que espera o pagamento é CHECKOUT_PENDING mesmo com a
    // primeira cobrança vencida: não há mensalidade atrasada de um plano que
    // nem foi liberado. Dívida do plano em curso vem antes da evolução.
    const reason: RegularizationReason = ctx.firstChargePending
      ? 'FIRST_CHARGE_PENDING'
      : ctx.hasOverdue && !ctx.awaitingActivation
        ? 'OVERDUE'
        : ctx.evolutionPending
          ? 'EVOLUTION_PENDING'
          : 'CHECKOUT_PENDING';
    // Na evolução à espera do pagamento, o plano, o ciclo e o valor são os
    // dela, e é nela que o aceite fica.
    const target =
      reason === 'EVOLUTION_PENDING' && ctx.pendingEvolution
        ? ctx.pendingEvolution
        : ctx.current;

    const [session, terms, lastAcceptance, customer] = await Promise.all([
      this.session.build(companyId),
      this.acceptance.currentTerms(),
      this.prisma.contractAcceptance.findFirst({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.customer.findUnique({
        where: { id: target.customerId },
      }),
    ]);

    const contractor = contractorOnFile(lastAcceptance, customer);

    return {
      required: true as const,
      reason,
      situation: session.billing.situation,
      daysOverdue: session.billing.daysOverdue,
      subscription: {
        id: target.id,
        planName: target.plan.name,
        cycle: target.cycle,
        billingType: target.billingType,
        valueCents: Math.round(target.value * 100),
        installmentCount: target.installmentCount ?? null,
      },
      contractor,
      chargeInFocus: session.billing.chargeInFocus,
      // O anual parcelado é pago no cartão: uma parcela em Pix deixaria as
      // outras sem cartão para cobrar.
      allowedBillingTypes: isInstallmentBilling(target)
        ? (['CREDIT_CARD'] as CheckoutBillingType[])
        : [...CHECKOUT_BILLING_TYPES],
      terms: { id: terms.id, version: terms.version },
      lastAcceptance,
    };
  }

  async pay(user: CheckoutUser, dto: RegularizationDto, meta: RequestMeta) {
    if (!user.isAdmin) {
      throw new ForbiddenException(
        'Somente administradores da empresa podem regularizar a cobrança.',
      );
    }

    const view = await this.view(user.companyId);
    if (!view.required || !view.chargeInFocus || !view.contractor) {
      throw new ConflictException({
        code: 'NOTHING_TO_REGULARIZE',
        message: 'Não há cobrança em aberto para regularizar.',
      });
    }

    const terms = await this.acceptance.currentTerms();
    assertTermsAccepted(dto.termsAcceptance, terms);

    if (!view.allowedBillingTypes.includes(dto.billingType)) {
      throw new UnprocessableEntityException({
        code: 'BILLING_TYPE_NOT_ALLOWED',
        message: 'O plano anual parcelado é pago no cartão de crédito.',
      });
    }

    const focus = view.chargeInFocus;
    const today = new Date().toISOString().split('T')[0];
    const dueDay = focus.dueDate.slice(0, 10);
    const update: { billingType?: string; dueDate?: string } = {};
    if (dto.billingType !== focus.billingType) {
      update.billingType = dto.billingType;
    }
    // Vencida: reemite para hoje, em vez de exigir juros de uma fatura velha.
    if (dueDay < today) update.dueDate = today;

    let invoiceUrl = focus.invoiceUrl;
    if (Object.keys(update).length > 0) {
      try {
        const updated = await this.asaasGateway.updateAsaasPayment(
          focus.asaasPaymentId,
          update,
        );
        invoiceUrl = updated?.invoiceUrl ?? invoiceUrl;
      } catch (error) {
        this.logger.error(
          `Regularização da empresa ${user.companyId} falhou no gateway: ${error.message}`,
        );
        throw new BadGatewayException({
          code: 'GATEWAY_ERROR',
          message:
            'Não foi possível reemitir a cobrança agora. Tente novamente em instantes.',
        });
      }

      const pix =
        dto.billingType === 'PIX'
          ? await this.asaasGateway.getPixQrCode(focus.asaasPaymentId)
          : null;

      // Reemitir não é pagar. Para quem já tem o plano liberado, a cobrança
      // fica no banco com o vencimento de antes: é dele que o atraso conta, e
      // a empresa só é desbloqueada com o pagamento. Com o vencimento de hoje,
      // a conta parecia em dia, era desbloqueada sem pagar e voltava para
      // Ativas no superadmin. Na contratação que espera o pagamento, que não
      // libera nada, o vencimento novo vale aqui também, como antes.
      const keepsDebtDate =
        view.reason === 'OVERDUE' || view.reason === 'FIRST_CHARGE_PENDING';

      await this.prisma.payment.updateMany({
        where: { asaasPaymentId: focus.asaasPaymentId },
        data: {
          billingType: dto.billingType,
          ...(update.dueDate
            ? {
                ...(keepsDebtDate ? {} : { dueDate: new Date(update.dueDate) }),
                status: 'PENDING',
              }
            : {}),
          invoiceUrl,
          ...(pix
            ? {
                pixQrCode: pix.encodedImage ?? null,
                pixCopyPaste: pix.payload ?? null,
              }
            : {}),
        },
      });
    }

    const sessionUser = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.userId },
      select: { id: true, name: true, email: true },
    });

    await this.prisma.$transaction(async (tx) => {
      await this.acceptance.record(tx, {
        terms,
        companyId: user.companyId,
        subscriptionId: view.subscription.id,
        context: 'REGULARIZATION',
        acceptedBy: {
          userId: sessionUser.id,
          name: sessionUser.name,
          email: sessionUser.email,
        },
        contractor: {
          type: view.contractor.type,
          document: view.contractor.document,
          name: view.contractor.name,
          tradeName: view.contractor.tradeName,
          email: view.contractor.email,
        },
        // O representante é o do último aceite: a regularização não muda
        // quem responde pela empresa.
        representative: representativeOnFile(view.lastAcceptance, user.userId),
        ipAddress: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      });

      await tx.subscriptionHistory.create({
        data: {
          subscriptionId: view.subscription.id,
          action: 'REGULARIZATION_STARTED',
          description: 'Cobrança em aberto reemitida para regularização',
          metadata: {
            paymentId: focus.asaasPaymentId,
            billingType: dto.billingType,
            dueDate: update.dueDate ?? dueDay,
            originalDueDate: dueDay,
          },
          createdBy: user.userId,
          createdByName: sessionUser.name,
        },
      });
    });

    const session = await this.session
      .build(user.companyId, user.userId)
      .catch(() => null);

    return { paymentUrl: invoiceUrl, session };
  }
}
