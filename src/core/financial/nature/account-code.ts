/** O código da conta no plano: níveis da natureza + subconta (02.01.01.02). */
export const accountCodeOf = (
  nature: { level1: string | null; level2: string | null; code: string | null },
  code: string | null,
) =>
  code && code.includes('.')
    ? code
    : [nature.level1, nature.level2, nature.code, code]
        .filter(Boolean)
        .join('.');
