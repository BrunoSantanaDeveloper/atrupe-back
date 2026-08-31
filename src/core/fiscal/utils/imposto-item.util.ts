/**
 * Cálculo dos tributos de um item da NF-e para o Regime Normal.
 *
 * Função pura: tudo que depende de banco (alíquota interna do destino, regra de
 * ST da UF) é resolvido pelo chamador e entra como parâmetro. Isso mantém a
 * regra fiscal testável sem infraestrutura.
 *
 * Princípio de segurança do módulo: quando um CST exige valores que não podem
 * ser calculados — porque falta alíquota, ou porque o caminho ainda não está
 * implementado — o resultado vem com `bloqueios` preenchido e SEM os campos de
 * imposto. Nota com imposto silenciosamente zerado é o defeito que este módulo
 * existe para eliminar: é melhor barrar a emissão do que emitir subdeclarado.
 */

/** Arredonda para 2 casas sem arrastar resíduo de ponto flutuante. */
const duasCasas = (valor: number) =>
  Math.round((valor + Number.EPSILON) * 100) / 100;

const numero = (valor?: number | null) =>
  typeof valor === 'number' && Number.isFinite(valor) ? valor : 0;

const temAliquota = (valor?: number | null): valor is number =>
  typeof valor === 'number' && Number.isFinite(valor) && valor >= 0;

export interface ValoresItem {
  valorProdutos: number;
  frete?: number;
  seguro?: number;
  outrasDespesas?: number;
  /** Desconto incondicional: reduz a base. O condicional não entra aqui. */
  desconto?: number;
}

export interface TributacaoItem {
  icmsCst: string;
  /** Origem da mercadoria (tabela A do CST), '0' a '8'. */
  icmsOrigin?: string | null;
  icmsRate?: number | null;
  /** Percentual de redução da base do ICMS (CST 20). */
  icmsReducao?: number | null;
  /** Modalidade da base do ICMS; 3 = valor da operação. */
  icmsBaseModality?: string | null;
  pisCst?: string | null;
  pisRate?: number | null;
  cofinsCst?: string | null;
  cofinsRate?: number | null;
  ipiCst?: string | null;
  ipiRate?: number | null;
}

export interface IcmsCalculado {
  orig: number;
  CST: string;
  modBC?: number;
  vBC?: number;
  pRedBC?: number;
  pICMS?: number;
  vICMS?: number;
}

export interface TributoCalculado {
  CST: string;
  vBC?: number;
  aliquota?: number;
  valor?: number;
}

export interface ImpostoItemCalculado {
  icms: IcmsCalculado;
  pis: TributoCalculado;
  cofins: TributoCalculado;
  ipi?: TributoCalculado;
  /** Base do item, usada pelos grupos que dependem dela (ST, DIFAL, IBS/CBS). */
  baseOperacao: number;
  /**
   * Impedimentos ao cálculo. Lista vazia significa que o item pode ser
   * transmitido; qualquer item aqui deve barrar a emissão.
   */
  bloqueios: string[];
}

/** CSTs de ICMS que não destacam valor: isenta, não tributada, suspensão. */
const CST_SEM_VALOR = new Set(['40', '41', '50']);

/** CSTs de ICMS cujo cálculo ainda não está implementado. */
const CST_NAO_IMPLEMENTADO: Record<string, string> = {
  '10': 'substituição tributária',
  '30': 'substituição tributária',
  '51': 'diferimento',
  '60': 'ICMS cobrado anteriormente por substituição tributária',
  '70': 'redução de base com substituição tributária',
  '90': 'tributação "outras"',
};

/** CSTs de PIS/COFINS com apuração por alíquota. Os demais não destacam valor. */
const PIS_COFINS_COM_ALIQUOTA = new Set(['01', '02']);

/** CST de IPI de saída tributada. */
const IPI_TRIBUTADO = new Set(['50']);

/**
 * Base de cálculo da operação: valor dos produtos mais acessórias, menos o
 * desconto incondicional. É o ponto de partida do ICMS, do PIS/COFINS e,
 * adiante, dos grupos de ST, DIFAL e IBS/CBS.
 */
export function calcularBaseOperacao(item: ValoresItem): number {
  const bruto =
    numero(item.valorProdutos) +
    numero(item.frete) +
    numero(item.seguro) +
    numero(item.outrasDespesas) -
    numero(item.desconto);
  return duasCasas(Math.max(bruto, 0));
}

