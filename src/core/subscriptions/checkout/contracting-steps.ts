import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { AsaasGatewayService } from '../asaas-gateway.service';
import {
  addCalendarCycle,
  PricingCycle,
  QuoteResult,
} from '../pricing/pricing.engine';
import { annualCycleEnabled } from '../billing-mode';
import { CurrentTerms } from './contract-acceptance.service';

/**
 * Passos comuns às contratações que abrem cobrança no Asaas: a contratação
 * nova e a evolução de plano.
 */

/** Abaixo disso o Asaas não emite cobrança (a confirmar no sandbox). */
export const MIN_CHARGE_CENTS = 500;
/** Primeira cobrança vence em dois dias, como já é hoje. */
export const FIRST_DUE_DAYS = 2;
/** Uma contratação temporária mais nova que isto ainda está em curso. */
export const IN_FLIGHT_WINDOW_MS = 10 * 60 * 1000;

export interface ContractingUser {
  userId: string;
  companyId: string;
  isAdmin: boolean;
}

/** Contratar, evoluir e incluir complementos exigem administrador. */
export function assertCanContract(
  user: ContractingUser,
  message = 'Somente administradores da empresa podem contratar.',
) {
  if (!user.companyId) {
    throw new BadRequestException(
      'Contratação disponível apenas para usuários de uma empresa.',
    );
  }
  if (!user.isAdmin) {
    throw new ForbiddenException(message);
  }
}

/** O anual só é contratável com a chave ligada (ver billing-mode.ts). */
export function assertCycleAvailable(cycle: PricingCycle) {
  if (cycle === 'YEARLY' && !annualCycleEnabled()) {
    throw new UnprocessableEntityException({
      code: 'CYCLE_NOT_AVAILABLE',
      message: 'O pagamento anual ainda não está disponível.',
    });
  }
}

/** O número de parcelas pedido precisa ser um dos que o orçamento oferece. */
export function assertInstallments(
  quote: Pick<QuoteResult, 'installments'>,
  installmentCount: number,
) {
  if (installmentCount <= 1) return;
  if (
    !quote.installments.allowed ||
    quote.installments.selected !== installmentCount
  ) {
    throw new UnprocessableEntityException({
      code: 'INSTALLMENTS_NOT_AVAILABLE',
      message:
        'O parcelamento só existe no pagamento anual no cartão, em até 12 vezes.',
    });
  }
}

/** Aceitar uma versão que não é a vigente não é aceitar o contrato vigente. */
export function assertTermsAccepted(
  acceptance: { contractId: string; version: number; accepted: boolean } | null,
  terms: CurrentTerms,
) {
  if (!acceptance?.accepted) {
    throw new UnprocessableEntityException({
      code: 'TERMS_REQUIRED',
      message: 'Leia e aceite os Termos de Contratação para continuar.',
    });
  }
  if (
    acceptance.contractId !== terms.id ||
    acceptance.version !== terms.version
  ) {
    throw new ConflictException({
      code: 'TERMS_OUTDATED',
      message:
        'Os Termos de Contratação foram atualizados. Leia a versão vigente e aceite novamente.',
      contract: { id: terms.id, version: terms.version },
    });
  }
}

/** Para onde o Asaas devolve quem pagou. Vem do servidor, não do navegador. */
export function successUrl(): string {
  const base = (
    process.env.FRONTEND_URL || 'https://app.atrupe.com.br'
  ).replace(/\/+$/, '');
  return `${base}/assinatura/concluir`;
}

/**
 * A primeira cobrança que o Asaas gerou para a assinatura, com o valor
 * ajustado quando há cupom ou crédito. A assinatura em si fica com o valor
 * cheio: é ele que se repete nas renovações.
 */
export async function adjustFirstCharge(
  gateway: AsaasGatewayService,
  asaasSubscriptionId: string,
  quote: Pick<QuoteResult, 'totalCents' | 'recurringCents'>,
) {
  const payments =
    await gateway.getAsaasSubscriptionPayments(asaasSubscriptionId);
  const first = payments?.[0];
  if (!first) {
    throw new Error('O Asaas não gerou a primeira cobrança da assinatura');
  }
  if (quote.totalCents === quote.recurringCents) return first;

  const updated = await gateway.updateAsaasPayment(first.id, {
    value: quote.totalCents / 100,
  });
  return { ...first, ...updated };
}

export type ContractBillingMode = 'ASAAS_SUBSCRIPTION' | 'ASAAS_INSTALLMENT';

