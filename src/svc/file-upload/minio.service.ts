// minio.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import { Agent } from 'https';
import { extname } from 'path';

@Injectable()
export class MinioService {
  private minioClient: Minio.Client;
  private bucketName: string;
  private baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    const useSSL = this.configService.get<string>('MINIO_USE_SSL') === 'true';

    // O bucket responde com certificado auto-assinado. Isso era resolvido com
    // process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0', que e' GLOBAL do processo
    // Node: derrubava a verificacao de certificado de TODAS as chamadas HTTPS
    // de saida da API — provedor fiscal, SEFAZ, e-mail —, nao so' do MinIO. Pior,
    // a guarda era `NODE_ENV !== 'production'` e NODE_ENV nao e' definido no
    // container, entao valia em producao tambem.
    //
    // O agent abaixo confina a excecao a conexao com o MinIO. Quando o
    // certificado de MINIO_ENDPOINT for valido, basta MINIO_ALLOW_SELF_SIGNED
    // =false para restaurar a verificacao tambem aqui.
    const allowSelfSigned =
      this.configService.get<string>('MINIO_ALLOW_SELF_SIGNED') !== 'false';

    const transportAgent =
      useSSL && allowSelfSigned
        ? new Agent({ rejectUnauthorized: false })
        : undefined;

    this.minioClient = new Minio.Client({
      endPoint: this.configService.get<string>('MINIO_ENDPOINT') || null,
      port: Number(this.configService.get<string>('MINIO_PORT')),
      useSSL,
      accessKey: this.configService.get<string>('MINIO_ACCESS_KEY'),
      secretKey: this.configService.get<string>('MINIO_SECRET_KEY'),
      ...(transportAgent ? { transportAgent } : {}),
    });
    this.bucketName = this.configService.get<string>('MINIO_BUCKET_NAME');
    this.baseUrl = `https://${this.configService.get('MINIO_ENDPOINT')}/${
      this.bucketName
    }`;
  }

  async createBucketIfNotExists() {
    try {
      const bucketExists = await this.minioClient.bucketExists(this.bucketName);

      if (!bucketExists) {
        await this.minioClient.makeBucket(this.bucketName, 'us-east-1');
      }
    } catch (error) {
      console.error('MinIO connection error:', {
        endpoint: this.configService.get('MINIO_ENDPOINT'),
        port: this.configService.get('MINIO_PORT'),
        bucket: this.bucketName,
        useSSL: this.configService.get('MINIO_USE_SSL'),
        error: error.message,
      });
      throw error;
    }
  }

  async uploadFile(file: Express.Multer.File) {
    const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomSuffix = Math.round(Math.random() * 1e9);
    const fileName = `${datePrefix}-${Date.now()}${randomSuffix}${extname(
      file.originalname,
    )}`;

    await this.minioClient.putObject(
      this.bucketName,
      fileName,
      file.buffer,
      file.size,
      {
        'Content-Type': file.mimetype,
      },
    );
    return `${this.baseUrl}/${fileName}`;
  }

  async getFileUrl(fileName: string) {
    return await this.minioClient.presignedUrl(
      'GET',
      this.bucketName,
      fileName,
    );
  }

  async deleteFile(fileName: string) {
    await this.minioClient.removeObject(this.bucketName, fileName);
  }
}
