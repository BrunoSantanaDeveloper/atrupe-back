import { CompanyStorageService } from './company-storage.service';

describe('CompanyStorageService (armazenamento, GP-49)', () => {
  it('soma por tipo e lista as O.S. que mais ocupam', async () => {
    const version = (size: number, quotationId: string) => ({
      size,
      attachment: { task: { project: { quotationId } } },
    });
    const prisma = {
      productionAttachmentVersion: {
        findMany: jest
          .fn()
          .mockResolvedValue([version(500, 'q1'), version(300, 'q2')]),
      },
      orderFile: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ size: 900, order: { quotationId: 'q2' } }]),
      },
      quotation: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'q2',
            quotationNumber: 12,
            series: { code: 'A' },
            client: { name: 'Padaria' },
            order: { id: 'o2', status: 'COMPLETED' },
          },
          {
            id: 'q1',
            quotationNumber: 7,
            series: null,
            client: { name: 'Mercado' },
            order: null,
          },
        ]),
      },
    };
    const files = { summary: jest.fn().mockResolvedValue({ usedBytes: 1700 }) };
    const storage = { configured: () => true };
    const cleanup = {
      preview: jest.fn().mockResolvedValue({ eligibleBytes: 900 }),
      history: jest.fn().mockResolvedValue([]),
      auto: jest.fn().mockResolvedValue({ enabled: false }),
    };
    const service = new CompanyStorageService(
      prisma as never,
      files as never,
      storage as never,
      cleanup as never,
    );
    const result = await service.overview('c1');
    expect(result.byKind).toEqual({ production: 800, orders: 900 });
    expect(result.cleanableBytes).toBe(900);
    expect(result.largest.map((row) => [row.number, row.bytes])).toEqual([
      ['12-A', 1200],
      ['7', 500],
    ]);
  });
});
