import { PrismaClient } from '@prisma/client';

type PrismaLike = Pick<PrismaClient, 'company' | 'invoicyConfig'>;

/**
 * O que é fiscal de antes de uma troca de CNPJ por transferência de
 * titularidade (Company.fiscalResetAt): notas emitidas sob o CNPJ anterior.
 *
 * Elas ficam no ambiente como histórico — uma nota emitida sob a titularidade
 * anterior continua dizendo em nome de quem foi emitida —, mas nada as
 * manipula: cancelar, corrigir, reemitir, reenviar ou consultar no provedor
 * agiria com as credenciais do CNPJ novo sobre um documento do anterior.
 */
export interface FiscalHistoryLock {
  /** A data da troca: o que é fiscal de antes dela é do CNPJ anterior. */
  lockedBefore: Date;
  /** Os emissores do CNPJ anterior: as notas deles ficam só para consulta. */
  historicalEmitterIds: string[];
  /** O motivo, como a tela o mostra. */
  reason: string;
}

export async function loadFiscalHistoryLock(
  prisma: PrismaLike,
  companyId: string,
): Promise<FiscalHistoryLock | null> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { fiscalResetAt: true },
  });
  if (!company?.fiscalResetAt) return null;

  const emitters = await prisma.invoicyConfig.findMany({
    where: { companyId, createdAt: { lt: company.fiscalResetAt } },
    select: { id: true },
  });
  return {
    lockedBefore: company.fiscalResetAt,
    historicalEmitterIds: emitters.map((e) => e.id),
    reason: fiscalHistoryReason(company.fiscalResetAt),
  };
}

/**
 * A nota é do CNPJ anterior? Pelo emissor, quando ela o registra — uma nota
 * rejeitada de antes que foi reemitida depois passa ao emissor novo e deixa de
 * ser histórico. As antigas, sem emissor registrado, pela data.
 */
export function isHistoricalDocument(
  document: { createdAt: Date; invoicyConfigId?: string | null },
  lock: FiscalHistoryLock | null,
): boolean {
  if (!lock) return false;
  if (document.invoicyConfigId) {
    return lock.historicalEmitterIds.includes(document.invoicyConfigId);
  }
  return document.createdAt.getTime() < lock.lockedBefore.getTime();
}

export function fiscalHistoryReason(lockedBefore: Date): string {
  const date = lockedBefore.toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
  });
  return `Nota emitida sob o CNPJ anterior à transferência de titularidade de ${date}. Ela fica no ambiente como histórico e não pode mais ser cancelada, corrigida, reemitida, reenviada nem consultada no provedor.`;
}
