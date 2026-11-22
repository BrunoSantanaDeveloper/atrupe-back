import { NotFoundException } from '@nestjs/common';
import { OrderFilesService } from './order-files.service';

const setup = (opts: { sellerId?: string; others?: boolean } = {}) => {
  const prisma = {
    order: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'o1',
        quotation: { sellerId: opts.sellerId ?? 'e1' },
      }),
    },
    orderFile: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'f1',
          fileName: 'projeto.pdf',
          size: 1000,
          mime: 'application/pdf',
          storageKey: 'orders/c1/o1/x-projeto.pdf',
          uploadedBy: 'Ana',
          uploadedAt: new Date('2026-11-22T12:00:00Z'),
          removedAt: null,
        },
        {
          id: 'f2',
          fileName: 'velho.png',
          size: 500,
          mime: 'image/png',
          storageKey: 'orders/c1/o1/y-velho.png',
          uploadedBy: 'Ana',
          uploadedAt: new Date('2026-01-02T12:00:00Z'),
          removedAt: new Date('2026-11-20T03:40:00Z'),
        },
      ]),
    },
  };
  const abac = {
    canAccessOtherSellers: jest.fn().mockResolvedValue(opts.others ?? false),
  };
  const files = { summary: jest.fn().mockResolvedValue({ usedBytes: 1500 }) };
  const storage = {
    configured: () => true,
    signedUrl: (key: string) => `https://s/${key}`,
  };
  const service = new OrderFilesService(
    prisma as never,
    abac as never,
    files as never,
    storage as never,
  );
  return { service, prisma };
};

describe('OrderFilesService (arquivos da O.S., GP-49)', () => {
  it('lista com o link; o apagado na limpeza vem sem link', async () => {
    const { service } = setup();
    const result = await service.list(
      { companyId: 'c1', employeeId: 'e1' },
      'o1',
    );
    expect(result.files.map((file) => file.url)).toEqual([
      'https://s/orders/c1/o1/x-projeto.pdf',
      null,
    ]);
    expect(result.files[1].removedAt).toBe('2026-11-20T03:40:00.000Z');
  });

  it('o vendedor sem acesso aos outros não vê a O.S. de outro', async () => {
    const { service } = setup({ sellerId: 'e2' });
    await expect(
      service.list({ companyId: 'c1', employeeId: 'e1' }, 'o1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('quem vê os outros vendedores, e o administrador, veem', async () => {
    await expect(
      setup({ sellerId: 'e2', others: true }).service.list(
        { companyId: 'c1', employeeId: 'e1' },
        'o1',
      ),
    ).resolves.toBeTruthy();
    await expect(
      setup({ sellerId: 'e2' }).service.list(
        { companyId: 'c1', employeeId: 'e1', isAdmin: true },
        'o1',
      ),
    ).resolves.toBeTruthy();
  });

  it('a O.S. de outra empresa não existe', async () => {
    const { service, prisma } = setup();
    prisma.order.findFirst.mockResolvedValue(null);
    await expect(
      service.list({ companyId: 'c2' }, 'o1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