/** Parcelar só existe no anual, no cartão, em mais de uma vez. */
export function contractBillingMode(
  cycle: PricingCycle,
  billingType: string,
  installmentCount: number,
): ContractBillingMode {
  return cycle === 'YEARLY' &&
    billingType === 'CREDIT_CARD' &&
    installmentCount > 1
    ? 'ASAAS_INSTALLMENT'
    : 'ASAAS_SUBSCRIPTION';
}

/** O que uma contratação abriu no Asaas. */
export interface GatewayContract {
  billingMode: ContractBillingMode;
  /** A assinatura recorrente; nula no parcelado. */
  asaasSubscriptionId: string | null;
  /** O parcelamento; nulo no recorrente, ou quando nada é cobrado agora. */
  asaasInstallmentId: string | null;
  /** Quando vence a cobrança seguinte ao que é cobrado agora. */
  nextDueDate: Date;
  /** O que se cobra agora: a primeira cobrança, ou todas as parcelas. */
  charges: any[];
  pix: { encodedImage?: string; payload?: string } | null;
}

const toAsaasDate = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Abre no Asaas a cobrança de uma contratação — a assinatura recorrente, ou o
 * parcelamento do anual no cartão, que o Asaas não faz por assinatura.
 *
 * A assinatura nasce com o valor CHEIO da renovação e a primeira cobrança é
 * ajustada ao total com cupom e crédito. O parcelamento é o total do ano já
 * com os descontos; o do ano seguinte, a renovação cria.
 *
 * Falhando no meio, desfaz o que abriu antes de relançar: nada fica cobrando
 * sem contratação registrada por trás.
 */
export async function openGatewayContract(
  gateway: AsaasGatewayService,
  logger: Logger,
  input: {
    customer: string;
    billingType: string;
    cycle: PricingCycle;
    installmentCount: number;
    quote: Pick<QuoteResult, 'totalCents' | 'recurringCents'>;
    /** Falso quando o crédito cobre a primeira cobrança inteira. */
    chargesNow: boolean;
    /** Vencimento do que se cobra agora; sem cobrança, o do ciclo seguinte. */
    firstDueDate: Date;
    description: string;
    externalReference: string;
  },
): Promise<GatewayContract> {
  const billingMode = contractBillingMode(
    input.cycle,
    input.billingType,
    input.installmentCount,
  );

  if (billingMode === 'ASAAS_SUBSCRIPTION') {
    const subscription = await gateway.createSubscription({
      customer: input.customer,
      billingType: input.billingType,
      value: input.quote.recurringCents / 100,
      nextDueDate: input.firstDueDate,
      cycle: input.cycle,
      description: input.description,
      externalReference: input.externalReference,
      callback: { successUrl: successUrl() },
    });
    try {
      const first = input.chargesNow
        ? await adjustFirstCharge(gateway, subscription.id, input.quote)
        : null;
      const pix =
        first && input.billingType === 'PIX'
          ? await gateway.getPixQrCode(first.id)
          : null;
      return {
        billingMode,
        asaasSubscriptionId: subscription.id,
        asaasInstallmentId: null,
        nextDueDate: new Date(subscription.nextDueDate),
        charges: first ? [first] : [],
        pix,
      };
    } catch (error) {
      await undoGatewayContract(gateway, logger, input.externalReference, {
        asaasSubscriptionId: subscription.id,
        asaasInstallmentId: null,
      });
      throw error;
    }
  }

  // Crédito que cobre o primeiro ano: não há o que parcelar agora. O
  // parcelamento do ano seguinte a renovação cria, no vencimento.
  if (!input.chargesNow) {
    return {
      billingMode,
      asaasSubscriptionId: null,
      asaasInstallmentId: null,
      nextDueDate: input.firstDueDate,
      charges: [],
      pix: null,
    };
  }

  const first = await gateway.createInstallmentCharge({
    customer: input.customer,
    billingType: 'CREDIT_CARD',
    dueDate: toAsaasDate(input.firstDueDate),
    installmentCount: input.installmentCount,
    totalValue: input.quote.totalCents / 100,
    description: input.description,
    externalReference: input.externalReference,
    callback: { successUrl: successUrl() },
  });
  const installmentId = first?.installment ?? null;
  try {
    if (!installmentId) {
      throw new Error('O Asaas não devolveu o parcelamento criado');
    }
    const charges = await gateway.getInstallmentPayments(installmentId);
    if (charges.length !== input.installmentCount) {
      throw new Error(
        `O Asaas gerou ${charges.length} parcelas; eram esperadas ${input.installmentCount}`,
      );
    }
    return {
      billingMode,
      asaasSubscriptionId: null,
      asaasInstallmentId: installmentId,
      // A renovação vence um ano depois da primeira parcela.
      nextDueDate: addCalendarCycle(input.firstDueDate, 'YEARLY'),
      charges,
      pix: null,
    };
  } catch (error) {
    await undoGatewayContract(gateway, logger, input.externalReference, {
      asaasSubscriptionId: null,
      // Sem o id, a única referência é a primeira parcela.
      asaasInstallmentId: installmentId,
      firstPaymentId: installmentId ? null : (first?.id ?? null),
    });
    throw error;
  }
}

