/**
 * Alíquotas e cálculo do IBS/CBS da Reforma Tributária.
 *
 * As alíquotas mudam por fase da transição, então ficam num único lugar: em
 * 2027 a CBS passa a ser cobrada de fato e o IBS se divide entre estadual e
 * municipal, e a alteração é aqui, não espalhada pelos serviços fiscais.
 *
 * A alíquota do IBS municipal é definida por cada município — por isso o
 * emissor pode sobrescrever qualquer uma delas (InvoicyConfig).
 *
 * Fontes: LC 214/2025 e orientações da Receita Federal para 2026
 * (0,9% de CBS + 0,1% de IBS como alíquotas de teste, com dispensa de
 * recolhimento para quem cumprir as obrigações acessórias).
 */
export interface IbsCbsAliquotas {
  /** Alíquota do IBS de competência estadual, em percentual (0,1 = 0,1%). */
  ibsUf: number;
  /** Alíquota do IBS de competência municipal, em percentual. */
  ibsMun: number;
  /** Alíquota da CBS, em percentual. */
  cbs: number;
}

/** Fase de teste de 2026: 1% no total, sem recolhimento. */
const FASE_2026: IbsCbsAliquotas = { ibsUf: 0.1, ibsMun: 0, cbs: 0.9 };

/**
 * Alíquotas vigentes na data informada.
 *
 * A partir de 2027 os valores mudam por lei e ainda dependem de definição —
 * até que estejam confirmados, a função mantém as de 2026 e sinaliza para quem
 * chamou que a fase não está coberta, em vez de devolver número inventado.
 */
export function aliquotasVigentes(referencia: Date = new Date()): {
  aliquotas: IbsCbsAliquotas;
  faseCoberta: boolean;
} {
  const ano = referencia.getUTCFullYear();
  if (ano <= 2026) return { aliquotas: FASE_2026, faseCoberta: true };
  return { aliquotas: FASE_2026, faseCoberta: false };
}

/** Arredonda para 2 casas sem acumular erro de ponto flutuante. */
const duasCasas = (valor: number) => Math.round(valor * 100) / 100;

export interface IbsCbsCalculado {
  base: number;
  ibsUf: number;
  ibsMun: number;
  ibsTotal: number;
  cbs: number;
}

/**
 * Calcula IBS e CBS sobre a base informada.
 *
 * O total do IBS soma os valores JÁ arredondados de UF e município: é o que a
 * nota apresenta em linhas separadas, e somar os valores cheios produziria um
 * total que não bate com a exibição.
 */
export function calcularIbsCbs(
  base: number,
  aliquotas: IbsCbsAliquotas,
): IbsCbsCalculado {
  const baseArredondada = duasCasas(base);
  const ibsUf = duasCasas((baseArredondada * aliquotas.ibsUf) / 100);
  const ibsMun = duasCasas((baseArredondada * aliquotas.ibsMun) / 100);

  return {
    base: baseArredondada,
    ibsUf,
    ibsMun,
    ibsTotal: duasCasas(ibsUf + ibsMun),
    cbs: duasCasas((baseArredondada * aliquotas.cbs) / 100),
  };
}
