import type { S3Client } from '@aws-sdk/client-s3';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { presignGetUrl } from './s3-presign';

/** O link de leitura vale 15 minutos e é refeito a cada leitura (GP-27). */
export const LINK_SECONDS = 15 * 60;

/**
 * O armazenamento dos anexos da produção: arte de cliente, então privado.
 * Sem ACL pública (o upload de imagens do sistema é `public-read`); a tela
 * recebe só o link assinado. O bucket é o S3_PRIVATE_BUCKET, ou o de sempre
 * sob o prefixo production/ quando ele não existir.
 */
@Injectable()
export class ProductionStorageService {
  private client: S3Client | null = null;

  private get settings() {
    return {
      bucket: process.env.S3_PRIVATE_BUCKET || process.env.S3_BUCKET || '',
      region: process.env.S3_REGION || '',
      accessKeyId: process.env.S3_ACCESS_KEY || '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    };
  }

  configured() {
    const { bucket, region, accessKeyId, secretAccessKey } = this.settings;
    return !!(bucket && region && accessKeyId && secretAccessKey);
  }

  private assertConfigured() {
    if (!this.configured()) {
      throw new ServiceUnavailableException(
        'O armazenamento de anexos não está configurado',
      );
    }
  }

  async put(key: string, body: Buffer, mime: string) {
    this.assertConfigured();
    const { bucket, region, accessKeyId, secretAccessKey } = this.settings;
    // O SDK carrega só no upload: quem só lê o link não precisa dele
    const { PutObjectCommand, S3Client: Client } = await import(
      '@aws-sdk/client-s3'
    );
    this.client ??= new Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });
    await this.client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: mime,
      }),
    );
  }

  /** O link assinado; sem armazenamento configurado, nulo (a tela avisa). */
  signedUrl(key: string, now = new Date()) {
    if (!this.configured()) return null;
    return presignGetUrl({
      ...this.settings,
      key,
      expiresSeconds: LINK_SECONDS,
      now,
    });
  }
}
