/**
 * Substituição tributária: ajuste da margem de valor agregado.
 *
 * A MVA publicada nos protocolos é a "original", aplicável à operação interna
 * do estado de destino. Quando a mercadoria chega de outra UF, a alíquota
 * interestadual é menor que a interna, e a margem precisa ser ajustada para que
 * a carga final seja equivalente (Convênio ICMS 142/2018, Seção III):
 *
 *   MVA ajustada = [(1 + MVA original) x (1 - ALQ inter) / (1 - ALQ intra)] - 1
 *
 * Exceção importante: o Convênio ICMS 35/2011 dispensa o contribuinte optante
 * do Simples Nacional, na condição de substituto tributário, de aplicar a MVA
 * ajustada em operações interestaduais — ele usa a MVA original.
 */

/** Percentual (18 = 18%) para fração (0,18). */
const fracao = (percentual: number) => percentual / 100;

/** Arredonda para 2 casas, evitando o resíduo do ponto flutuante. */
const duasCasas = (valor: number) => Math.round(valor * 100) / 100;

export interface AjusteMva {
  /** MVA-ST original do protocolo, em percentual. */
  mvaOriginal: number;
  /** Alíquota interestadual da operação, em percentual. */
  aliquotaInterestadual: number;
  /** Alíquota interna na UF de destino, em percentual. */
  aliquotaInterna: number;
}

/**
 * MVA ajustada, em percentual.
 *
 * Devolve `null` quando a alíquota interna é 100% ou maior — a divisão por
 * `1 - ALQ intra` explodiria — ou quando alguma entrada não é utilizável.
 * Quem chama trata o caso em vez de receber Infinity.
 */
export function calcularMvaAjustada({
  mvaOriginal,
  aliquotaInterestadual,
  aliquotaInterna,
}: AjusteMva): number | null {
  const entradas = [mvaOriginal, aliquotaInterestadual, aliquotaInterna];
  if (entradas.some((v) => !Number.isFinite(v) || v < 0)) return null;
  if (aliquotaInterna >= 100) return null;

  const ajustada =
    ((1 + fracao(mvaOriginal)) * (1 - fracao(aliquotaInterestadual))) /
      (1 - fracao(aliquotaInterna)) -
    1;

  // Ajuste negativo não existe: quando a interna é menor ou igual à
  // interestadual, o protocolo manda usar a MVA original.
  return duasCasas(Math.max(ajustada * 100, mvaOriginal));
}

export interface MvaAplicavel extends AjusteMva {
  /** Emitente optante do Simples Nacional (CRT 1 ou 2). */
  optanteSimples: boolean;
  /** Operação entre UFs diferentes. Em operação interna não há ajuste. */
  interestadual: boolean;
}

/**
 * MVA que deve ser efetivamente aplicada na operação, já considerando o regime
 * do emitente e se a operação é interestadual.
 */
export function resolverMva({
  optanteSimples,
  interestadual,
  ...ajuste
}: MvaAplicavel): number | null {
  if (!Number.isFinite(ajuste.mvaOriginal) || ajuste.mvaOriginal < 0) {
    return null;
  }
  // Operação interna usa a margem do próprio estado, sem ajuste; e o optante do
  // Simples é dispensado do ajuste mesmo entre UFs (Convênio ICMS 35/2011).
  if (!interestadual || optanteSimples) return duasCasas(ajuste.mvaOriginal);
  return calcularMvaAjustada(ajuste);
}
