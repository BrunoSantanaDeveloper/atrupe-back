import { isRegimeNormal } from './regime-tributario.util';

/**
 * Valores iniciais do cadastro fiscal de um produto, conforme o regime do
 * emissor.
 *
 * O CST de ICMS era o literal '102' em todo lugar que cria cadastro fiscal
 * (getOrCreateWithDefaults, alteração de NCM em massa e o backfill). 102 é
 * CSOSN, do Simples Nacional: para um emissor no Regime Normal (CRT 3) o
 * cálculo de imposto recusa a emissão com "o código 102 é CSOSN e não vale no
 * Regime Normal". Ou seja, todo produto criado por esses caminhos já nascia
 * bloqueado para quem migrou de regime.
 *
 * Isto resolve o código, não a alíquota: no Regime Normal o CST 00 exige
 * `icmsRate` cadastrada, e sem ela a emissão continua bloqueada — com a
 * mensagem certa, que aponta a alíquota faltante em vez de mandar trocar o
 * CST. PIS e COFINS ficam em 99 ("outras operações") nos dois regimes, que
 * não exige alíquota e não bloqueia.
 *
 * O MEI entra pelo caminho do Simples: apura no DAS e não destaca ICMS, então
 * nasce com CSOSN 102 (sem permissão de crédito) como os demais optantes.
 */
export interface DefaultsCadastroFiscal {
  cfopOutState: string;
  commercialUnit: string;
  icmsOrigin: string;
  icmsCst: string;
  pisCst: string;
  cofinsCst: string;
}

export { isRegimeNormal };

export function defaultsCadastroFiscal(
  emitCrt?: number | null,
): DefaultsCadastroFiscal {
  return {
    cfopOutState: '6101',
    commercialUnit: 'UN',
    icmsOrigin: '0',
    // 00 = tributada integralmente (Regime Normal); 102 = CSOSN sem permissão
    // de crédito (Simples Nacional).
    icmsCst: isRegimeNormal(emitCrt) ? '00' : '102',
    pisCst: '99',
    cofinsCst: '99',
  };
}
