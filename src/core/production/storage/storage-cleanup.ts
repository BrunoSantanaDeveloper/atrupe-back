/**
 * A limpeza do espaço dos arquivos de produção (GP-49; Maicol, 22/11/2026),
 * para quem não quer comprar espaço: apaga os arquivos mais antigos até
 * liberar a porcentagem informada do espaço usado.
 *
 * - Só os arquivos acrescentados às O.S. entregues (todas as versões: a
 *   arte, a editada, a prova, o PDF, o projeto), nos gerenciadores e na O.S.
 *   geral; nada dos cadastros e nada de O.S. ainda não entregue. Entregue é
 *   a O.S. finalizada (FINISHED, o fim da entrega na agenda): a concluída
 *   (COMPLETED) ainda conta como em andamento, e o projeto concluído (DONE)
 *   só diz que a produção acabou.
 * - Do mais antigo para o mais novo, até alcançar o alvo.
 * - Não tem volta: na tarefa, o arquivo fica como "removido na limpeza".
 * - O automático vem desligado; ligá-lo pede o APAGAR digitado, como a
 *   limpeza manual. Ligado, roda quando o espaço passa do limite e libera a
 *   porcentagem configurada, e não roda sem a assinatura ativa.
 */

export type CleanupCandidate = {
  id: string;
  /** A tarefa do anexo; nulo no arquivo da O.S. */
  taskId: string | null;
  /** A venda: o projeto e a O.S. dela contam como uma O.S. */
  projectId: string;
  size: number;
  uploadedAt: Date;
};

export type CleanupPick<T extends CleanupCandidate = CleanupCandidate> = {
  /** O alvo: a porcentagem do espaço usado, em bytes */
  targetBytes: number;
  /** O que dá para apagar (O.S. entregues) */
  eligibleBytes: number;
  picked: T[];
  bytes: number;
  projects: number;
  from: Date | null;
  to: Date | null;
};

export const CLEANUP_DEFAULT_PERCENT = 50;
export const CLEANUP_DEFAULT_THRESHOLD = 90;

/** A confirmação digitada: na limpeza e ao ligar o automático. */
export const CLEANUP_CONFIRM_WORD = 'APAGAR';
export const cleanupConfirmed = (typed: string | null | undefined) =>
  typed?.trim().toUpperCase() === CLEANUP_CONFIRM_WORD;

export function pickOldest<T extends CleanupCandidate>(
  candidates: T[],
  usedBytes: number,
  percent: number,
): CleanupPick<T> {
  const share = Math.min(Math.max(percent, 1), 100) / 100;
  const targetBytes = Math.ceil(usedBytes * share);
  const ordered = [...candidates].sort(
    (a, b) =>
      a.uploadedAt.getTime() - b.uploadedAt.getTime() ||
      a.id.localeCompare(b.id),
  );
  const picked: T[] = [];
  let bytes = 0;
  for (const file of ordered) {
    if (bytes >= targetBytes) break;
    picked.push(file);
    bytes += file.size;
  }
  return {
    targetBytes,
    eligibleBytes: ordered.reduce((sum, file) => sum + file.size, 0),
    picked,
    bytes,
    projects: new Set(picked.map((file) => file.projectId)).size,
    from: picked[0]?.uploadedAt ?? null,
    to: picked[picked.length - 1]?.uploadedAt ?? null,
  };
}

/** O automático roda quando o espaço usado passa do limite (em %). */
export const autoCleanupDue = (
  summary: { usedBytes: number; quotaBytes: number | null },
  thresholdPercent: number,
) =>
  summary.quotaBytes !== null &&
  summary.quotaBytes > 0 &&
  summary.usedBytes / summary.quotaBytes >= thresholdPercent / 100;

/**
 * Por que o automático não roda na empresa; nulo quando pode rodar. Sem a
 * assinatura ativa (cobrança em aberto, plano cancelado, teste vencido), a
 * cota cai para a grátis e o automático apagaria a porcentagem dos arquivos
 * toda noite: ele espera a assinatura voltar.
 */
export function autoCleanupSkip(
  plan: { planType: string; isTrialActive: boolean } | null,
): string | null {
  if (!plan) return 'sem assinatura ativa';
  if (plan.planType === 'TRIAL' && !plan.isTrialActive) {
    return 'teste grátis vencido';
  }
  return null;
}
