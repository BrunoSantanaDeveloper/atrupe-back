/**
 * Alíquota interestadual do ICMS.
 *
 * Regra nacional, não estadual — por isso vive em código e não em cadastro:
 *
 *  - 12% é a alíquota geral (Resolução do Senado nº 22/1989).
 *  - 7% nas operações saídas das Regiões Sul e Sudeste com destino às Regiões
 *    Norte, Nordeste e Centro-Oeste ou ao Espírito Santo (mesma resolução).
 *  - 4% nas operações com bem ou mercadoria importada do exterior
 *    (Resolução do Senado nº 13/2012).
 *
 * O Espírito Santo aparece nos dois lados: pertence ao Sudeste como origem e
 * está nomeado como destino favorecido. Logo ES → GO é 7%, mas ES → SP é 12%.
 */

const NORTE = ['AC', 'AP', 'AM', 'PA', 'RO', 'RR', 'TO'];
const NORDESTE = ['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE'];
const CENTRO_OESTE = ['DF', 'GO', 'MT', 'MS'];
const SUDESTE = ['ES', 'MG', 'RJ', 'SP'];
const SUL = ['PR', 'RS', 'SC'];

const ORIGEM_SUL_SUDESTE = new Set([...SUL, ...SUDESTE]);
const DESTINO_FAVORECIDO = new Set([
  ...NORTE,
  ...NORDESTE,
  ...CENTRO_OESTE,
  'ES',
]);

/**
 * Origens da mercadoria (tabela A do CST) sujeitas aos 4% da Resolução 13/2012.
 *
 * Ficam de fora, mantendo 7% ou 12%: origem 4 (produção conforme processo
 * produtivo básico), 6 e 7 (importada sem similar nacional, lista CAMEX) e as
 * nacionais 0 e 5.
 */
const ORIGENS_IMPORTADAS_4 = new Set(['1', '2', '3', '8']);

export type AliquotaInterestadual = 4 | 7 | 12;

/** Normaliza a sigla da UF; devolve string vazia quando não reconhecida. */
const normalizarUf = (uf?: string | null) =>
  (uf || '').trim().toUpperCase().slice(0, 2);

export function isOperacaoInterestadual(
  ufOrigem?: string | null,
  ufDestino?: string | null,
): boolean {
  const origem = normalizarUf(ufOrigem);
  const destino = normalizarUf(ufDestino);
  if (!origem || !destino) return false;
  return origem !== destino;
}

/**
 * Alíquota aplicável à operação interestadual.
 *
 * Devolve `null` quando a operação não é interestadual ou quando falta UF —
 * quem chama decide o que fazer, em vez de receber um número inventado.
 */
export function aliquotaInterestadual(
  ufOrigem?: string | null,
  ufDestino?: string | null,
  origemMercadoria?: string | null,
): AliquotaInterestadual | null {
  if (!isOperacaoInterestadual(ufOrigem, ufDestino)) return null;

  const origem = normalizarUf(ufOrigem);
  const destino = normalizarUf(ufDestino);

  // A importada tem alíquota própria e não depende das regiões envolvidas.
  if (ORIGENS_IMPORTADAS_4.has(String(origemMercadoria ?? '').trim())) return 4;

  if (ORIGEM_SUL_SUDESTE.has(origem) && DESTINO_FAVORECIDO.has(destino)) {
    return 7;
  }

  return 12;
}