function calcularIcms(
  base: number,
  trib: TributacaoItem,
  bloqueios: string[],
): IcmsCalculado {
  const cst = (trib.icmsCst || '').trim();
  const icms: IcmsCalculado = {
    orig: Number(trib.icmsOrigin ?? 0) || 0,
    CST: cst,
  };

  if (!cst) {
    bloqueios.push('CST do ICMS não informado no cadastro do produto.');
    return icms;
  }

  if (CST_SEM_VALOR.has(cst)) return icms;

  const naoImplementado = CST_NAO_IMPLEMENTADO[cst];
  if (naoImplementado) {
    bloqueios.push(
      `CST ${cst} do ICMS (${naoImplementado}) ainda não é calculado pelo sistema.`,
    );
    return icms;
  }

  if (cst !== '00' && cst !== '20') {
    bloqueios.push(`CST ${cst} do ICMS não é reconhecido.`);
    return icms;
  }

  if (!temAliquota(trib.icmsRate)) {
    bloqueios.push(
      `CST ${cst} exige alíquota de ICMS, que não está cadastrada no produto.`,
    );
    return icms;
  }

  // Modalidade 3 = valor da operação, que é a usada aqui. As demais (margem
  // agregada, pauta, tabelada) dependem de dado que o cálculo do item não tem,
  // então não são presumidas.
  icms.modBC = Number(trib.icmsBaseModality ?? 3) || 3;

  let baseIcms = base;
  if (cst === '20') {
    const reducao = trib.icmsReducao;
    if (!temAliquota(reducao) || reducao <= 0 || reducao >= 100) {
      bloqueios.push(
        'CST 20 exige percentual de redução da base entre 0 e 100, não cadastrado no produto.',
      );
      return icms;
    }
    icms.pRedBC = duasCasas(reducao);
    baseIcms = duasCasas(base * (1 - reducao / 100));
  }

  icms.vBC = duasCasas(baseIcms);
  icms.pICMS = duasCasas(trib.icmsRate);
  icms.vICMS = duasCasas((baseIcms * trib.icmsRate) / 100);
  return icms;
}

function calcularPisCofins(
  base: number,
  cst: string | null | undefined,
  aliquota: number | null | undefined,
  rotulo: 'PIS' | 'COFINS',
  bloqueios: string[],
): TributoCalculado {
  const codigo = (cst || '').trim();
  if (!codigo) {
    bloqueios.push(`CST de ${rotulo} não informado no cadastro do produto.`);
    return { CST: codigo };
  }

  if (!PIS_COFINS_COM_ALIQUOTA.has(codigo)) return { CST: codigo };

  if (!temAliquota(aliquota)) {
    bloqueios.push(
      `CST ${codigo} de ${rotulo} exige alíquota, que não está cadastrada no produto.`,
    );
    return { CST: codigo };
  }

  return {
    CST: codigo,
    vBC: duasCasas(base),
    aliquota: duasCasas(aliquota),
    valor: duasCasas((base * aliquota) / 100),
  };
}

function calcularIpi(
  base: number,
  trib: TributacaoItem,
  bloqueios: string[],
): TributoCalculado | undefined {
  const cst = (trib.ipiCst || '').trim();
  if (!cst) return undefined;

  if (!IPI_TRIBUTADO.has(cst)) return { CST: cst };

  if (!temAliquota(trib.ipiRate)) {
    bloqueios.push(
      `CST ${cst} de IPI exige alíquota, que não está cadastrada no produto.`,
    );
    return { CST: cst };
  }

  return {
    CST: cst,
    vBC: duasCasas(base),
    aliquota: duasCasas(trib.ipiRate),
    valor: duasCasas((base * trib.ipiRate) / 100),
  };
}

/**
 * Calcula ICMS, PIS, COFINS e IPI de um item.
 *
 * O retorno traz `bloqueios` não vazio quando algum tributo não pôde ser
 * apurado; nesse caso os campos de valor ficam ausentes de propósito.
 */
export function calcularImpostoItem(
  item: ValoresItem,
  trib: TributacaoItem,
): ImpostoItemCalculado {
  const bloqueios: string[] = [];
  const base = calcularBaseOperacao(item);

  return {
    baseOperacao: base,
    icms: calcularIcms(base, trib, bloqueios),
    pis: calcularPisCofins(base, trib.pisCst, trib.pisRate, 'PIS', bloqueios),
    cofins: calcularPisCofins(
      base,
      trib.cofinsCst,
      trib.cofinsRate,
      'COFINS',
      bloqueios,
    ),
    ipi: calcularIpi(base, trib, bloqueios),
    bloqueios,
  };
}
