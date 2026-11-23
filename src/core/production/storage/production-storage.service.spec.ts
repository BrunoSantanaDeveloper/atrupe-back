import {
  ProductionStorageService,
  UPLOAD_LINK_SECONDS,
} from './production-storage.service';

const ENV = {
  S3_PRIVATE_BUCKET: 'b',
  S3_REGION: 'sa-east-1',
  S3_ACCESS_KEY: 'K',
  S3_SECRET_ACCESS_KEY: 'S',
};

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const [name, value] of Object.entries(ENV)) {
    saved[name] = process.env[name];
    process.env[name] = value;
  }
});

afterEach(() => {
  for (const name of Object.keys(ENV)) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

/** O serviço com o HEAD do S3 trocado pela resposta do teste. */
const withHead = (send: jest.Mock) => {
  const service = new ProductionStorageService();
  Object.assign(service, {
    sdk: async () => ({
      sdk: { HeadObjectCommand: class {} },
      client: { send },
    }),
  });
  return service;
};

const s3Error = (status: number, name: string) =>
  Object.assign(new Error(name), {
    name,
    $metadata: { httpStatusCode: status },
  });

describe('ProductionStorageService', () => {
  it('o link de envio vale 15 minutos e assina o tamanho e o tipo', () => {
    expect(UPLOAD_LINK_SECONDS).toBe(15 * 60);
    const url = new ProductionStorageService().uploadUrl(
      'production/c1/t1/x-arte.pdf',
      1234,
      'application/pdf',
      new Date('2026-11-23T12:00:00Z'),
    );
    expect(url).toContain('X-Amz-Expires=900');
    expect(url).toContain(
      'X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost',
    );
  });

  it('o tamanho real vem do HEAD', async () => {
    const service = withHead(
      jest.fn().mockResolvedValue({ ContentLength: 42 }),
    );
    await expect(service.sizeOf('k')).resolves.toBe(42);
  });

  it('404 e 403 (sem s3:ListBucket) valem "não chegou"', async () => {
    for (const error of [
      s3Error(404, 'NotFound'),
      s3Error(403, 'Forbidden'),
      Object.assign(new Error('x'), { name: 'Forbidden' }),
    ]) {
      const service = withHead(jest.fn().mockRejectedValue(error));
      await expect(service.sizeOf('k')).resolves.toBeNull();
    }
  });

  it('outro erro do armazenamento continua erro', async () => {
    const service = withHead(
      jest.fn().mockRejectedValue(s3Error(500, 'InternalError')),
    );
    await expect(service.sizeOf('k')).rejects.toThrow('InternalError');
  });
});
