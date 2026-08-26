/**
 * Normaliza texto livre que vai para campos do XML fiscal.
 *
 * Campos como `infCpl` (informações complementares) e `xCorrecao` (CC-e) são
 * preenchidos à mão e costumam chegar com quebra de linha, tabulação e NBSP
 * vindos de cópia de Word/Excel. Caracteres de controle não são válidos em XML
 * e derrubam a validação do provedor com um erro genérico, que não diz qual
 * campo causou o problema.
 *
 * A CC-e já fazia essa limpeza desde uma rejeição em produção; a emissão
 * mandava `infCpl` cru.
 *
 * Quebra de linha vira espaço em vez de ser removida: juntar duas frases sem
 * separador ("...portariaEntregar...") é pior que perder a formatação.
 */
export function sanitizeFiscalText(input?: string | null): string {
  return (
    (input ?? '')
      .replace(/[\r\n\t]+/g, ' ')
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1F\x7F]/g, '')
      .replace(/\u00A0/g, ' ') // NBSP de colagem
      .replace(/\s{2,}/g, ' ')
      .trim()
  );
}

/** Limite de `infCpl` no leiaute da NF-e (campo Z03). */
export const INF_CPL_MAX_LENGTH = 5000;

/**
 * Limpa e trunca as informações complementares para caber no leiaute.
 *
 * Truncar em vez de rejeitar é deliberado: o texto é informativo e não altera
 * imposto nenhum — barrar a emissão por causa dele seria pior para quem está
 * tentando faturar.
 */
export function sanitizeInfCpl(input?: string | null): string {
  return sanitizeFiscalText(input).slice(0, INF_CPL_MAX_LENGTH);
}
