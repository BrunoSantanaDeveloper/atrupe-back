import * as crypto from 'crypto';

export type FiscalScope = 'HOMOLOGACAO' | 'PRODUCAO' | 'GLOBAL';

export interface AadParams {
  table: string;
  recordId: string;
  companyId: string;
  field: string;
  scope: FiscalScope;
}

export interface Keyring {
  keyring: Map<string, Buffer>;
  activeKeyId: string;
}

export function loadKeyring(): Keyring {
  const keyringJson = process.env.DATABASE_ENCRYPTION_KEYRING;
  const activeKeyId = process.env.DATABASE_ENCRYPTION_ACTIVE_KEY_ID;

  if (!keyringJson || !activeKeyId) {
    throw new Error(
      'DATABASE_ENCRYPTION_KEYRING ou DATABASE_ENCRYPTION_ACTIVE_KEY_ID ausentes. ' +
        'Consulte docs/plano6_implantacao_vps_migracao_segredos.md (P0).',
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(keyringJson);
  } catch {
    throw new Error('DATABASE_ENCRYPTION_KEYRING não é um JSON válido.');
  }

  const keyring = new Map<string, Buffer>();
  for (const [keyId, hexKey] of Object.entries(parsed)) {
    if (typeof hexKey !== 'string')
      throw new Error(`Chave ${keyId} deve ser uma string hex.`);
    const buf = Buffer.from(hexKey, 'hex');
    if (buf.length !== 32)
      throw new Error(
        `Chave ${keyId} deve ter exatamente 32 bytes (64 chars hex).`,
      );
    keyring.set(keyId, buf);
  }

  if (!keyring.has(activeKeyId)) {
    throw new Error(`Chave ativa "${activeKeyId}" não encontrada no keyring.`);
  }

  return { keyring, activeKeyId };
}

/**
 * Replica exatamente EncryptionService.generateAAD().
 * Formato: v1:{len}:{table}:{len}:{recordId}:{len}:{companyId}:{len}:{field}:{len}:{scope}
 */
export function generateAAD(params: AadParams): Buffer {
  const { table, recordId, companyId, field, scope } = params;
  const parts = [
    'v1',
    `${Buffer.byteLength(table, 'utf8')}`,
    table,
    `${Buffer.byteLength(recordId, 'utf8')}`,
    recordId,
    `${Buffer.byteLength(companyId, 'utf8')}`,
    companyId,
    `${Buffer.byteLength(field, 'utf8')}`,
    field,
    `${Buffer.byteLength(scope, 'utf8')}`,
    scope,
  ];
  return Buffer.from(parts.join(':'), 'utf8');
}

/**
 * Cifra plaintext com AES-256-GCM.
 * Envelope: enc:v1:{keyId}:{ivBase64url}:{tagBase64url}:{ciphertextBase64url}
 * Replica exatamente EncryptionService.encrypt().
 */
export function encrypt(
  plaintext: string,
  params: AadParams,
  kr: Keyring,
): string {
  const key = kr.keyring.get(kr.activeKeyId)!;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const aad = generateAAD(params);
  cipher.setAAD(aad);
  let ciphertext = cipher.update(plaintext, 'utf8', 'base64url');
  ciphertext += cipher.final('base64url');
  const tag = cipher.getAuthTag().toString('base64url');
  const ivStr = iv.toString('base64url');
  return `enc:v1:${kr.activeKeyId}:${ivStr}:${tag}:${ciphertext}`;
}

/**
 * Decifra envelope para verificar integridade. Replica EncryptionService.decrypt().
 */
export function decrypt(
  envelope: string,
  params: AadParams,
  kr: Keyring,
): string {
  if (!envelope.startsWith('enc:v1:'))
    throw new Error('Envelope malformado: não inicia com enc:v1:');
  const parts = envelope.split(':');
  if (parts.length !== 6)
    throw new Error(
      `Envelope malformado: esperado 6 segmentos, recebido ${parts.length}`,
    );
  const [, , keyId, ivStr, tagStr, ciphertextStr] = parts;
  if (!/^[A-Za-z0-9_-]+$/.test(keyId)) {
    throw new Error(`ID da chave inválido: ${keyId}`);
  }
  const key = kr.keyring.get(keyId);
  if (!key) throw new Error(`Chave "${keyId}" não encontrada no keyring.`);
  const iv = Buffer.from(ivStr, 'base64url');
  if (iv.length !== 12) {
    throw new Error(`IV inválido: esperado 12 bytes, recebido ${iv.length}`);
  }
  const tag = Buffer.from(tagStr, 'base64url');
  if (tag.length !== 16) {
    throw new Error(`Tag inválida: esperado 16 bytes, recebido ${tag.length}`);
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  decipher.setAAD(generateAAD(params));
  let plaintext = decipher.update(ciphertextStr, 'base64url', 'utf8');
  plaintext += decipher.final('utf8');
  return plaintext;
}

/**
 * Deriva o ambiente operacional legado de um emissor (InvoicyConfig row).
 * Espelha FiscalCredentialResolverService.resolveOperationalEnvironment().
 */
export function deriveEnvironment(row: {
  activeEnvironment: string | null;
  environment: string;
  ambiente: number;
}): 'HOMOLOGACAO' | 'PRODUCAO' {
  if (
    row.activeEnvironment === 'PRODUCAO' ||
    row.activeEnvironment === 'HOMOLOGACAO'
  ) {
    return row.activeEnvironment as 'HOMOLOGACAO' | 'PRODUCAO';
  }
  if (row.environment === 'PRODUCAO' || row.ambiente === 1) return 'PRODUCAO';
  return 'HOMOLOGACAO';
}
