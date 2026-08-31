/**
 * Traduz o resultado do cálculo de tributos para o formato de payload do
 * provedor, e soma os totalizadores da nota.
 *
 * Os nomes dos campos seguem o schema oficial `Invoicy_NFe-NFCe v4.00.xsd` e
 * têm sufixos que não são intuitivos — o valor do ICMS é `vICMS_icms`, e o IPI
 * fica aninhado num grupo `CSTIPI` que exige `cEnq` ao lado. Conferir o schema
 * antes de mexer aqui: nome errado é campo silenciosamente ignorado.
 */
import { calcularDifal, incideDifal } from './difal.util';
import type { InvoicyNfeImposto } from '../invoicy/invoicy.types';
import {
  calcularImpostoItem,
  type ImpostoItemCalculado,
  type TributacaoItem,
  type ValoresItem,
} from './imposto-item.util';

const duasCasas = (valor: number) =>
  Math.round((valor + Number.EPSILON) * 100) / 100;

/** O layout transporta valores monetários como texto com duas casas. */
const moeda = (valor: number) => duasCasas(valor).toFixed(2);

export interface ItemParaCalculo {
  valores: ValoresItem;
  tributacao: TributacaoItem;
  /** Código de enquadramento legal do IPI; 999 = tributação normal. */
  ipiEnquadramento?: string | null;
}

export interface ContextoOperacaoNfe {
  interestadual: boolean;
  consumidorFinal: boolean;
  /** Destinatário contribuinte do ICMS (indIEDest = 1). */
  contribuinte: boolean;
  /** Alíquota interestadual da operação, quando interestadual. */
  aliquotaInterestadual?: number | null;
  /** Alíquota interna da UF de destino, para o DIFAL. */
  aliquotaInternaDestino?: number | null;
  /** Alíquota do FCP na UF de destino. */
  aliquotaFcpDestino?: number | null;
}

/** O payload do item é exatamente o grupo de impostos que o provedor espera. */
export type ImpostoPayload = InvoicyNfeImposto;

export interface TotaisNfe {
  vBC_ttlnfe: string;
  vICMS_ttlnfe: string;
  vBCST_ttlnfe: string;
  vST_ttlnfe: string;
  vFCPST_ttlnfe?: string;
  vIPI_ttlnfe: string;
  vPIS_ttlnfe: string;
  vCOFINS_ttlnfe: string;
  vFCPUFDest_ttlnfe?: string;
  vICMSUFDest_ttlnfe?: string;
  vICMSUFRemet_ttlnfe?: string;
}

export interface ImpostosNfeMontados {
  impostos: ImpostoPayload[];
  totais: TotaisNfe;
  /** Impedimentos acumulados de todos os itens. Não vazio deve barrar a emissão. */
  bloqueios: string[];
}

function montarIcms(calc: ImpostoItemCalculado): ImpostoPayload['ICMS'] {
  const { icms } = calc;
  const saida: ImpostoPayload['ICMS'] = { orig: icms.orig, CST: icms.CST };

  if (icms.vBC === undefined) {
    // CST 30 tem ST sem ICMS próprio: o grupo de ST vai mesmo sem base própria.
    aplicarSt(saida, icms);
    return saida;
  }

  saida.modBC = icms.modBC;
  if (icms.pRedBC !== undefined) saida.pRedBC = icms.pRedBC;
  saida.vBC = icms.vBC;
  saida.pICMS = icms.pICMS;
  // Nome do schema: o valor do ICMS próprio é vICMS_icms, não vICMS.
  saida.vICMS_icms = icms.vICMS;
  aplicarSt(saida, icms);
  return saida;
}

/** Acrescenta o grupo de ST ao ICMS, quando o CST o exige. */
function aplicarSt(
  saida: ImpostoPayload['ICMS'],
  icms: ImpostoItemCalculado['icms'],
): void {
  const { st } = icms;
  if (!st) return;

  saida.modBCST = st.modBCST;
  saida.pMVAST = st.pMVAST;
  if (st.pRedBCST !== undefined) saida.pRedBCST = st.pRedBCST;
  saida.vBCST = st.vBCST;
  saida.pICMSST = st.pICMSST;
  saida.vICMSST_icms = st.vICMSST;

  if (st.vFCPST !== undefined) {
    saida.vBCFCPST = st.vBCFCPST;
    saida.pFCPST = st.pFCPST;
    saida.vFCPST = st.vFCPST;
  }
}

function montarPis(calc: ImpostoItemCalculado): ImpostoPayload['PIS'] {
  const { pis } = calc;
  const saida: ImpostoPayload['PIS'] = { CST_pis: pis.CST };
  if (pis.valor === undefined) return saida;
  saida.vBC_pis = pis.vBC;
  saida.pPIS = pis.aliquota;
  saida.vPIS = pis.valor;
  return saida;
}

