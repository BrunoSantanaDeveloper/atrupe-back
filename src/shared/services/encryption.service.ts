import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class EncryptionService implements OnModuleInit {
  private keyring: Map<string, Buffer> = new Map();
  private activeKeyId: string;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    this.loadKeyring();
  }

  private loadKeyring() {
    const keyringJson = this.configService.get<string>(
      'DATABASE_ENCRYPTION_KEYRING',
    );
    const activeKeyId = this.configService.get<string>(
      'DATABASE_ENCRYPTION_ACTIVE_KEY_ID',
    );

    if (!keyringJson || !activeKeyId) {
      console.error(
        'CRITICAL_BOOTSTRAP_ERROR: DATABASE_ENCRYPTION_KEYRING ou DATABASE_ENCRYPTION_ACTIVE_KEY_ID ausentes.',
      );
      process.exit(1);
    }

    try {
      const parsed = JSON.parse(keyringJson);
      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('Keyring não é um objeto válido');
      }

      for (const [keyId, hexKey] of Object.entries(parsed)) {
        if (typeof hexKey !== 'string') {
          throw new Error(`Chave para ${keyId} não é uma string`);
        }
        const keyBuffer = Buffer.from(hexKey, 'hex');
        if (keyBuffer.length !== 32) {
          throw new Error(
            `Chave ${keyId} deve ter exatamente 32 bytes (64 caracteres hex)`,
          );
        }
        this.keyring.set(keyId, keyBuffer);
      }

      if (!this.keyring.has(activeKeyId)) {
        throw new Error(`Chave ativa ${activeKeyId} não encontrada no keyring`);
      }

      this.activeKeyId = activeKeyId;
    } catch (error) {
      console.error(
        'CRITICAL_BOOTSTRAP_ERROR: Erro ao carregar o keyring de criptografia:',
        error.message,
      );
      process.exit(1);
    }
  }

  generateAAD(params: {
    table: string;
    recordId: string;
    companyId: string;
    field: string;
    scope: 'HOMOLOGACAO' | 'PRODUCAO' | 'GLOBAL';
  }): Buffer {
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

    const format = parts.join(':');
    return Buffer.from(format, 'utf8');
  }

  encrypt(
    plaintext: string,
    aadParams: {
      table: string;
      recordId: string;
      companyId: string;
      field: string;
      scope: 'HOMOLOGACAO' | 'PRODUCAO' | 'GLOBAL';
    },
  ): string {
    if (plaintext === null || plaintext === undefined) return plaintext;

    const activeKey = this.keyring.get(this.activeKeyId);
    if (!activeKey) {
      throw new Error(
        `Chave ativa ${this.activeKeyId} indisponível no keyring`,
      );
    }

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', activeKey, iv);

    const aad = this.generateAAD(aadParams);
    cipher.setAAD(aad);

    let ciphertext = cipher.update(plaintext, 'utf8', 'base64url');
    ciphertext += cipher.final('base64url');

    const tag = cipher.getAuthTag().toString('base64url');
    const ivStr = iv.toString('base64url');

    return `enc:v1:${this.activeKeyId}:${ivStr}:${tag}:${ciphertext}`;
  }

  decrypt(
    envelope: string,
    aadParams: {
      table: string;
      recordId: string;
      companyId: string;
      field: string;
      scope: 'HOMOLOGACAO' | 'PRODUCAO' | 'GLOBAL';
    },
  ): string {
    if (envelope === null || envelope === undefined) return envelope;

    if (!envelope.startsWith('enc:v1:')) {
      throw new Error(
        'Cifra malformada: não inicia com o prefixo esperado enc:v1:',
      );
    }

    const parts = envelope.split(':');
    if (parts.length !== 6) {
      throw new Error(
        `Cifra malformada: esperado 6 segmentos, recebido ${parts.length}`,
      );
    }

    const [, , keyId, ivStr, tagStr, ciphertextStr] = parts;

    if (!/^[A-Za-z0-9_-]+$/.test(keyId)) {
      throw new Error(`ID da chave inválido: ${keyId}`);
    }

    const key = this.keyring.get(keyId);
    if (!key) {
      throw new Error(
        `Chave ${keyId} necessária para decifragem não encontrada no keyring`,
      );
    }

    const iv = Buffer.from(ivStr, 'base64url');
    if (iv.length !== 12) {
      throw new Error(`IV inválido: esperado 12 bytes, recebido ${iv.length}`);
    }

    const tag = Buffer.from(tagStr, 'base64url');
    if (tag.length !== 16) {
      throw new Error(
        `Tag inválida: esperado 16 bytes, recebido ${tag.length}`,
      );
    }

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    const aad = this.generateAAD(aadParams);
    decipher.setAAD(aad);

    try {
      let plaintext = decipher.update(ciphertextStr, 'base64url', 'utf8');
      plaintext += decipher.final('utf8');
      return plaintext;
    } catch (error) {
      throw new Error(
        `Erro na descriptografia (tag mismatch ou AAD inválido): ${error.message}`,
      );
    }
  }

  reEncrypt(
    envelope: string,
    newKeyId: string,
    aadParams: {
      table: string;
      recordId: string;
      companyId: string;
      field: string;
      scope: 'HOMOLOGACAO' | 'PRODUCAO' | 'GLOBAL';
    },
  ): string {
    if (envelope === null || envelope === undefined) return envelope;

    const plaintext = this.decrypt(envelope, aadParams);

    const originalActive = this.activeKeyId;
    try {
      this.activeKeyId = newKeyId;
      return this.encrypt(plaintext, aadParams);
    } finally {
      this.activeKeyId = originalActive;
    }
  }
}
