/**
 * Número de planilha ou de banco: "1.234,56", "1234,56" ou "60.00".
 *
 * Ponto seguido de exatamente três dígitos é separador de milhar, no formato
 * brasileiro. Por isso o DECIMAL de três casas do legado precisa chegar com
 * vírgula (ver `decimal` em legacy-extractors).
 */
export function parseImportDecimal(
  value: string | number | null | undefined,
): number {
  if (value === null || value === undefined || value === '') return NaN;
  if (typeof value === 'number') return value;

  const normalized = value
    .trim()
    .replace(/\s/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');

  return parseFloat(normalized);
}

/**
 * Valor em reais para centavos, arredondado para não carregar erro de ponto
 * flutuante. Vazio ou ilegível devolve nulo.
 */
export function importValueToCents(
  value: string | number | null | undefined,
): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numValue = parseImportDecimal(value);
  if (isNaN(numValue)) return null;
  return Math.round(numValue * 100);
}
