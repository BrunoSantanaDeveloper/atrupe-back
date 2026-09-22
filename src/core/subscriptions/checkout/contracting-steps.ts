import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { AsaasGatewayService } from '../asaas-gateway.service';
import { QuoteResult } from '../pricing/pricing.engine';
import { CurrentTerms } from './contract-acceptance.service';

/**
 * Passos comuns às contratações que criam uma assinatura no Asaas: a
 * contratação nova e a evolução de plano.
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
  },
) {
  const { subscriptionId, couponId, asaasSubscriptionId } = input;
  if (asaasSubscriptionId) {
    try {
      await gateway.cancelAsaasSubscription(asaasSubscriptionId);
    } catch (error) {
      // Assinatura no Asaas sem contratação registrada: precisa de gente.
      logger.error(
        `RECONCILIAR: assinatura ${asaasSubscriptionId} do Asaas ficou ativa após falha na contratação ${subscriptionId}: ${error.message}`,
      );
    }
  }

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