function montarCofins(calc: ImpostoItemCalculado): ImpostoPayload['COFINS'] {
  const { cofins } = calc;
  const saida: ImpostoPayload['COFINS'] = { CST_cofins: cofins.CST };
  if (cofins.valor === undefined) return saida;
  saida.vBC_cofins = cofins.vBC;
  saida.pCOFINS = cofins.aliquota;
  saida.vCOFINS = cofins.valor;
  return saida;
}

/**
 * Grupo do IPI. O schema exige `cEnq` e o subgrupo `CSTIPI` — o formato antigo,
 * com `CST_ipi` solto, não corresponde ao layout e é ignorado pelo provedor.
 */
function montarIpi(
  calc: ImpostoItemCalculado,
  enquadramento?: string | null,
): ImpostoPayload['IPI'] {
  const { ipi } = calc;
  if (!ipi) return undefined;

  const cstipi: NonNullable<ImpostoPayload['IPI']>['CSTIPI'] = {
    CST_IPI: ipi.CST,
  };
  if (ipi.valor !== undefined) {
    cstipi.vBC_IPI = ipi.vBC;
    cstipi.pIPI = ipi.aliquota;
    cstipi.vIPI = ipi.valor;
  }

  return {
    cEnq: (enquadramento || '').trim() || '999',
    CSTIPI: cstipi,
  };
}

/**
 * Monta os grupos de imposto de todos os itens e os totalizadores da nota.
 *
 * O DIFAL é calculado uma vez por item, sobre a base do próprio item, e só
 * quando a operação se enquadra na EC 87/15.
 */
export function montarImpostosNfe(
  itens: ItemParaCalculo[],
  ctx: ContextoOperacaoNfe,
): ImpostosNfeMontados {
  const bloqueios: string[] = [];
  const impostos: ImpostoPayload[] = [];

  const totais = {
    vBC: 0,
    vICMS: 0,
    vBCST: 0,
    vST: 0,
    vFCPST: 0,
    vIPI: 0,
    vPIS: 0,
    vCOFINS: 0,
    vFCPUFDest: 0,
    vICMSUFDest: 0,
    vICMSUFRemet: 0,
  };

  const cabeDifal = incideDifal({
    interestadual: ctx.interestadual,
    consumidorFinal: ctx.consumidorFinal,
    contribuinte: ctx.contribuinte,
  });

  itens.forEach((item, indice) => {
    const calc = calcularImpostoItem(item.valores, item.tributacao);
    const prefixo = `Item ${indice + 1}: `;
    bloqueios.push(...calc.bloqueios.map((b) => prefixo + b));

    const payload: ImpostoPayload = {
      ICMS: montarIcms(calc),
      PIS: montarPis(calc),
      COFINS: montarCofins(calc),
    };

    const ipi = montarIpi(calc, item.ipiEnquadramento);
    if (ipi) payload.IPI = ipi;

    totais.vBC += calc.icms.vBC ?? 0;
    totais.vBCST += calc.icms.st?.vBCST ?? 0;
    totais.vST += calc.icms.st?.vICMSST ?? 0;
    totais.vFCPST += calc.icms.st?.vFCPST ?? 0;
    totais.vICMS += calc.icms.vICMS ?? 0;
    totais.vIPI += calc.ipi?.valor ?? 0;
    totais.vPIS += calc.pis.valor ?? 0;
    totais.vCOFINS += calc.cofins.valor ?? 0;

    if (cabeDifal) {
      const { difal, bloqueios: bloqueiosDifal } = calcularDifal({
        base: calc.baseOperacao,
        aliquotaInterestadual: ctx.aliquotaInterestadual as number,
        aliquotaInternaDestino: ctx.aliquotaInternaDestino as number,
        aliquotaFcpDestino: ctx.aliquotaFcpDestino,
      });
      bloqueios.push(...bloqueiosDifal.map((b) => prefixo + b));

      if (difal) {
        payload.ICMSUFDest = difal;
        totais.vICMSUFDest += difal.vICMSUFDest;
        totais.vICMSUFRemet += difal.vICMSUFRemet;
        totais.vFCPUFDest += difal.vFCPUFDest ?? 0;
      }
    }

    impostos.push(payload);
  });

  const totaisPayload: TotaisNfe = {
    vBC_ttlnfe: moeda(totais.vBC),
    vICMS_ttlnfe: moeda(totais.vICMS),
    vBCST_ttlnfe: moeda(totais.vBCST),
    vST_ttlnfe: moeda(totais.vST),
    vIPI_ttlnfe: moeda(totais.vIPI),
    vPIS_ttlnfe: moeda(totais.vPIS),
    vCOFINS_ttlnfe: moeda(totais.vCOFINS),
  };

  if (totais.vFCPST > 0) {
    totaisPayload.vFCPST_ttlnfe = moeda(totais.vFCPST);
  }

  if (cabeDifal) {
    totaisPayload.vICMSUFDest_ttlnfe = moeda(totais.vICMSUFDest);
    totaisPayload.vICMSUFRemet_ttlnfe = moeda(totais.vICMSUFRemet);
    totaisPayload.vFCPUFDest_ttlnfe = moeda(totais.vFCPUFDest);
  }

  return { impostos, totais: totaisPayload, bloqueios };
}
