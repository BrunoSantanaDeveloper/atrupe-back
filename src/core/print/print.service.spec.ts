import { NotFoundException } from '@nestjs/common';
import { PrintService } from './print.service';

const A3 = {
  id: 'pap-a3',
  name: 'Couché 300 A3',
  grammage: 300,
  sheetFormat: 'A3',
  sheetWidth: 297,
  sheetHeight: 420,
  usableWidth: null,
  usableHeight: null,
};

const stored = (over: Record<string, unknown> = {}) => ({
  id: 'prod-1',
  bleedMm: null,
  setupSheets: null,
  sector: { bleedMm: 3, setupSheets: 5 },
  items: [{ width: 50, height: 90 }],
  variations: [{ id: 'var-1', paper: A3 }],
  ...over,
});

describe('PrintService', () => {
  let prisma: any;
  let service: PrintService;

  beforeEach(() => {
    prisma = {
      product: {
        findFirst: jest.fn().mockResolvedValue(stored()),
        update: jest.fn(),
      },
    };
    service = new PrintService(prisma);
  });

  it('a configuração diz o que herda do setor e o valor em uso', async () => {
    const settings = await service.settings('emp-1', 'prod-1');
    expect(settings).toMatchObject({
      bleedMm: null,
      sector: { bleedMm: 3, setupSheets: 5 },
      effective: { bleedMm: 3, bleedSource: 'SECTOR', setupSheets: 5 },
    });
    expect(prisma.product.findFirst.mock.calls[0][0].where).toEqual({
      id: 'prod-1',
      companyId: 'emp-1',
    });
  });

  it('produto de outra empresa: 404', async () => {
    prisma.product.findFirst.mockResolvedValue(null);
    await expect(service.settings('emp-2', 'prod-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('grava só o que veio: nulo volta ao do setor', async () => {
    await service.save('emp-1', 'prod-1', { bleedMm: 0, setupSheets: null });
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 'prod-1' },
      data: { bleedMm: 0, setupSheets: null },
    });
  });

  it('a prévia conta com a variação, a medida e a sangria do item', async () => {
    const preview = await service.preview('emp-1', 'prod-1', {
      variationId: 'var-1',
      quantity: 1000,
      printSpec: { bleedMm: 0 },
    });
    expect(preview.bleed).toEqual({ mm: 0, source: 'ITEM' });
    expect(preview.counts[0]).toMatchObject({
      piecesPerSheet: 24,
      sheets: 42,
      setupSheets: 5,
      totalSheets: 47,
    });
  });

  it('variação que não é do produto: 404', async () => {
    await expect(
      service.preview('emp-1', 'prod-1', { variationId: 'outra', quantity: 1 }),
    ).rejects.toThrow(NotFoundException);
  });
});
