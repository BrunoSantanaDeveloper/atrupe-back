/**
 * CSC da NFC-e: limites e normalização.
 *
 * Quem usa o CSC na emissão é o Invoicy, e ele o lê do cadastro da empresa
 * (`Parametros.NFCe.IDTokenCscSEFAZ` e `CscSEFAZ`), não do payload da nota. O
 * layout desse cadastro (LayoutCadastroEmpresa.xlsx do provedor) limita o
 * identificador a 6 caracteres e o código a 36 — o mesmo formato que o portal
 * da SEFAZ mostra (identificador "1", código em 8-4-4-4-12).
 */
export const CSC_TOKEN_MAX = 36;
export const CSC_ID_PADRAO = /^\d{1,6}$/;

export const MENSAGEM_CSC_ID_INVALIDO =
  'O ID do CSC tem até 6 dígitos (ex.: 1 ou 000001): use o "Identificador" que aparece no portal da SEFAZ.';
export const MENSAGEM_CSC_TOKEN_LONGO =
  'O código do CSC tem até 36 caracteres: confira se não foram copiados caracteres a mais.';

/**
 * Apara as pontas. CSC copiado do portal costuma vir com espaço, e um espaço a
 * mais estoura o campo do provedor (o da Atrupe ficou com 37 caracteres em
 * 23/10/2026). Vazio vira null.
 */
export function aparaCsc(valor?: string | null): string | null {
  const aparado = valor?.trim();
  return aparado ? aparado : null;
}

/** Primeiro problema de formato do CSC, ou null se ele cabe no provedor. */
export function problemaNoCsc(
  cscId: string | null,
  cscToken: string | null,
): string | null {
  if (!cscId || !cscToken) {
    return 'CSC da NFC-e não configurado: informe o ID e o código do CSC no emissor.';
  }
  if (!CSC_ID_PADRAO.test(cscId)) {
    return `${MENSAGEM_CSC_ID_INVALIDO} O valor salvo tem ${cscId.length} caracteres.`;
  }
  if (cscToken.length > CSC_TOKEN_MAX) {
    return MENSAGEM_CSC_TOKEN_LONGO;
  }
  return null;
}