/** Desfaz no Asaas o que uma contratação abriu. Falhando, precisa de gente. */
export async function undoGatewayContract(
  gateway: AsaasGatewayService,
  logger: Logger,
  context: string,
  opened: {
    asaasSubscriptionId: string | null;
    asaasInstallmentId: string | null;
    firstPaymentId?: string | null;
  },
) {
  const target =
    opened.asaasSubscriptionId ??
    opened.asaasInstallmentId ??
    opened.firstPaymentId;
  if (!target) return;
  try {
    if (opened.asaasSubscriptionId) {
      await gateway.cancelAsaasSubscription(opened.asaasSubscriptionId);
    } else if (opened.asaasInstallmentId) {
      await gateway.deleteInstallment(opened.asaasInstallmentId);
    } else if (opened.firstPaymentId) {
      await gateway.deleteAsaasPayment(opened.firstPaymentId);
    }
  } catch (error) {
    logger.error(
      `RECONCILIAR: ${target} ficou aberto no Asaas após falha na contratação ${context}: ${error.message}`,
    );
  }
}

/**
 * Registra as cobranças que a contratação abriu. No parcelado, cada parcela
 * vira uma cobrança local, todas cobrindo o mesmo período — o ano que começa
 * agora —; o crédito fica na primeira, para o valor do período (a base do
 * crédito numa evolução seguinte) somar certo. Sem cobrança agora, o período
 * pago pelo crédito fica numa cobrança local de valor zero: o Asaas não emite
 * cobrança de R$ 0.
 */
export async function recordContractCharges(
  tx: Prisma.TransactionClient,
  gateway: AsaasGatewayService,
  input: {
    subscriptionId: string;
    asaasCustomerId: string;
    billingType: string;
    cycle: PricingCycle;
    quote: Pick<QuoteResult, 'totalCents' | 'creditCents'>;
    contract: GatewayContract;
    kind: 'CONTRACT' | 'EVOLUTION';
    now: Date;
  },
) {
  const { quote, contract, now } = input;
  const grossValue = (quote.totalCents + quote.creditCents) / 100;
  const creditApplied = quote.creditCents ? quote.creditCents / 100 : null;

  if (contract.charges.length === 0) {
    const payment = await tx.payment.create({
      data: {
        subscriptionId: input.subscriptionId,
        asaasPaymentId: `credit_${input.subscriptionId}`,
        asaasCustomerId: input.asaasCustomerId,
        value: 0,
        dueDate: now,
        billingType: input.billingType as any,
        description: 'Primeiro ciclo coberto pelo crédito da evolução',
        status: 'CONFIRMED',
        confirmedDate: now,
        paymentDate: now,
        periodStart: now,
        periodEnd: contract.nextDueDate,
        grossValue,
        creditApplied,
        kind: input.kind,
      },
    });
    return [payment];
  }

  const installment = contract.billingMode === 'ASAAS_INSTALLMENT';
  const payments = [];
  for (const [index, charge] of contract.charges.entries()) {
    const firstOne = index === 0;
    payments.push(
      await tx.payment.create({
        data: {
          subscriptionId: input.subscriptionId,
          asaasPaymentId: charge.id,
          asaasCustomerId: input.asaasCustomerId,
          value: charge.value,
          dueDate: new Date(charge.dueDate),
          billingType: input.billingType as any,
          description: charge.description,
          externalReference: charge.id,
          status: gateway.mapAsaasPaymentStatus(charge.status),
          invoiceUrl: charge.invoiceUrl,
          bankSlipUrl: charge.bankSlipUrl,
          pixQrCode: firstOne ? (contract.pix?.encodedImage ?? null) : null,
          pixCopyPaste: firstOne ? (contract.pix?.payload ?? null) : null,
          // Vai da contratação até a renovação: no recorrente, um ciclo depois
          // do vencimento desta cobrança; no parcelado, o ano inteiro.
          periodStart: now,
          periodEnd: installment
            ? contract.nextDueDate
            : addCalendarCycle(new Date(charge.dueDate), input.cycle),
          grossValue: installment
            ? firstOne
              ? Math.round(Number(charge.value) * 100 + quote.creditCents) / 100
              : null
            : grossValue,
          creditApplied: firstOne ? creditApplied : null,
          kind: input.kind,
          asaasInstallmentId: installment ? contract.asaasInstallmentId : null,
          installmentNumber: installment
            ? (charge.installmentNumber ?? index + 1)
            : null,
        },
      }),
    );
  }
  return payments;
}

