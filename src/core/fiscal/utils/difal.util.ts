/**
 * DIFAL — diferencial de alíquotas da EC 87/2015.
 *
 * Incide na venda interestadual a CONSUMIDOR FINAL NÃO CONTRIBUINTE, e é o
 * remetente quem recolhe. É esse o DIFAL que a NF-e destaca no grupo
 * `ICMSUFDest`.
 *
 * Cálculo por base única ("por fora"):
 *
 *   DIFAL = base x (ALQ intra - ALQ inter)
 *
 * com redução da base no destino, quando houver:
 *
 *   DIFAL = [base x (1 - %Red/100)] x (ALQ intra - ALQ inter)
 *
 * A base dupla ("por dentro"), criada pela LC 190/2022, é do DIFAL devido nas
 * operações a CONTRIBUINTE — recolhido pelo destinatário, fora deste grupo.
 *
 * Desde 2019 a partilha é integral para o estado de destino, então
 * `pICMSInterPart` é 100 e o valor da UF remetente é zero. O campo permanece no
 * layout por compatibilidade e continua sendo enviado.
 *
 * O FCP não faz parte da diferença: incide sobre a base do destino e soma-se
 * por fora, com alíquota própria.
 */

const duasCasas = (valor: number) =>
  Math.round((valor + Number.EPSILON) * 100) / 100;

const percentualValido = (valor?: number | null): valor is number =>
  typeof valor === 'number' &&
  Number.isFinite(valor) &&
  valor >= 0 &&
  valor <= 100;

export interface ContextoDifal {
  /** Base da operação (mesma do ICMS próprio, antes de redução do destino). */
  base: number;
  /** Alíquota interestadual aplicada (4, 7 ou 12). */
  aliquotaInterestadual: number;
  /** Alíquota interna da UF de destino. */
  aliquotaInternaDestino: number;
  /** Redução da base concedida pela UF de destino, em percentual. */
  reducaoBaseDestino?: number | null;
  /** Alíquota do Fundo de Combate à Pobreza na UF de destino. */
  aliquotaFcpDestino?: number | null;
}

export interface DifalCalculado {
  vBCUFDest: number;
  pICMSInter: number;
  pICMSUFDest: number;
  /** Partilha destinada à UF de destino; 100 desde 2019. */
  pICMSInterPart: number;
  vICMSUFDest: number;
  /** Zero desde a partilha integral; mantido porque o layout exige o campo. */
  vICMSUFRemet: number;
  vBCFCPUFDest?: number;
  pFCPUFDest?: number;
  vFCPUFDest?: number;
}

export interface ResultadoDifal {
  difal: DifalCalculado | null;
  bloqueios: string[];
}

export interface ContextoOperacaoDifal {
  interestadual: boolean;
  consumidorFinal: boolean;
  /** Destinatário contribuinte do ICMS. */
  contribuinte: boolean;
}

/**
 * O DIFAL da EC 87/15 só cabe na venda interestadual a consumidor final não
 * contribuinte. Fora disso o grupo não deve ser enviado.
 */
export function incideDifal({
  interestadual,
  consumidorFinal,
  contribuinte,
}: ContextoOperacaoDifal): boolean {
  return interestadual && consumidorFinal && !contribuinte;
}

/**
 * Calcula o grupo ICMSUFDest.
 *
 * Devolve `difal: null` com o motivo em `bloqueios` quando falta dado ou a
 * alíquota interna é menor que a interestadual — situação que produziria
 * diferencial negativo e indica cadastro errado, não imposto a recolher.
 */
export function calcularDifal(ctx: ContextoDifal): ResultadoDifal {
  const bloqueios: string[] = [];

  if (!Number.isFinite(ctx.base) || ctx.base < 0) {
    bloqueios.push('Base da operação inválida para o cálculo do DIFAL.');
  }
  if (!percentualValido(ctx.aliquotaInterestadual)) {
    bloqueios.push('Alíquota interestadual não resolvida para o DIFAL.');
  }
  if (!percentualValido(ctx.aliquotaInternaDestino)) {
    bloqueios.push(
      'Alíquota interna da UF de destino não cadastrada. Ajuste em Configurações do sistema.',
    );
  }
  if (bloqueios.length) return { difal: null, bloqueios };

  if (ctx.aliquotaInternaDestino < ctx.aliquotaInterestadual) {
    bloqueios.push(
      `Alíquota interna do destino (${ctx.aliquotaInternaDestino}%) é menor que a interestadual (${ctx.aliquotaInterestadual}%): o diferencial ficaria negativo. Revise a alíquota interna da UF.`,
    );
    return { difal: null, bloqueios };
  }

  const reducao = ctx.reducaoBaseDestino;
  if (reducao !== undefined && reducao !== null && !percentualValido(reducao)) {
    bloqueios.push(
      'Redução da base no destino deve ser um percentual entre 0 e 100.',
    );
    return { difal: null, bloqueios };
  }

  const base = duasCasas(
    percentualValido(reducao) ? ctx.base * (1 - reducao / 100) : ctx.base,
  );

  const difal: DifalCalculado = {
    vBCUFDest: base,
    pICMSInter: duasCasas(ctx.aliquotaInterestadual),
    pICMSUFDest: duasCasas(ctx.aliquotaInternaDestino),
    pICMSInterPart: 100,
    vICMSUFDest: duasCasas(
      (base * (ctx.aliquotaInternaDestino - ctx.aliquotaInterestadual)) / 100,
    ),
    vICMSUFRemet: 0,
  };

  const fcp = ctx.aliquotaFcpDestino;
  if (percentualValido(fcp) && fcp > 0) {
    difal.vBCFCPUFDest = base;
    difal.pFCPUFDest = duasCasas(fcp);
    difal.vFCPUFDest = duasCasas((base * fcp) / 100);
  }

  return { difal, bloqueios };
}
