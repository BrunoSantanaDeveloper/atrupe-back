/**
 * Os dados do destinatário que cada nota exige (Lista Lite 19/11, item 9;
 * decisão do Maicol, 20/11/2026): o cadastro aprovado (regularizado) segue
 * com a regra de hoje, e é a emissão da nota que não deixa sair faltando
 * dado. Uma regra só, usada na conferência do cliente e na emissão.
 *
 * - NF-e: documento, nome, endereço completo com número (ou S/N) e a IE do
 *   contribuinte do ICMS (indicador 1)
 * - NFS-e: documento, nome e o CEP (de onde sai o município do tomador)
 * - NFC-e: nada do cliente; o CPF é opcional
 */
export type FiscalDoc = 'NFE' | 'NFSE' | 'NFCE';

export type RecipientData = {
  document?: string | null;
  name?: string | null;
  zipcode?: string | null;
  state?: string | null;
  city?: string | null;
  neighborhood?: string | null;
  street?: string | null;
  number?: string | null;
  indicadorIE?: number | null;
  stateRegistration?: string | null;
  /** Destinatário do exterior: o endereço brasileiro não se aplica */
  foreign?: boolean;
};

const filled = (value?: string | null) => !!value && !!value.trim();

export function missingRecipientFields(
  doc: FiscalDoc,
  data: RecipientData,
): string[] {
  if (doc === 'NFCE') return [];
  const missing: string[] = [];
  const digits = (data.document || '').replace(/\D/g, '');
  if (!data.foreign && digits.length !== 11 && digits.length !== 14) {
    missing.push('CPF ou CNPJ');
  }
  if (!filled(data.name)) missing.push('Nome ou razão social');
  if (data.foreign) return missing;
  if (!filled(data.zipcode)) missing.push('CEP');
  if (doc === 'NFSE') return missing;
  if (!filled(data.street)) missing.push('Rua');
  if (!filled(data.number)) missing.push('Número (ou S/N)');
  if (!filled(data.neighborhood)) missing.push('Bairro');
  if (!filled(data.city)) missing.push('Cidade');
  if (!filled(data.state)) missing.push('UF');
  if (data.indicadorIE === 1 && !filled(data.stateRegistration)) {
    missing.push('Inscrição estadual (contribuinte do ICMS)');
  }
  return missing;
}

export const missingRecipientMessage = (doc: FiscalDoc, missing: string[]) =>
  `Faltam dados do ${doc === 'NFSE' ? 'tomador' : 'destinatário'} para emitir a ${
    doc === 'NFSE' ? 'NFS-e' : 'NF-e'
  }: ${missing.join(', ')}. Complete o cadastro do cliente e emita de novo.`;
