/**
 * Alíquota interna do ICMS por UF — a "ALQ intra" do cálculo da ST e do DIFAL.
 *
 * Diferente da alíquota interestadual, que é regra nacional e fixa, esta é
 * definida por lei de cada estado e muda com frequência. Os valores abaixo são
 * um PONTO DE PARTIDA para não exigir o cadastro das 27 UFs antes do primeiro
 * uso — não são fonte de verdade fiscal.
 *
 * Levantados em 31/08/2026 a partir do portal nacional da DIFAL
 * (dfe-portal.svrs.rs.gov.br/Difal/aliquotas) para AC, AL, AP, AM, BA, CE, DF e
 * ES; os demais vêm de conhecimento geral e NÃO foram conferidos na legislação
 * estadual. Por isso cada UF carrega `revisado`, e o ajuste fica disponível ao
 * superadmin sem depender de deploy.
 *
 * Regra de uso: a alíquota efetiva sempre vem de
 * `IcmsAliquotaInternaService.resolver`, que aplica os ajustes por cima destes
 * padrões. Ninguém deve importar PADRAO_ALIQUOTA_INTERNA para calcular imposto.
 */

export interface AliquotaInternaUf {
  /** Alíquota interna geral (modal) da UF, em percentual. */
  aliquota: number;
  /** Conferido em fonte oficial na data do levantamento. */
  revisado: boolean;
}

export const PADRAO_ALIQUOTA_INTERNA: Readonly<
  Record<string, AliquotaInternaUf>
> = Object.freeze({
  // Conferidos no portal nacional da DIFAL em 31/08/2026.
  AC: { aliquota: 19, revisado: true },
  AL: { aliquota: 19, revisado: true },
  AP: { aliquota: 18, revisado: true },
  AM: { aliquota: 18, revisado: true },
  BA: { aliquota: 20.5, revisado: true },
  CE: { aliquota: 18, revisado: true },
  DF: { aliquota: 20, revisado: true },
  ES: { aliquota: 17, revisado: true },

  // Não conferidos: valores de partida, sujeitos a ajuste pelo superadmin.
  GO: { aliquota: 19, revisado: false },
  MA: { aliquota: 22, revisado: false },
  MT: { aliquota: 17, revisado: false },
  MS: { aliquota: 17, revisado: false },
  MG: { aliquota: 18, revisado: false },
  PA: { aliquota: 19, revisado: false },
  PB: { aliquota: 20, revisado: false },
  PR: { aliquota: 19.5, revisado: false },
  PE: { aliquota: 20.5, revisado: false },
  PI: { aliquota: 21, revisado: false },
  RJ: { aliquota: 20, revisado: false },
  RN: { aliquota: 20, revisado: false },
  RS: { aliquota: 17, revisado: false },
  RO: { aliquota: 19.5, revisado: false },
  RR: { aliquota: 20, revisado: false },
  SC: { aliquota: 17, revisado: false },
  SP: { aliquota: 18, revisado: false },
  SE: { aliquota: 19, revisado: false },
  TO: { aliquota: 20, revisado: false },
});

export const UFS = Object.freeze(Object.keys(PADRAO_ALIQUOTA_INTERNA).sort());

export const normalizarUf = (uf?: string | null) =>
  (uf || '').trim().toUpperCase().slice(0, 2);

export function isUfValida(uf?: string | null): boolean {
  return normalizarUf(uf) in PADRAO_ALIQUOTA_INTERNA;
}
