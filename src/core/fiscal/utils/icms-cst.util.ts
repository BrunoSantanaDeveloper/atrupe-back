import { isRegimeNormal } from './regime-tributario.util';

/**
 * Catálogo de CST e CSOSN de ICMS, em um só lugar.
 *
 * Os conjuntos viviam privados em `imposto-item.util.ts`, onde só o cálculo
 * precisava deles. A correção de tributação em massa precisa das mesmas listas
 * para duas coisas que o cálculo não faz: montar as opções da tela e recusar,
 * antes de escrever em centenas de produtos, um código que o cálculo depois
 * bloquearia na emissão. Uma segunda cópia das listas divergiria da primeira
 * no dia em que um CST passasse a ser calculado — então o cálculo também
 * importa daqui.
 *
 * Fonte: Anexo I do Convênio s/nº de 1970 (Tabela B, CST) e Anexo do Ajuste
 * SINIEF 7/2005 (CSOSN).
 */

/**
 * CSTs de ICMS que não destacam valor.
 *
 * 40 isenta, 41 não tributada, 50 suspensão e 60 já retido por ST: nenhum tem
 * base nem alíquota a calcular, e por isso nenhum exige alíquota cadastrada.
 *
 * O 60 entra aqui porque o imposto já foi retido numa etapa anterior: os
 * valores retidos vêm do documento de origem, não de cálculo nosso, e todos os
 * campos correspondentes são opcionais no layout.
 */
export const CST_SEM_VALOR = new Set(['40', '41', '50', '60']);

/** CSTs de ICMS com substituição tributária. */
export const CST_COM_ST = new Set(['10', '30', '70']);

/** CSTs de ICMS que destacam ICMS próprio (com redução, quando aplicável). */
export const CST_COM_PROPRIO = new Set(['00', '20', '10', '70']);

/** CSTs que reduzem a base do ICMS próprio. */
export const CST_COM_REDUCAO = new Set(['20', '70']);

/** CSTs de ICMS cujo cálculo ainda não está implementado. */
export const CST_NAO_IMPLEMENTADO: Record<string, string> = {
  '51': 'diferimento',
  '90': 'tributação "outras"',
};

/**
 * CSOSN — códigos de situação tributária do SIMPLES NACIONAL.
 *
 * São inválidos no Regime Normal, mas é o que está em todo produto já
 * cadastrado: o sistema nasceu atendendo só o Simples e o padrão do cadastro
 * é 102. Ao migrar de regime, todos aparecem de uma vez — por isso a mensagem
 * diz o que fazer, em vez de só informar que o código não foi reconhecido.
 */
export const CSOSN = new Set([
  '101',
  '102',
  '103',
  '201',
  '202',
  '203',
  '300',
  '400',
  '500',
  '900',
]);

/** Descrição oficial de cada CST da Tabela B, para a tela de correção. */
const DESCRICAO_CST: Record<string, string> = {
  '00': 'Tributada integralmente',
  '10': 'Tributada e com cobrança do ICMS por substituição tributária',
  '20': 'Com redução de base de cálculo',
  '30': 'Isenta ou não tributada e com cobrança do ICMS por substituição tributária',
  '40': 'Isenta',
  '41': 'Não tributada',
  '50': 'Suspensão',
  '51': 'Diferimento',
  '60': 'ICMS cobrado anteriormente por substituição tributária',
  '70': 'Com redução de base de cálculo e cobrança do ICMS por substituição tributária',
  '90': 'Outras',
};

/** Descrição oficial de cada CSOSN, para a tela de correção. */
const DESCRICAO_CSOSN: Record<string, string> = {
  '101': 'Tributada pelo Simples Nacional com permissão de crédito',
  '102': 'Tributada pelo Simples Nacional sem permissão de crédito',
  '103': 'Isenção do ICMS no Simples Nacional para faixa de receita bruta',
  '201':
    'Tributada com permissão de crédito e com cobrança do ICMS por substituição tributária',
  '202':
    'Tributada sem permissão de crédito e com cobrança do ICMS por substituição tributária',
  '203':
    'Isenção do ICMS para faixa de receita bruta e com cobrança do ICMS por substituição tributária',
  '300': 'Imune',
  '400': 'Não tributada pelo Simples Nacional',
  '500':
    'ICMS cobrado anteriormente por substituição tributária ou por antecipação',
  '900': 'Outros',
};

/** Todos os códigos da Tabela B — os CST do Regime Normal. */
export const CODIGOS_CST: readonly string[] = Object.freeze(
  Object.keys(DESCRICAO_CST),
);

/** Todos os CSOSN do Simples Nacional. */
export const CODIGOS_CSOSN: readonly string[] = Object.freeze(
  Object.keys(DESCRICAO_CSOSN),
);

/**
 * Códigos que pertencem ao OUTRO regime, e por isso não servem a este emissor.
 *
 * Serve para achar, numa base inteira, quem ficou com o código do regime
 * antigo depois de uma migração — nos dois sentidos.
 */
export function codigosCstDeOutroRegime(
  emitCrt?: number | null,
): readonly string[] {
  return isRegimeNormal(emitCrt) ? CODIGOS_CSOSN : CODIGOS_CST;
}

export function isCsosn(cst?: string | null): boolean {
  return CSOSN.has((cst || '').trim());
}

