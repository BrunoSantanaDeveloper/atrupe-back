import { PaymentStatus } from '@prisma/client';

type ParcelaComPagamento = {
  status: PaymentStatus | string;
  paidAmount?: number | null;
};

/**
 * Parcelas com pagamento registrado: recebidas, provisionadas ou com valor
 * baixado. Cancelar um titulo que tem uma dessas apagaria do financeiro
 * dinheiro que ja entrou (ou saiu) e continua no caixa — o certo e desfazer
 * o pagamento primeiro.
 */
export function parcelasComPagamento<T extends ParcelaComPagamento>(
  installments: T[],
): T[] {
  return (installments ?? []).filter(
    (parcela) =>
      (parcela.paidAmount ?? 0) > 0 ||
      parcela.status === PaymentStatus.PAID ||
      parcela.status === PaymentStatus.PROVISIONED,
  );
}

/**
 * Status do título a partir do status das suas parcelas.
 *
 * Uma parcela cancelada não cancela o título: só quando TODAS estão
 * canceladas. A regra anterior fazia `hasCancelled` ganhar de tudo, então
 * cancelar uma parcela marcava a venda inteira como cancelada enquanto as
 * outras seguiam em aberto. O título sumia do relatório financeiro (que
 * exclui cancelados) e a cobrança ficava invisível, sem nem motivo de
 * cancelamento gravado.
 *
 * Devolve `null` quando as parcelas não determinam um status (ex.: só
 * provisionadas), para quem chama manter o tratamento que já tinha.
 */
export function resolveTitleStatus(
  statuses: (PaymentStatus | string)[],
): PaymentStatus | null {
  if (!statuses?.length) return null;

  const ativas = statuses.filter((status) => status !== PaymentStatus.CANCELED);

  if (ativas.length === 0) return PaymentStatus.CANCELED;
  if (ativas.some((status) => status === PaymentStatus.PENDING)) {
    return PaymentStatus.PENDING;
  }
  if (ativas.every((status) => status === PaymentStatus.PAID)) {
    return PaymentStatus.PAID;
  }

  return null;
}
