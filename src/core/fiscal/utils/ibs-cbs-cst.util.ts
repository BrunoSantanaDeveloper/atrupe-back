/**
 * Tabela de CST do IBS e da CBS (LC 214/2025, Informe Técnico 2025.002).
 *
 * O que decide se a nota leva os VALORES de IBS/CBS não é dedutível do código:
 * é o indicador `ind_gIBSCBS` da tabela nacional, que diz, por CST, se o grupo
 * padrão `gIBSCBS` deve ser preenchido. Alguns CSTs levam valores em grupo
 * PRÓPRIO (monofásica em `gIBSCBSMono`, transferência em `gTransfCred`), e para
 * esses emitir o grupo padrão seria declaração errada — por isso ficam
 * explicitamente bloqueados em vez de aproximados.
 *
 * `verificado` marca o que foi conferido contra os exemplos oficiais do
 * provedor (`Exemplos JSON/NFe/Envio_NFe_CST_000` e `_CST_410`). O restante vem
 * da leitura da tabela publicada e ainda precisa de conferência do contador
 * antes de a Reforma ser ativada para qualquer emissor.
 *
 * A tabela é nacional e uniforme — não varia por emissor —, por isso vive em
 * código e não em parâmetro. Ela é revisada periodicamente (v1.50 em
 * 22/06/2026): quando mudar, o ajuste é aqui, num lugar só.
 */

export type TratamentoIbsCbs =
  /** Preenche o grupo padrão `gIBSCBS` com base, alíquotas e valores. */
  | 'VALORES'
  /** Só CST e cClassTrib; a operação não gera débito de IBS/CBS. */
  | 'SOMENTE_CODIGOS'
  /** Os valores vão em grupo próprio, ainda não implementado. */
  | 'GRUPO_PROPRIO';

export interface RegraCstIbsCbs {
  descricao: string;
  tratamento: TratamentoIbsCbs;
  /** Conferido contra exemplo oficial do provedor. */
  verificado: boolean;
  /** Grupo exigido pelo layout, quando não é o padrão. */
  grupo?: string;
}

export const TABELA_CST_IBS_CBS: Record<string, RegraCstIbsCbs> = {
  '000': {
    descricao: 'Tributação integral',
    tratamento: 'VALORES',
    verificado: true,
  },
  '010': {
    descricao: 'Tributação com alíquotas uniformes',
    tratamento: 'VALORES',
    verificado: false,
  },
  '011': {
    descricao: 'Tributação com alíquotas uniformes reduzidas',
    tratamento: 'VALORES',
    verificado: false,
  },
  '200': {
    descricao: 'Alíquota reduzida',
    tratamento: 'VALORES',
    verificado: false,
  },
  '220': {
    descricao: 'Alíquota fixa',
    tratamento: 'VALORES',
    verificado: false,
  },
  '221': {
    descricao: 'Alíquota fixa proporcional',
    tratamento: 'VALORES',
    verificado: false,
  },
  '222': {
    descricao: 'Redução de base de cálculo',
    tratamento: 'VALORES',
    verificado: false,
  },
  '400': {
    descricao: 'Isenção',
    tratamento: 'SOMENTE_CODIGOS',
    verificado: false,
  },
  '410': {
    descricao: 'Imunidade e não incidência',
    tratamento: 'SOMENTE_CODIGOS',
    verificado: true,
  },
  '510': {
    descricao: 'Diferimento',
    tratamento: 'VALORES',
    verificado: false,
  },
  '515': {
    descricao: 'Diferimento com redução de alíquota',
    tratamento: 'VALORES',
    verificado: false,
  },
  '550': {
    descricao: 'Suspensão',
    tratamento: 'SOMENTE_CODIGOS',
    verificado: false,
  },
  '620': {
    descricao: 'Tributação monofásica',
    tratamento: 'GRUPO_PROPRIO',
    verificado: false,
    grupo: 'gIBSCBSMono',
  },
  '800': {
    descricao: 'Transferência de crédito',
    tratamento: 'GRUPO_PROPRIO',
    verificado: false,
    grupo: 'gTransfCred',
  },
  '810': {
    descricao: 'Ajuste de IBS na Zona Franca de Manaus',
    tratamento: 'GRUPO_PROPRIO',
    verificado: false,
    grupo: 'gCredPresIBSZFM',
  },
  '811': {
    descricao: 'Ajustes',
    tratamento: 'GRUPO_PROPRIO',
    verificado: false,
    grupo: 'gAjusteCompet',
  },
  '820': {
    descricao: 'Tributação em documento específico',
    tratamento: 'SOMENTE_CODIGOS',
    verificado: false,
  },
  '830': {
    descricao: 'Exclusão da base de cálculo',
    tratamento: 'SOMENTE_CODIGOS',
    verificado: false,
  },
};

/** Regra do CST informado, ou `null` quando o código não está na tabela. */
export function resolverCstIbsCbs(
  cst?: string | null,
): RegraCstIbsCbs | undefined {
  const codigo = (cst || '').trim();
  if (!codigo) return undefined;
  return TABELA_CST_IBS_CBS[codigo];
}
