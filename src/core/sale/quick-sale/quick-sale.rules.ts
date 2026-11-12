import { PendingSaleKind, Prisma } from '@prisma/client';
import { PrismaService } from 'nestjs-prisma';

type Tx = Prisma.TransactionClient;

export const QUICK_SALE_ALREADY_SENT = 'Esta venda já foi enviada ao caixa';
export const QUICK_SALE_LOCKED =
  'A venda já está no caixa: os itens não mudam mais';
export const CASH_FRONT_NOT_IN_PLAN =
  'A frente de caixa não está no seu plano: cobre a venda na hora';
export const NOT_AT_CHECKOUT =
  'Só a venda cuja série fatura na frente de caixa é cobrada na hora';

// O recebimento é da série (VR-5, revista em 26/10/2026): a venda rápida é
// só a abertura do orçamento. O que manda a venda ao caixa, ou ao "Cobrar"
// do vendedor, é a série com "Faturar na frente de caixa" (ON_CHECKOUT).

/**
 * O valor da venda, em centavos: os itens, a entrega e a comissão somada,
 * menos o desconto das condições. É o que o título da venda comum soma,
 * sem as parcelas.
 *
 * Os valores do orçamento já estão em centavos (o detalhe devolve 5000
 * para R$ 50,00): não se multiplica por 100. Multiplicado, o "Cobrar"
 * esperava 100 vezes o total e recusava toda venda ("cobrada pelo total"),
 * e a venda enviada ao caixa chegava com 100 vezes o valor.
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
      (quotation.totalValue ?? 0) +
        (quotation.deliveryInfo?.value ?? 0) -
        (quotation.quotationPayment?.discountTotal ?? 0) +
        (quotation.quotationPayment?.commission?.type === 'ADD'
          ? (quotation.quotationPayment.commission.totalCommission ?? 0)
          : 0),
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
 * venda da série da frente de caixa é enviar ao caixa. Uma vez só por venda.
 */
export async function ensurePendingSale(
  tx: Tx,
  quotation: Parameters<typeof saleTotalCents>[0] & {
    id: string;
    companyId: string;
    approvedAt: Date | null;
  },
  kind: PendingSaleKind = 'QUICK',
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
      kind,
      path: 'POS',
      total: saleTotalCents(quotation),
      approvedAt: quotation.approvedAt ?? new Date(),
    },
    select: { id: true },
  });
}

/**
 * A venda que está no caixa (enviada ou cobrada, e não cancelada) não muda
 * mais os itens (FC-11).
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

/**
 * A venda pendente de pagamento (PENDING_PAYMENT) não muda itens nem
 * pagamento: o título "⚠️ Pendência" nasceu com os valores da aprovação, e a
 * liberação gera o resto a partir deles (12/11/2026). Para mudar, volta para
 * digitação.
 */
export async function isPendingPayment(
  prisma: PrismaService | Tx,
  quotationId: string,
) {
  const quotation = await prisma.quotation.findUnique({
    where: { id: quotationId },
    select: { status: true },
  });
  return quotation?.status === 'PENDING_PAYMENT';
}
