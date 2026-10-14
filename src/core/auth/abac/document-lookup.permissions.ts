/**
 * Quem pode consultar CPF e CNPJ na base externa (decisão do PO, 14/10): a
 * consulta é paga e devolve dado pessoal. Vale para quem cadastra cliente,
 * fornecedor ou colaborador, e para quem emite nota (o destinatário da nota
 * é preenchido pela mesma consulta).
 */
export const DOCUMENT_LOOKUP_PERMISSIONS = [
  { action: 'create', resource: 'register:client' },
  { action: 'edit', resource: 'register:client' },
  { action: 'create', resource: 'register:supplier' },
  { action: 'edit', resource: 'register:supplier' },
  { action: 'create', resource: 'company_settings:users' },
  { action: 'edit', resource: 'company_settings:users' },
  { action: 'create', resource: 'nota_fiscal:emitir' },
] as const;
