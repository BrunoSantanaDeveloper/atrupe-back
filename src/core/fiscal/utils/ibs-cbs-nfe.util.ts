/**
 * Grupo IBS/CBS da NF-e e da NFC-e (Reforma Tributária).
 *
 * A forma do payload segue os exemplos oficiais do provedor
 * (`Layout Integração - Reforma Tributária/Exemplos JSON/NFe`), não o XSD: o
 * schema declara `gIBSCBS` e vários grupos irmãos como obrigatórios, mas os
 * exemplos enviam apenas os que a operação exige — e o CST 410 sai só com os
 * códigos, sem grupo de valores.
 *
 * ATENÇÃO — o grupo só trafega quando a Reforma Tributária está ativa para a
 * empresa no provedor. O layout de emissão vigente NÃO tem estes campos; eles
 * existem apenas no layout paralelo da Reforma, e a ativação é por empresa e
 * por módulo (campo `AtivacaoReformaTributaria`, retornado na consulta de
 * cadastro). Enviar antes disso é campo ignorado em silêncio.
 */
import {
  aliquotasVigentes,
  calcularIbsCbs,
  type IbsCbsAliquotas,
} from './ibs-cbs.util';
import { resolverCstIbsCbs } from './ibs-cbs-cst.util';

const duasCasas = (valor: number) =>
  Math.round((valor + Number.EPSILON) * 100) / 100;

export interface GrupoIbsCbs {
  CST: string;
  cClassTrib: string;
  gIBSCBS?: {
    vBC: number;
    gIBSUF: { pIBSUF: number; vIBSUF: number };
    gIBSMun: { pIBSMun: number; vIBSMun: number };
    vIBS: number;
    gCBS: { pCBS: number; vCBS: number };
  };
}

export interface ValoresIbsCbsItem {
  vIBSUF: number;
  vIBSMun: number;
  vIBS: number;
  vCBS: number;
  vBC: number;
}

export interface ResultadoIbsCbsItem {
  grupo?: GrupoIbsCbs;
  valores?: ValoresIbsCbsItem;
  bloqueios: string[];
}

export interface ContextoIbsCbsItem {
  /** Base de cálculo do item. */
  base: number;
  cst?: string | null;
  cClassTrib?: string | null;
  aliquotas: IbsCbsAliquotas;
}

/**
 * Monta o grupo IBS/CBS de um item.
 *
 * CST e cClassTrib são obrigatórios sempre que o grupo é enviado; os valores
 * só entram quando o CST os exige. CST desconhecido ou de grupo próprio não é
 * aproximado: vira bloqueio, para não declarar em `gIBSCBS` o que o layout
 * manda declarar em outro lugar.
 */
export function montarIbsCbsItem(ctx: ContextoIbsCbsItem): ResultadoIbsCbsItem {
  const bloqueios: string[] = [];
  const cst = (ctx.cst || '').trim();
  const cClassTrib = (ctx.cClassTrib || '').trim();

  if (!cst) {
    bloqueios.push('CST do IBS/CBS não informado no cadastro do produto.');
  }
  if (!cClassTrib) {
    bloqueios.push(
      'Código de classificação tributária (cClassTrib) do IBS/CBS não informado no cadastro do produto.',
    );
  }
  if (bloqueios.length) return { bloqueios };

  const regra = resolverCstIbsCbs(cst);
  if (!regra) {
    bloqueios.push(
      `CST ${cst} do IBS/CBS não consta na tabela nacional carregada no sistema.`,
    );
    return { bloqueios };
  }

  if (regra.tratamento === 'GRUPO_PROPRIO') {
    bloqueios.push(
      `CST ${cst} do IBS/CBS (${regra.descricao}) exige o grupo ${regra.grupo}, ainda não implementado.`,
    );
    return { bloqueios };
  }

  const grupo: GrupoIbsCbs = { CST: cst, cClassTrib };

  if (regra.tratamento === 'SOMENTE_CODIGOS') {
    return { grupo, bloqueios };
  }

  const calc = calcularIbsCbs(ctx.base, ctx.aliquotas);

  grupo.gIBSCBS = {
    vBC: calc.base,
    gIBSUF: { pIBSUF: ctx.aliquotas.ibsUf, vIBSUF: calc.ibsUf },
    gIBSMun: { pIBSMun: ctx.aliquotas.ibsMun, vIBSMun: calc.ibsMun },
    vIBS: calc.ibsTotal,
    gCBS: { pCBS: ctx.aliquotas.cbs, vCBS: calc.cbs },
  };

  return {
    grupo,
    valores: {
      vBC: calc.base,
      vIBSUF: calc.ibsUf,
      vIBSMun: calc.ibsMun,
      vIBS: calc.ibsTotal,
      vCBS: calc.cbs,
    },
    bloqueios,
  };
}

