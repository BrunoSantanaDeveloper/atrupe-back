/**
 * Classificação do CRT (Código de Regime Tributário) do emitente.
 *
 * Até aqui cada ponto que precisava saber o regime comparava o número na mão:
 * `>= 3` era Regime Normal, `<= 2` era Simples. Funcionava enquanto só
 * existiam 1, 2 e 3 — com o 4 as duas comparações erram ao mesmo tempo, e para
 * lados opostos: `>= 3` classificaria o MEI como Regime Normal e destacaria
 * ICMS, enquanto `<= 2` o deixaria fora do Simples. Por isso a regra mora aqui
 * e não espalhada por NF-e, NFC-e, NFS-e e cadastro de produto.
 *
 * Valores do layout do provedor (campo CRT, tag B10, modelos 55/65):
 *   1 - Simples Nacional
 *   2 - Simples Nacional - excesso de sublimite de receita bruta
 *   3 - Regime Normal (Lucro Real ou Presumido)
 *   4 - Simples Nacional - Microempreendedor Individual (MEI)
 */
export const CRT_SIMPLES_NACIONAL = 1;
export const CRT_SIMPLES_EXCESSO_SUBLIMITE = 2;
export const CRT_REGIME_NORMAL = 3;
export const CRT_MEI = 4;

/**
 * CRT ausente segue tratado como Simples Nacional: é o que valia antes de o
 * CRT 3 existir e o que mantém inalteradas as notas de quem nunca configurou
 * o campo.
 */
function crtOuPadrao(emitCrt?: number | null): number {
  return emitCrt ?? CRT_SIMPLES_NACIONAL;
}

/**
 * Só o CRT 3 apura e destaca imposto por fora. O MEI é 4, maior que 3, mas
 * apura pelo Simples — daí esta função comparar por igualdade.
 */
export function isRegimeNormal(emitCrt?: number | null): boolean {
  return crtOuPadrao(emitCrt) === CRT_REGIME_NORMAL;
}

/** 1, 2 e 4 são todos optantes do Simples Nacional. */
export function isOptanteSimples(emitCrt?: number | null): boolean {
  const crt = crtOuPadrao(emitCrt);
  return (
    crt === CRT_SIMPLES_NACIONAL ||
    crt === CRT_SIMPLES_EXCESSO_SUBLIMITE ||
    crt === CRT_MEI
  );
}

/** Microempreendedor Individual. */
export function isMei(emitCrt?: number | null): boolean {
  return crtOuPadrao(emitCrt) === CRT_MEI;
}

/**
 * Regime especial de tributação padrão para a NFS-e, na tabela do provedor:
 * 5 = Microempresário Individual (MEI), 6 = ME/EPP.
 *
 * Só há padrão para quem se enquadra numa das duas faixas. O CRT 2 (excesso de
 * sublimite) e o Regime Normal ficam sem padrão de propósito: declarar um
 * regime especial errado numa nota fiscal é pior do que omitir a tag, que é
 * opcional no layout. Quem precisar declara pelo campo do emissor.
 *
 * Esta é a única função do arquivo que lê o CRT cru, sem tratar ausência como
 * Simples: as outras classificam para decidir um cálculo nosso, esta declara
 * um enquadramento dentro da nota. Sem CRT não há o que declarar.
 */
export function regimeEspecialPadraoNfse(
  emitCrt?: number | null,
): number | undefined {
  if (emitCrt === CRT_MEI) return 5;
  if (emitCrt === CRT_SIMPLES_NACIONAL) return 6;
  return undefined;
}
