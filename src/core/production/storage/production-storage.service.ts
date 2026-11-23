import type { S3Client } from '@aws-sdk/client-s3';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { presignGetUrl, presignPutUrl } from './s3-presign';

/** O link de leitura vale 15 minutos e é refeito a cada leitura (GP-27). */
export const LINK_SECONDS = 15 * 60;

/**
 * O link de envio direto vale 15 minutos para começar o PUT; ele só aceita
 * o tamanho e o tipo declarados ao pedir o link.
 */
export const UPLOAD_LINK_SECONDS = 15 * 60;

/**
 * O armazenamento dos anexos da produção: arte de cliente, então privado.
 * Sem ACL pública (o upload de imagens do sistema é `public-read`); a tela
 * recebe só o link assinado. O bucket é o S3_PRIVATE_BUCKET, ou o de sempre
 * sob o prefixo production/ quando ele não existir.
 */
@Injectable()
export class ProductionStorageService {
  private readonly logger = new Logger(ProductionStorageService.name);
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

  // O SDK carrega só quando grava: quem só lê o link não precisa dele
  private async sdk() {
    this.assertConfigured();
    const { region, accessKeyId, secretAccessKey } = this.settings;
    const sdk = await import('@aws-sdk/client-s3');
    this.client ??= new sdk.S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });
    return { sdk, client: this.client };
  }

  async put(key: string, body: Buffer, mime: string) {
    const { sdk, client } = await this.sdk();
    await client.send(
      new sdk.PutObjectCommand({
        Bucket: this.settings.bucket,
        Key: key,
        Body: body,
        ContentType: mime,
      }),
    );
  }

  /**
   * O link para o navegador enviar o arquivo direto ao armazenamento. O
   * tamanho e o tipo entram na assinatura: o PUT precisa mandar o
   * Content-Type igual ao `mime` (o navegador põe o Content-Length).
   */
  uploadUrl(key: string, size: number, mime: string, now = new Date()) {
    this.assertConfigured();
    return presignPutUrl({
      ...this.settings,
      key,
      contentLength: size,
      contentType: mime,
      expiresSeconds: UPLOAD_LINK_SECONDS,
      now,
    });
  }

  /**
   * O tamanho real do arquivo enviado; nulo quando ele não chegou. Sem a
   * permissão s3:ListBucket, o S3 responde 403 (e não 404) ao arquivo que
   * não existe: os dois valem "não chegou".
   */
  async sizeOf(key: string): Promise<number | null> {
    const { sdk, client } = await this.sdk();
    try {
      const head = await client.send(
        new sdk.HeadObjectCommand({ Bucket: this.settings.bucket, Key: key }),
      );
      return head.ContentLength ?? null;
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      const name = (error as Error).name;
      if (status === 404 || name === 'NotFound') return null;
      if (status === 403 || name === 'Forbidden') {
        // Também é o 403 da credencial errada: fica no log para a operação
        this.logger.warn(`Consulta do arquivo ${key} respondeu 403`);
        return null;
      }
      throw error;
    }
  }

  /** Apaga o arquivo (anexo excluído ou envio recusado pela cota). */
  async remove(key: string) {
    const { sdk, client } = await this.sdk();
    await client.send(
      new sdk.DeleteObjectCommand({ Bucket: this.settings.bucket, Key: key }),
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
