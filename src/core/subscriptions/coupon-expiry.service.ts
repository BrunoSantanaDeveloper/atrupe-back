import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { AsaasGatewayService } from './asaas-gateway.service';

/**
 * Até quando o cupom abate: o dia do uso mais a duração. `null` quando não
 * acaba (desconto recorrente).
 */
export function couponEndsAt(
  coupon: { durationType: string; durationMonths: number | null },
  appliedAt: Date,
): Date | null {
  if (coupon.durationType === 'RECURRING') return null;
  const months =
    coupon.durationType === 'MONTHS' ? coupon.durationMonths || 1 : 1;
  const end = new Date(appliedAt);
  end.setMonth(end.getMonth() + months);
  return end;
}

/**
 * O fim do desconto das assinaturas ANTIGAS, em que o cupom foi embutido no
 * valor recorrente do Asaas. As contratações novas nascem com o valor cheio —
 * o cupom abate só a primeira cobrança (`recurringValueCents` preenchido) — e
 * não passam por aqui.
 *
 * Vale pela data (o uso do cupom mais a duração). Contar pagamentos, como era,
 * dependia do webhook e somava os de antes do cupom: um cupom aplicado a uma
 * assinatura antiga expirava no pagamento seguinte, e sem webhook nunca
 * expirava. Roda todo dia e a cada pagamento confirmado.
 */
@Injectable()
export class CouponExpiryService {
  private readonly logger = new Logger(CouponExpiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly asaasGateway: AsaasGatewayService,
  ) {}

  @Cron('30 3 * * *', {
    name: 'coupon-expiry',
    timeZone: 'America/Sao_Paulo',
  })
  async handleCron(): Promise<void> {
    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        status: 'ACTIVE',
        couponId: { not: null },
        recurringValueCents: null,
      },
      select: { id: true },
    });
    for (const { id } of subscriptions) {
      try {
        await this.expireIfDue(id);
      } catch (error) {
        this.logger.error(
          `Cupom da assinatura ${id} não encerrado: ${error.message}`,
        );
      }
    }
  }

  /** Encerra o desconto se o prazo já acabou. Diz se restaurou o preço. */
  async expireIfDue(
    subscriptionId: string,
    now: Date = new Date(),
  ): Promise<boolean> {
    const sub = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        coupon: true,
        plan: true,
        subscriptionFeatures: { where: { isActive: true } },
      },
    });
    if (
      !sub ||
      !sub.coupon ||
      sub.recurringValueCents != null ||
      sub.status !== 'ACTIVE' ||
      !sub.asaasSubscriptionId.startsWith('sub_')
    ) {
      return false;
    }

    const usage = await this.prisma.couponUsage.findFirst({
      where: {
        couponId: sub.coupon.id,
        OR: [
          { subscriptionId: sub.id },
          { subscriptionId: null, companyId: sub.companyId ?? undefined },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
    const endsAt = couponEndsAt(sub.coupon, usage?.createdAt ?? sub.createdAt);
    if (!endsAt || now < endsAt) return false;

    const fullCents =
      Math.round(sub.plan.basePrice) +
      sub.subscriptionFeatures.reduce(
        (sum, f) => sum + Math.round(f.price || 0),
        0,
      ) +
      Math.round(sub.plan.additionalUserPrice || 0) *
        (sub.additionalUsers || 0);
    const fullPrice = fullCents / 100;

    // A assinatura e as mensalidades já geradas que vencem depois do fim do
    // desconto; as de antes seguem com ele, como prometido.
    await this.asaasGateway.updateAsaasSubscription(sub.asaasSubscriptionId, {
      value: fullPrice,
      updatePendingPayments: false,
    });
    const endsDay = endsAt.toISOString().slice(0, 10);
    const renewals = (
      await this.asaasGateway.getAsaasSubscriptionPayments(
        sub.asaasSubscriptionId,
      )
    ).filter(
      (p) =>
        p.status === 'PENDING' &&
        String(p.dueDate) >= endsDay &&
        Math.round(Number(p.value) * 100) !== fullCents,
    );
    for (const renewal of renewals) {
      await this.asaasGateway.updateAsaasPayment(renewal.id, {
        value: fullPrice,
      });
    }

    const until = endsAt.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
    await this.prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id: sub.id },
        data: { value: fullPrice, couponId: null },
      });
      for (const renewal of renewals) {
        await tx.payment.updateMany({
          where: { asaasPaymentId: renewal.id },
          data: { value: fullPrice },
        });
      }
      await tx.subscriptionHistory.create({
        data: {
          subscriptionId: sub.id,
          action: 'COUPON_EXPIRED',
          description: `Cupom ${sub.coupon.code} encerrado em ${until}. Valor restaurado para R$ ${fullPrice.toFixed(2).replace('.', ',')}.`,
          metadata: {
            couponCode: sub.coupon.code,
            endsAt: endsAt.toISOString(),
            originalValue: sub.value,
            newValue: fullPrice,
            renewalsUpdated: renewals.map((r) => r.id),
          },
          createdByName: 'Sistema',
        },
      });
    });
    this.logger.log(
      `Cupom ${sub.coupon.code} da assinatura ${sub.id} encerrado: valor restaurado para R$ ${fullPrice}.`,
    );
    return true;
  }
}
