import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { AsaasGatewayService } from './asaas-gateway.service';
import { addCalendarCycle } from './pricing/pricing.engine';
import { successUrl } from './checkout/contracting-steps';

const DAY_MS = 86_400_000;

type DueSubscription = Prisma.SubscriptionGetPayload<{
  include: { customer: true; plan: true };
}>;

export interface InstallmentRenewalResult {
  subscriptionId: string;
  action: 'renewed' | 'skipped' | 'failed';
  reason?: string;
  asaasInstallmentId?: string;
}

const toAsaasDate = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Renovação do anual parcelado no cartão.
 *
 * O Asaas não parcela assinatura: cada ano do anual em parcelas é uma cobrança
 * parcelada, e o parcelamento do ano seguinte é criado aqui, alguns dias antes
 * do fim do ano pago — como o Asaas faz com as assinaturas recorrentes. A
 * primeira parcela vence no fim do ano pago e é paga pela fatura, como na
 * contratação. O valor é o da renovação, sem cupom nem crédito.
 *
 * Idempotente pela referência externa (assinatura + data da renovação): se uma
 * execução criou o parcelamento e caiu antes de registrá-lo, a seguinte o
 * encontra no Asaas e só o registra — sem cobrar duas vezes.
 */
@Injectable()
export class InstallmentRenewalService {
  private readonly logger = new Logger(InstallmentRenewalService.name);

  /** Com quantos dias de antecedência o parcelamento do ano seguinte é criado. */
  static readonly LEAD_DAYS = 10;

  constructor(
    private readonly prisma: PrismaService,
    private readonly asaasGateway: AsaasGatewayService,
  ) {}

  @Cron('0 6 * * *', {
    name: 'installment-renewal',
    timeZone: 'America/Sao_Paulo',
  })
  async handleCron(): Promise<void> {
    const results = await this.renewDue();
    const renewed = results.filter((r) => r.action === 'renewed').length;
    if (results.length > 0) {
      this.logger.log(
        `Renovação do anual parcelado: ${renewed} de ${results.length} renovada(s)`,
      );
    }
  }

  async renewDue(now: Date = new Date()): Promise<InstallmentRenewalResult[]> {
    const horizon = new Date(
      now.getTime() + InstallmentRenewalService.LEAD_DAYS * DAY_MS,
    );
    const due = await this.prisma.subscription.findMany({
      where: {
        billingMode: 'ASAAS_INSTALLMENT',
        status: 'ACTIVE',
        nextDueDate: { lte: horizon },
      },
      include: { customer: true, plan: true },
    });

    const results: InstallmentRenewalResult[] = [];
    for (const subscription of due) {
      try {
        results.push(await this.renew(subscription, now));
      } catch (error) {
        this.logger.error(
          `Renovação do anual da assinatura ${subscription.id} falhou: ${error.message}`,
        );
        results.push({
          subscriptionId: subscription.id,
          action: 'failed',
          reason: error.message,
        });
      }
    }
    return results;
  }

  private async renew(
    subscription: DueSubscription,
    now: Date,
  ): Promise<InstallmentRenewalResult> {
    const skip = (reason: string): InstallmentRenewalResult => {
      this.logger.warn(
        `Renovação do anual da assinatura ${subscription.id} adiada: ${reason}`,
      );
      return { subscriptionId: subscription.id, action: 'skipped', reason };
    };

    const customerId = subscription.customer?.asaasCustomerId;
    if (!customerId?.startsWith('cus_')) return skip('NO_BILLING_ACCOUNT');
    if (!subscription.installmentCount) return skip('NO_INSTALLMENT_COUNT');

    // O ano em curso precisa estar pago: com parcela em aberto, a tarefa é a
    // regularização, e o bloqueio por atraso segue a régua de sempre.
    if (subscription.asaasInstallmentId) {
      const current = await this.asaasGateway.getInstallmentPayments(
        subscription.asaasInstallmentId,
      );
      const today = toAsaasDate(now);
      const open = current.some(
        (p) =>
          p.status === 'OVERDUE' ||
          (p.status === 'PENDING' && String(p.dueDate) < today),
      );
      if (open) return skip('OPEN_CHARGE');
    }

    const periodStart = subscription.nextDueDate;
    const periodEnd = addCalendarCycle(periodStart, 'YEARLY');
    const recurringCents =
      subscription.recurringValueCents ?? Math.round(subscription.value * 100);
    const reference = `${subscription.id}:${toAsaasDate(periodStart)}`;

    // Idempotência: a execução anterior pode ter criado e caído antes de
    // registrar.
    const existing =
      await this.asaasGateway.findPaymentsByExternalReference(reference);
    let installmentId: string | null =
      existing.find((p) => p.installment)?.installment ?? null;
    if (!installmentId) {
      const first = await this.asaasGateway.createInstallmentCharge({
        customer: customerId,
        billingType: 'CREDIT_CARD',
        dueDate: toAsaasDate(periodStart),
        installmentCount: subscription.installmentCount,
        totalValue: recurringCents / 100,
        description: `Renovação anual ${subscription.plan.name}`,
        externalReference: reference,
        callback: { successUrl: successUrl() },
      });
      installmentId = first?.installment ?? null;
      if (!installmentId) {
        throw new Error('O Asaas não devolveu o parcelamento criado');
      }
    }
    const charges =
      await this.asaasGateway.getInstallmentPayments(installmentId);

    await this.prisma.$transaction(async (tx) => {
      for (const [index, charge] of charges.entries()) {
        const known = await tx.payment.findUnique({
          where: { asaasPaymentId: charge.id },
          select: { id: true },
        });
        if (known) continue;
        await tx.payment.create({
          data: {
            subscriptionId: subscription.id,
            asaasPaymentId: charge.id,
            asaasCustomerId: customerId,
            value: charge.value,
            dueDate: new Date(charge.dueDate),
            billingType: 'CREDIT_CARD',
            description: charge.description,
            externalReference: charge.id,
            status: this.asaasGateway.mapAsaasPaymentStatus(charge.status),
            invoiceUrl: charge.invoiceUrl,
            bankSlipUrl: charge.bankSlipUrl,
            // Todas as parcelas pagam o mesmo período: o ano da renovação.
            periodStart,
            periodEnd,
            kind: 'RENEWAL',
            asaasInstallmentId: installmentId,
            installmentNumber: charge.installmentNumber ?? index + 1,
          },
        });
      }

      await tx.subscription.update({
        where: { id: subscription.id },
        data: { asaasInstallmentId: installmentId, nextDueDate: periodEnd },
      });

      await tx.subscriptionHistory.create({
        data: {
          subscriptionId: subscription.id,
          action: 'RENEWAL_CREATED',
          description: `Renovação anual em ${subscription.installmentCount}x criada; a primeira parcela vence em ${periodStart.toLocaleDateString('pt-BR', { timeZone: 'UTC' })}`,
          metadata: {
            asaasInstallmentId: installmentId,
            periodStart: periodStart.toISOString(),
            periodEnd: periodEnd.toISOString(),
            totalCents: recurringCents,
            installmentCount: subscription.installmentCount,
          },
          createdByName: 'Sistema',
        },
      });
    });

    return {
      subscriptionId: subscription.id,
      action: 'renewed',
      asaasInstallmentId: installmentId,
    };
  }
}
