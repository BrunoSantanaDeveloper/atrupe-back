import { Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from 'nestjs-prisma';

/**
 * Pagamento antecipado (PA, 12/11/2026): a venda aprovada com pendência fica
 * em PENDING_PAYMENT até o título marcado "⚠️ Pendência"
 * (`receivable.releasesQuotation`) ser pago. O financeiro não importa o
 * módulo de vendas: chama a liberação por este token, que o módulo do
 * orçamento registra (`QuotationWorkflowService`).
 */
export const PAYMENT_HOLD_RELEASER = 'PAYMENT_HOLD_RELEASER';

export type ReleaseOptions = {
  userId?: string;
  /** Liberar sem o pagamento (PA-7): o motivo é obrigatório */
  manualReason?: string;
};

export interface PaymentHoldReleaser {
  /**
   * Libera a venda pendente quando os títulos que a liberam estão pagos (ou
   * sem o pagamento, com o motivo). Nada faz se a venda não está pendente
   * ou se ainda falta pagar: pode ser chamada de novo sem efeito.
   */
  releaseHold(
    quotationId: string,
    options?: ReleaseOptions,
  ): Promise<{ released: boolean; orderId?: string }>;
}

export const HOLD_NOT_PENDING =
  'Esta venda não está pendente de pagamento: não há o que liberar.';
export const HOLD_RELEASE_REASON_REQUIRED =
  'Informe o motivo para liberar a venda sem o pagamento.';

const logger = new Logger('PaymentHold');

/**
 * Depois de uma baixa no financeiro: libera as vendas pendentes cujo título
 * "⚠️ Pendência" ficou pago. A falha aqui não desfaz a baixa: a venda é
 * conferida de novo ao ser aberta (GET /sale/quotation/:id/payment-hold).
 */
export async function releaseHeldSales(
  moduleRef: ModuleRef,
  prisma: PrismaService,
  installmentIds: string[],
): Promise<void> {
  if (!installmentIds.length) return;
  try {
    const rows = await prisma.receivableInstallment.findMany({
      where: {
        id: { in: installmentIds },
        receivable: {
          releasesQuotation: true,
          quotation: { status: 'PENDING_PAYMENT' },
        },
      },
      select: { receivable: { select: { quotationId: true } } },
    });
    const quotationIds = [
      ...new Set(
        rows
          .map((row) => row.receivable.quotationId)
          .filter((id): id is string => !!id),
      ),
    ];
    if (!quotationIds.length) return;
    const releaser = moduleRef.get<PaymentHoldReleaser>(PAYMENT_HOLD_RELEASER, {
      strict: false,
    });
    for (const quotationId of quotationIds) {
      await releaser.releaseHold(quotationId);
    }
  } catch (error) {
    logger.error(
      `A liberação da venda pendente falhou depois da baixa (é conferida de novo ao abrir a venda): ${error.message}`,
    );
  }
}
