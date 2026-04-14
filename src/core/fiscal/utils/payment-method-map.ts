/**
 * Maps internal PaymentMethod.code to SEFAZ tPag code.
 * Reference: Manual de Integração – Nota Fiscal Eletrônica (NF-e/NFC-e)
 *
 * Codes:
 * 01 = Dinheiro, 02 = Cheque, 03 = Cartão Crédito, 04 = Cartão Débito,
 * 05 = Crédito Loja, 10 = Vale Alimentação, 11 = Vale Refeição,
 * 12 = Vale Presente, 13 = Vale Combustível, 14 = Duplicata Mercantil,
 * 15 = Boleto Bancário, 16 = Depósito Bancário, 17 = PIX,
 * 18 = Transferência bancária, 90 = Sem Pagamento, 99 = Outros
 */
const PAYMENT_METHOD_TO_SEFAZ: Record<string, string> = {
  DIN: '01', // Dinheiro
  CHQ: '02', // Cheque
  CRD: '03', // Cartão de Crédito
  DEB: '04', // Cartão de Débito
  BOL: '15', // Boleto Bancário
  DEP: '16', // Depósito Bancário
  PIX: '17', // Pix
  LKP: '99', // Link de Pagamento → Outros
  PER: '99', // Permuta → Outros
  PGM: '99', // Pagamento Mensal → Outros
};

/**
 * Converts internal payment method code to SEFAZ tPag code.
 * Falls back to '99' (Outros) for unknown methods.
 */
export function getTPag(paymentMethodCode: string | null | undefined): string {
  if (!paymentMethodCode) return '99';
  return PAYMENT_METHOD_TO_SEFAZ[paymentMethodCode.toUpperCase()] || '99';
}