/** CST que destaca ICMS próprio e, por isso, exige alíquota no cadastro. */
export function exigeAliquotaIcms(cst?: string | null): boolean {
  return CST_COM_PROPRIO.has((cst || '').trim());
}

/** CST que reduz a base e, por isso, exige o percentual de redução. */
export function exigeReducaoBase(cst?: string | null): boolean {
  return CST_COM_REDUCAO.has((cst || '').trim());
}

/**
 * CST com substituição tributária: o cálculo precisa da regra de ST do produto
 * na UF de destino (MVA e alíquota interna de lá).
 *
 * Esses dados não são deriváveis — a MVA vem de protocolo entre estados por
 * NCM — e por isso não entram numa correção em massa. A tela avisa, para o
 * código não ser aplicado achando que resolve a emissão por inteiro.
 */
export function exigeRegraSt(cst?: string | null): boolean {
  return CST_COM_ST.has((cst || '').trim());
}

/**
 * O cálculo do Regime Normal sabe montar este CST.
 *
 * 51 e 90 são códigos válidos no layout, mas o sistema ainda não os calcula:
 * gravá-los em massa trocaria um bloqueio de emissão por outro.
 */
export function cstIcmsCalculavel(cst?: string | null): boolean {
  const codigo = (cst || '').trim();
  if (CST_NAO_IMPLEMENTADO[codigo]) return false;
  return (
    CST_SEM_VALOR.has(codigo) ||
    CST_COM_PROPRIO.has(codigo) ||
    CST_COM_ST.has(codigo)
  );
}

export interface OpcaoCstIcms {
  code: string;
  /** "00 - Tributada integralmente" */
  label: string;
  description: string;
  /** Exige `icmsRate` no cadastro do produto. */
  exigeAliquota: boolean;
  /** Exige `icmsReducao` no cadastro do produto. */
  exigeReducao: boolean;
  /** Exige regra de ST por UF em cada produto, que a correção não preenche. */
  exigeRegraSt: boolean;
}

/**
 * Opções de CST oferecidas na correção em massa, conforme o regime do emissor.
 *
 * Só entram os códigos que o sistema calcula: oferecer 51 ou 90 numa tela de
 * correção seria oferecer uma troca de bloqueio. No Simples a lista é a de
 * CSOSN inteira, porque ali os códigos vão para o XML sem cálculo nosso.
 */
export function opcoesCstIcms(emitCrt?: number | null): OpcaoCstIcms[] {
  const codigos = isRegimeNormal(emitCrt)
    ? Object.keys(DESCRICAO_CST).filter((codigo) => cstIcmsCalculavel(codigo))
    : Object.keys(DESCRICAO_CSOSN);

  return codigos.map((code) => {
    const description = DESCRICAO_CST[code] ?? DESCRICAO_CSOSN[code] ?? '';
    return {
      code,
      label: `${code} - ${description}`,
      description,
      exigeAliquota: exigeAliquotaIcms(code),
      exigeReducao: exigeReducaoBase(code),
      exigeRegraSt: exigeRegraSt(code),
    };
  });
}

/**
 * O CST serve ao regime do emissor?
 *
 * Recusa nos dois sentidos de propósito. CSOSN no Regime Normal é o caso que
 * aparece ao migrar de regime e o cálculo já bloqueia na emissão. CST do
 * Regime Normal no Simples é o caminho inverso, que o cálculo nem chega a ver
 * (no Simples a nota leva apenas os códigos) — ia direto para o XML e voltava
 * rejeitado pela SEFAZ.
 */
export function validarCstIcmsParaRegime(
  cst: string,
  emitCrt?: number | null,
): { valid: boolean; message?: string } {
  const codigo = (cst || '').trim();

  if (!codigo) {
    return { valid: false, message: 'Informe o CST de ICMS.' };
  }

  const regimeNormal = isRegimeNormal(emitCrt);

  if (regimeNormal && isCsosn(codigo)) {
    return {
      valid: false,
      message:
        `O código ${codigo} é CSOSN, do Simples Nacional, e não vale no ` +
        'Regime Normal. Escolha um CST do Regime Normal (00 tributado, ' +
        '20 com redução de base, 40 isento, 60 já retido por ST).',
    };
  }

  if (!regimeNormal && !isCsosn(codigo)) {
    return {
      valid: false,
      message:
        `O código ${codigo} é CST do Regime Normal e não vale no Simples ` +
        'Nacional. Escolha um CSOSN (102 tributado sem permissão de ' +
        'crédito, 103 isento por faixa de receita, 500 já retido por ST).',
    };
  }

  if (regimeNormal && !cstIcmsCalculavel(codigo)) {
    const motivo = CST_NAO_IMPLEMENTADO[codigo];
    return {
      valid: false,
      message: motivo
        ? `CST ${codigo} do ICMS (${motivo}) ainda não é calculado pelo sistema: ` +
          'aplicá-lo em massa deixaria os produtos bloqueados para emissão.'
        : `CST ${codigo} do ICMS não é reconhecido.`,
    };
  }

  if (!regimeNormal && !DESCRICAO_CSOSN[codigo]) {
    return { valid: false, message: `CSOSN ${codigo} não é reconhecido.` };
  }

  return { valid: true };
}
