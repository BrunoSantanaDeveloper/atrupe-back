import { Prisma, QuickSalePayment } from '@prisma/client';
import { PrismaService } from 'nestjs-prisma';
import { PlanControlService } from '../../plan/plan-control.service';

type Tx = Prisma.TransactionClient;

export const QUICK_SALE_ALREADY_SENT = 'Esta venda já foi enviada ao caixa';
export const QUICK_SALE_CHARGE_REQUIRED =
  'A venda rápida é cobrada na hora: conclua pelo "Cobrar", que recebe e aprova';
export const QUICK_SALE_LOCKED =
  'A venda rápida já está no caixa: os itens não mudam mais';

/**
 * O caminho da venda rápida na empresa (VR-5): cobrada na hora ou enviada à
 * frente de caixa. Sem o recurso no plano, o orçamento marcado como venda
 * rápida segue o caminho comum (nulo).
 */
export async function quickSaleMode(
  prisma: PrismaService | Tx,
  planControl: PlanControlService,
  companyId: string,
): Promise<QuickSalePayment | null> {
  if (!(await planControl.hasFeature(companyId, 'quotation_quick_sale'))) {
    return null;
  }
  const settings = await prisma.quickSaleSettings.findUnique({
    where: { companyId },
    select: { payment: true },
  });
  return settings?.payment ?? 'CASH_ONLY';
}

/**
 * O valor da venda, em centavos: os itens, a entrega e a comissão somada,
 * menos o desconto das condições. É o que o título da venda comum soma,
 * sem as parcelas.
 */
export const saleTotalCents = (quotation: {
  totalValue: number;
  deliveryInfo?: { value?: number | null } | null;
  quotationPayment?: {
    discountTotal?: number | null;
    commission?: {
      type?: string | null;
      totalCommission?: number | null;
    } | null;
  } | null;
}) =>
  Math.max(
    0,
    Math.round(
      ((quotation.totalValue ?? 0) +
        (quotation.deliveryInfo?.value ?? 0) -
        (quotation.quotationPayment?.discountTotal ?? 0) +
        (quotation.quotationPayment?.commission?.type === 'ADD'
          ? (quotation.quotationPayment.commission.totalCommission ?? 0)
          : 0)) *
        100,
    ),
  );

/** A referência da venda nas telas do caixa: número-série. */
export const saleReference = (quotation: {
  quotationNumber: number | null;
  series?: { code: string } | null;
}) =>
  [quotation.quotationNumber, quotation.series?.code]
    .filter((part) => part !== null && part !== undefined && part !== '')
    .join('-');

/**
 * Coloca a venda aprovada na fila da frente de caixa (FC-12): aprovar a
 * venda rápida é enviar ao caixa. Uma vez só por venda.
 */
export async function ensurePendingSale(
  tx: Tx,
  quotation: Parameters<typeof saleTotalCents>[0] & {
    id: string;
    companyId: string;
    approvedAt: Date | null;
  },
) {
  const existing = await tx.pendingSale.findUnique({
    where: { quotationId: quotation.id },
    select: { id: true },
  });
  if (existing) return existing;
  return tx.pendingSale.create({
    data: {
      companyId: quotation.companyId,
      quotationId: quotation.id,
      kind: 'QUICK',
      path: 'POS',
      total: saleTotalCents(quotation),
      approvedAt: quotation.approvedAt ?? new Date(),
    },
    select: { id: true },
  });
}

/**
 * A venda rápida que está no caixa (enviada ou cobrada, e não cancelada) não
 * muda mais os itens (FC-11).
 */
export async function isAtCashier(
  prisma: PrismaService | Tx,
  quotationId: string,
) {
  const sale = await prisma.pendingSale.findUnique({
    where: { quotationId },
    select: { cancelled: true },
  });
  return !!sale && !sale.cancelled;
}
