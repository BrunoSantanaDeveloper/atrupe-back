/**
 * Resolução dos cadastros que a importação cita por nome (conta bancária,
 * natureza, subcategoria, setor).
 *
 * Os nomes vêm digitados na planilha do cliente, então toda busca ignora espaços
 * nas pontas e diferença de caixa — uma maiúscula divergente derrubava a
 * importação inteira com "não encontrado".
 */

/** Banco genérico usado quando não dá para deduzir a instituição pelo nome livre. */
export const GENERIC_BANK_CODE = '000';

/** Natureza usada como pai quando a linha traz subcategoria sem natureza. */
export const FALLBACK_NATURE_DESCRIPTION = 'Geral';

export type ImportReferenceType =
  | 'nature'
  | 'subCategory'
  | 'bankAccount'
  | 'sector';

export interface ImportReference {
  type: ImportReferenceType;
  name: string;
  /** Natureza-pai declarada na linha, quando o tipo é subCategory */
  parent?: string;
}

const insensitive = (value: string) => ({
  equals: value.trim(),
  mode: 'insensitive' as const,
});

/**
 * Valores distintos de uma coluna, preservando a grafia da primeira ocorrência.
 * A deduplicação é case-insensitive para o mesmo nome escrito de formas
 * diferentes não virar dois cadastros.
 */
function distinctColumn(rows: any[], column: string): string[] {
  const seen = new Map<string, string>();

  for (const row of rows) {
    const value = row?.[column]?.trim();
    if (!value) continue;

    const key = value.toLowerCase();
    if (!seen.has(key)) seen.set(key, value);
  }

  return [...seen.values()];
}

export function collectBankAccountNames(rows: any[]): string[] {
  return distinctColumn(rows, 'ContaBancaria');
}

export function collectNatureNames(rows: any[]): string[] {
  return distinctColumn(rows, 'Natureza');
}

export function collectSectorNames(rows: any[]): string[] {
  return distinctColumn(rows, 'setor');
}

/**
 * Subcategorias distintas com a natureza declarada na mesma linha. O par importa
 * porque a subcategoria só existe pendurada numa natureza.
 */
export function collectSubCategoryRefs(
  rows: any[],
): Array<{ name: string; parent: string | null }> {
  const seen = new Map<string, { name: string; parent: string | null }>();

  for (const row of rows) {
    const name = row?.SubCategoria?.trim();
    if (!name) continue;

    const parent = row?.Natureza?.trim() || null;
    const key = `${name.toLowerCase()}|${parent?.toLowerCase() ?? ''}`;
    if (!seen.has(key)) seen.set(key, { name, parent });
  }

  return [...seen.values()];
}

export async function findActiveBankAccountByName(
  prisma: any,
  companyId: string,
  name: string,
) {
  if (!name?.trim()) return null;

  return prisma.bankAccount.findFirst({
    where: { name: insensitive(name), companyId, isActive: true },
  });
}

export async function findActiveNatureByDescription(
  prisma: any,
  companyId: string,
  description: string,
) {
  if (!description?.trim()) return null;

  return prisma.nature.findFirst({
    where: { description: insensitive(description), companyId, isActive: true },
  });
}

/**
 * Mesma regra do validador: quando a linha declara natureza, a subcategoria só
 * conta como existente se estiver pendurada nela.
 */
export async function findActiveSubCategoryByDescription(
  prisma: any,
  companyId: string,
  description: string,
  natureId?: string | null,
) {
  if (!description?.trim()) return null;

  return prisma.subCategory.findFirst({
    where: {
      description: insensitive(description),
      companyId,
      isActive: true,
      ...(natureId ? { natureId } : {}),
    },
  });
}

/** Nome comparável: sem acento, sem caixa e sem espaço nas pontas. */
const comparable = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

/**
 * Setor pelo nome, com a mesma tolerância da importação de produto: ignora
 * caixa e acento, então "Impressao" encontra "Impressão". Setor inativo conta
 * como existente, igual ao que o produto faz ao resolver o vínculo.
 */
export async function findSectorByName(
  prisma: any,
  companyId: string,
  name: string,
) {
  if (!name?.trim()) return null;

  const direct = await prisma.companySector.findFirst({
    where: { name: insensitive(name), companyId },
  });
  if (direct) return direct;

  const sectors = await prisma.companySector.findMany({ where: { companyId } });
  return (
    sectors.find((s: any) => comparable(s.name) === comparable(name)) ?? null
  );
}
