/**
 * Cálculo do ICMS retido por substituição tributária.
 *
 * A base da ST é o valor da operação acrescido de frete, seguro, demais
 * despesas transferidas ao adquirente e do IPI, aplicada a margem de valor
 * agregado:
 *
 *   vBCST = (valor da operação + IPI) x (1 + MVA/100) x (1 - redução/100)
 *   vICMSST = vBCST x aliquotaSt/100 - ICMS próprio
 *
 * O IPI entra porque é tributo cujo ônus é transferível ao adquirente — ao
 * contrário da base do ICMS próprio, onde não entra na venda para revenda.
 * O ICMS próprio é subtraído porque já foi destacado na mesma nota; quando o
 * CST não destaca ICMS próprio (30), não há o que subtrair.
 *
 * A MVA a aplicar já vem resolvida por `resolverMva`, que trata o ajuste
 * interestadual e a dispensa do Simples Nacional.
 */

const duasCasas = (valor: number) =>
  Math.round((valor + Number.EPSILON) * 100) / 100;

const percentualValido = (valor?: number | null): valor is number =>
  typeof valor === 'number' && Number.isFinite(valor) && valor >= 0;

export interface ContextoSt {
  /** Base da operação, sem o IPI. */
  baseOperacao: number;
  /** Valor do IPI do item, quando houver. */
  valorIpi?: number | null;
  /** MVA já resolvida (original ou ajustada), em percentual. */
  mva: number;
  /** Alíquota interna do ICMS na UF de destino, em percentual. */
  aliquotaSt: number;
  /** Redução da base da ST, em percentual. */
  reducaoBaseSt?: number | null;
  /** ICMS próprio destacado na nota; zero quando o CST não destaca. */
  icmsProprio?: number | null;
  /** Alíquota do FCP retido por ST, em percentual. */
  aliquotaFcpSt?: number | null;
}

export interface StCalculado {
  /** Modalidade da base da ST; 4 = margem de valor agregado. */
  modBCST: number;
  pMVAST: number;
  pRedBCST?: number;
  vBCST: number;
  pICMSST: number;
  vICMSST: number;
  vBCFCPST?: number;
  pFCPST?: number;
  vFCPST?: number;
}

export interface ResultadoSt {
  st: StCalculado | null;
  bloqueios: string[];
}

/**
 * Calcula o grupo de substituição tributária.
 *
 * Devolve `st: null` com o motivo em `bloqueios` quando falta dado — nunca um
 * valor parcial, que produziria retenção a menor.
 */
export function calcularIcmsSt(ctx: ContextoSt): ResultadoSt {
  const bloqueios: string[] = [];

  if (!percentualValido(ctx.mva)) {
    bloqueios.push(
      'MVA da substituição tributária não cadastrada para a UF de destino.',
    );
  }
  if (!percentualValido(ctx.aliquotaSt) || ctx.aliquotaSt > 100) {
    bloqueios.push(
      'Alíquota interna do ICMS na UF de destino não resolvida para a substituição tributária.',
    );
  }
  const reducao = ctx.reducaoBaseSt;
  if (
    reducao !== undefined &&
    reducao !== null &&
    (!percentualValido(reducao) || reducao >= 100)
  ) {
    bloqueios.push(
      'Redução da base da substituição tributária deve ser um percentual entre 0 e 100.',
    );
  }
  if (bloqueios.length) return { st: null, bloqueios };

  // O IPI integra a base da ST, mas não a do ICMS próprio na venda para revenda.
  const baseComIpi = duasCasas(ctx.baseOperacao + (ctx.valorIpi ?? 0));
  const comMargem = baseComIpi * (1 + ctx.mva / 100);
  const vBCST = duasCasas(
    percentualValido(reducao) ? comMargem * (1 - reducao / 100) : comMargem,
  );

  const icmsProprio = ctx.icmsProprio ?? 0;
  const retido = (vBCST * ctx.aliquotaSt) / 100 - icmsProprio;

  const st: StCalculado = {
    modBCST: 4, // Margem de valor agregado
    pMVAST: duasCasas(ctx.mva),
    vBCST,
    pICMSST: duasCasas(ctx.aliquotaSt),
    // Retenção negativa não existe: quando o ICMS próprio supera o da ST, não
    // há imposto a reter, e enviar valor negativo seria rejeitado.
    vICMSST: duasCasas(Math.max(retido, 0)),
  };

  if (percentualValido(reducao) && reducao > 0)
    st.pRedBCST = duasCasas(reducao);

  const fcp = ctx.aliquotaFcpSt;
  if (percentualValido(fcp) && fcp > 0 && fcp <= 100) {
    st.vBCFCPST = vBCST;
    st.pFCPST = duasCasas(fcp);
    st.vFCPST = duasCasas((vBCST * fcp) / 100);
  }

  return { st, bloqueios };
}