export interface TotaisIbsCbs {
  vBCIBSCBS: number;
  gIBS: {
    gIBSUF: { vDif: number; vDevTrib: number; vIBSUF: number };
    gIBSMun: { vDif: number; vDevTrib: number; vIBSMun: number };
    vIBS: number;
    vCredPres: number;
    vCredPresCondSus: number;
  };
  gCBS: {
    vDif: number;
    vDevTrib: number;
    vCBS: number;
    vCredPres: number;
    vCredPresCondSus: number;
  };
}

/**
 * Totalizador `IBSCBSTot` da nota.
 *
 * Diferimento, devolução de tributo e crédito presumido saem zerados porque
 * ainda não são calculados — e o layout exige os campos presentes. Zero aqui é
 * declaração correta de "não houve", não valor omitido: os CSTs que de fato
 * geram esses valores estão bloqueados em `ibs-cbs-cst.util`.
 */
export function montarIbsCbsTotais(itens: ValoresIbsCbsItem[]): TotaisIbsCbs {
  const soma = itens.reduce(
    (acc, item) => ({
      vBC: acc.vBC + item.vBC,
      vIBSUF: acc.vIBSUF + item.vIBSUF,
      vIBSMun: acc.vIBSMun + item.vIBSMun,
      vIBS: acc.vIBS + item.vIBS,
      vCBS: acc.vCBS + item.vCBS,
    }),
    { vBC: 0, vIBSUF: 0, vIBSMun: 0, vIBS: 0, vCBS: 0 },
  );

  return {
    vBCIBSCBS: duasCasas(soma.vBC),
    gIBS: {
      gIBSUF: { vDif: 0, vDevTrib: 0, vIBSUF: duasCasas(soma.vIBSUF) },
      gIBSMun: { vDif: 0, vDevTrib: 0, vIBSMun: duasCasas(soma.vIBSMun) },
      vIBS: duasCasas(soma.vIBS),
      vCredPres: 0,
      vCredPresCondSus: 0,
    },
    gCBS: {
      vDif: 0,
      vDevTrib: 0,
      vCBS: duasCasas(soma.vCBS),
      vCredPres: 0,
      vCredPresCondSus: 0,
    },
  };
}

/**
 * Valor da nota acrescido de IBS e CBS (`vNFIBScbsIS`).
 *
 * O "IS" do nome é o Imposto Seletivo, que **não é calculado por este
 * sistema**. Ele só passa a incidir em 2027, alcança uma lista restrita de
 * bens (fumo, bebidas alcoólicas, bebidas açucaradas, veículos, extração) e
 * não há campo no cadastro do produto para declará-lo — nenhum produto pode,
 * hoje, ser marcado como sujeito ao IS. Portanto a soma abaixo está completa
 * para o que o sistema é capaz de emitir; quando o IS entrar, ele soma aqui.
 *
 * Os exemplos oficiais do provedor divergem para o MESMO item: a NF-e envia
 * 10,10 (valor da nota + IBS + CBS) e a NFC-e envia 10,00. Prevalece a NF-e,
 * porque é o que o nome e a finalidade do campo dizem — ele existe justamente
 * para carregar o total COM os novos tributos, já que a regra nacional manda
 * não somá-los em vProd/vNF durante 2025 e 2026.
 */
export function calcularVNFIBScbsIS(
  valorNota: number,
  totais: TotaisIbsCbs,
): number {
  return duasCasas(valorNota + totais.gIBS.vIBS + totais.gCBS.vCBS);
}

export interface AliquotasReforma {
  /** Alíquotas a aplicar, ou `null` quando a Reforma não está ativa. */
  aliquotas: IbsCbsAliquotas | null;
  /**
   * Falso quando a fase vigente ainda não tem alíquotas confirmadas. Quem
   * chama DEVE barrar a emissão nesse caso: seguir com as alíquotas de teste
   * de 2026 (0,1% + 0,9%) numa fase de alíquotas cheias subdeclararia a nota
   * em duas ordens de grandeza.
   */
  faseCoberta: boolean;
}

/**
 * Alíquotas de IBS/CBS do emissor, quando a Reforma está ativa para ele.
 *
 * As alíquotas do emissor vencem o padrão nacional porque a parcela municipal
 * do IBS é definida por cada município. Compartilhada por NF-e e NFC-e: são o
 * mesmo layout e a mesma ativação.
 */
export function aliquotasReformaTributaria(config: {
  reformaTributariaAtiva?: boolean | null;
  aliquotaIbsUf?: number | null;
  aliquotaIbsMun?: number | null;
  aliquotaCbs?: number | null;
}): AliquotasReforma {
  if (!config?.reformaTributariaAtiva) {
    return { aliquotas: null, faseCoberta: true };
  }

  const padrao = aliquotasVigentes();
  return {
    aliquotas: {
      ibsUf: config.aliquotaIbsUf ?? padrao.aliquotas.ibsUf,
      ibsMun: config.aliquotaIbsMun ?? padrao.aliquotas.ibsMun,
      cbs: config.aliquotaCbs ?? padrao.aliquotas.cbs,
    },
    faseCoberta: padrao.faseCoberta,
  };
}
