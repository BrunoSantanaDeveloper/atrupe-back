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

/**
 * Deixa todo texto de um payload fiscal valido para o schema da NF-e.
 *
 * Os tipos string do leiaute usam o padrao
 * `[!-y]{1}[ -y]{0,}[!-y]{1}|[!-y]{1}`: espaco no comeco ou no fim reprova, e
 * caractere de controle tambem. Dado vindo de migracao costuma trazer esses
 * espacos, e a SEFAZ responde com um SAXParseException que aponta a coluna do
 * XML — nunca o campo —, o que torna o diagnostico caro.
 *
 * Normalizar o payload inteiro de uma vez cobre tambem os campos que ninguem
 * lembraria de tratar um a um.
 *
 * Espaco no MEIO do texto e permitido pelo padrao e fica intacto: colapsar
 * mudaria o dado sem necessidade.
 */
export function normalizeFiscalStrings<T>(valor: T): T {
  if (typeof valor === 'string') {
    // eslint-disable-next-line no-control-regex
    return valor.replace(/[\x00-\x1F\x7F]/g, '').trim() as unknown as T;
  }

  if (Array.isArray(valor)) {
    return valor.map((item) => normalizeFiscalStrings(item)) as unknown as T;
  }

  // Date vira string na serializacao; percorrer suas propriedades a destruiria.
  if (valor instanceof Date) return valor;

  if (valor && typeof valor === 'object') {
    const saida: Record<string, unknown> = {};
    for (const [chave, item] of Object.entries(valor)) {
      saida[chave] = normalizeFiscalStrings(item);
    }
    return saida as unknown as T;
  }

  return valor;
}