/**
 * Desfaz a contratação que não chegou ao fim: cancela no Asaas (para nada
 * ficar cobrando), encerra a reserva e devolve o cupom.
 */
export async function releaseReservation(
  prisma: PrismaService,
  gateway: AsaasGatewayService,
  logger: Logger,
  input: {
    subscriptionId: string;
    couponId: string | null;
    asaasSubscriptionId: string | null;
    asaasInstallmentId?: string | null;
  },
) {
  const { subscriptionId, couponId } = input;
  await undoGatewayContract(gateway, logger, subscriptionId, {
    asaasSubscriptionId: input.asaasSubscriptionId,
    asaasInstallmentId: input.asaasInstallmentId ?? null,
  });

  try {
    await prisma.$transaction(async (tx) => {
      if (couponId) {
        const { count } = await tx.couponUsage.deleteMany({
          where: { subscriptionId },
        });
        if (count > 0) {
          await tx.coupon.update({
            where: { id: couponId },
            data: { currentUses: { decrement: count } },
          });
        }
      }
      await tx.subscription.update({
        where: { id: subscriptionId },
        data: { status: 'CANCELED', endedReason: 'ABANDONED' },
      });
      await tx.subscriptionHistory.create({
        data: {
          subscriptionId,
          action: 'CHECKOUT_FAILED',
          description: 'Contratação desfeita: não foi concluída no gateway',
          createdByName: 'Sistema',
        },
      });
    });
  } catch (error) {
    logger.error(
      `Falha ao desfazer a contratação ${subscriptionId}: ${error.message}`,
    );
  }
}

export interface ContractorOnFile {
  type: 'PF' | 'PJ';
  document: string;
  name: string;
  tradeName: string | null;
  email: string;
  representativeName: string | null;
}

interface AcceptanceRecord {
  contractorType: string;
  contractorDocument: string;
  contractorName: string;
  contractorTradeName: string | null;
  contractorEmail: string;
  representativeCpf: string | null;
  representativeName: string | null;
  representativeVerified: boolean | null;
  representativeIsSessionUser: boolean;
  acceptedByUserId: string;
}

/**
 * Quem contratou a assinatura em curso, para exibir em leitura na evolução,
 * nos complementos e na regularização: o do último aceite; nas contratações
 * antigas, sem aceite registrado, o cliente de cobrança.
 */
export function contractorOnFile(
  lastAcceptance: AcceptanceRecord | null,
  customer: { document: string; name: string; email: string } | null,
): ContractorOnFile | null {
  if (lastAcceptance) {
    return {
      type: lastAcceptance.contractorType as 'PF' | 'PJ',
      document: lastAcceptance.contractorDocument,
      name: lastAcceptance.contractorName,
      tradeName: lastAcceptance.contractorTradeName,
      email: lastAcceptance.contractorEmail,
      representativeName: lastAcceptance.representativeName,
    };
  }
  if (!customer) return null;
  return {
    type:
      String(customer.document).replace(/\D/g, '').length === 14 ? 'PJ' : 'PF',
    document: customer.document,
    name: customer.name,
    tradeName: null,
    email: customer.email,
    representativeName: null,
  };
}

/**
 * O representante do último aceite: a evolução e a regularização não mudam
 * quem responde pela empresa. "Sou eu" só continua valendo para quem aceitou.
 */
export function representativeOnFile(
  lastAcceptance: AcceptanceRecord | null,
  userId: string,
) {
  if (
    !lastAcceptance?.representativeCpf ||
    !lastAcceptance.representativeName
  ) {
    return null;
  }
  return {
    cpf: lastAcceptance.representativeCpf,
    name: lastAcceptance.representativeName,
    verified: !!lastAcceptance.representativeVerified,
    isSessionUser:
      lastAcceptance.representativeIsSessionUser &&
      lastAcceptance.acceptedByUserId === userId,
  };
}
