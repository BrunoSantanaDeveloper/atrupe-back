/**
 * A limpeza do espaço dos arquivos de produção (GP-49; Maicol, 22/11/2026),
 * para quem não quer comprar espaço: apaga os arquivos mais antigos até
 * liberar a porcentagem informada do espaço usado.
 *
 * - Só os arquivos acrescentados às O.S. entregues e concluídas (todas as
 *   versões: a arte, a editada, a prova, o PDF, o projeto), nos
 *   gerenciadores e na O.S. geral; nada dos cadastros e nada de O.S. em
 *   produção.
 * - Do mais antigo para o mais novo, até alcançar o alvo.
 * - Não tem volta: na tarefa, o arquivo fica como "removido na limpeza".
 * - O automático vem desligado; ligado, roda quando o espaço passa do
 *   limite e libera a porcentagem configurada.
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

export type CleanupPick = {
  /** O alvo: a porcentagem do espaço usado, em bytes */
  targetBytes: number;
  /** O que dá para apagar (O.S. entregues e concluídas) */
  eligibleBytes: number;
  picked: CleanupCandidate[];
  bytes: number;
  projects: number;
  from: Date | null;
  to: Date | null;
};

export const CLEANUP_DEFAULT_PERCENT = 50;
export const CLEANUP_DEFAULT_THRESHOLD = 90;

export function pickOldest(
  candidates: CleanupCandidate[],
  usedBytes: number,
  percent: number,
): CleanupPick {
  const share = Math.min(Math.max(percent, 1), 100) / 100;
  const targetBytes = Math.ceil(usedBytes * share);
  const ordered = [...candidates].sort(
    (a, b) =>
      a.uploadedAt.getTime() - b.uploadedAt.getTime() ||
      a.id.localeCompare(b.id),
  );
  const picked: CleanupCandidate[] = [];
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
