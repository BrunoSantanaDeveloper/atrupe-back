/**
 * Resolução da coluna `ContaBancaria` do CSV financeiro.
 *
 * O nome vem digitado na planilha do cliente, então a busca ignora espaços nas
 * pontas e diferença de caixa — uma maiúscula divergente derrubava a importação
 * inteira com "conta não encontrada".
 */

/** Banco genérico usado quando não dá para deduzir a instituição pelo nome livre. */
export const GENERIC_BANK_CODE = '000';

export async function findActiveBankAccountByName(
  prisma: any,
  companyId: string,
  name: string,
) {
  const normalized = name?.trim();
  if (!normalized) return null;

  return prisma.bankAccount.findFirst({
    where: {
      name: { equals: normalized, mode: 'insensitive' },
      companyId,
      isActive: true,
    },
  });
}

/**
 * Nomes distintos de conta bancária citados nas linhas do CSV, preservando a
 * grafia da primeira ocorrência. A deduplicação é case-insensitive para o mesmo
 * nome escrito de formas diferentes não virar duas contas.
 */
export function collectBankAccountNames(rows: any[]): string[] {
  const seen = new Map<string, string>();

  for (const row of rows) {
    const name = row?.ContaBancaria?.trim();
    if (!name) continue;

    const key = name.toLowerCase();
    if (!seen.has(key)) seen.set(key, name);
  }

  return [...seen.values()];
}
