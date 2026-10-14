import {
  COMPOSED_ITEM_NOT_FOUND,
  COMPOSED_NAME_REQUIRED,
  COMPOSED_NOT_OPEN,
  COMPOSED_WITHOUT_STAGES,
  ComposedItemService,
  withoutCost,
} from './composed-item.service';

describe('item montado na hora (ORC-11, Fase 4.5)', () => {
  let prisma: any;
  let assemblies: any;
  let sale: any;
  let lines: any;
  let service: ComposedItemService;

  beforeEach(() => {
    prisma = {
      quotation: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'q-1', companyId: 'c-1', status: 'OPEN' }),
      },
      quotationDraft: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'd-1',
          companyId: 'c-1',
          name: 'Placa',
          quantity: 1,
          width: 1000,
          height: 1000,
        }),
        update: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      quotationProduct: { findUnique: jest.fn(), create: jest.fn() },
    };
    assemblies = {
      product: jest.fn().mockResolvedValue({ id: 'd-1', draftId: 'd-1' }),
      assemblyOf: jest.fn().mockResolvedValue({ blocks: [] }),
    };
    sale = { draftComposition: jest.fn() };
    lines = { approvedEditable: jest.fn().mockResolvedValue(false) };
    service = new ComposedItemService(prisma, assemblies, sale, lines);
  });

  it('a leitura do rascunho nunca leva o custo, em nenhum nível', () => {
    expect(
      withoutCost({
        margin: null,
        cost: 10,
        tierSummary: [{ unitCost: 1 }],
        blocks: [{ sale: 20, cost: 5, lines: [{ unitCost: 2, sale: 3 }] }],
      }),
    ).toEqual({ blocks: [{ sale: 20, lines: [{ sale: 3 }] }] });
  });

  it('incluir pede o nome e o orçamento em digitação', async () => {
    await expect(
      service.addComposed('q-1', { draftId: 'd-1', name: '  ', quantity: 1 }),
    ).rejects.toThrow(COMPOSED_NAME_REQUIRED);
    prisma.quotation.findUnique.mockResolvedValue({
      id: 'q-1',
      companyId: 'c-1',
      status: 'DONE',
    });
    await expect(
      service.addComposed('q-1', { draftId: 'd-1', name: 'X', quantity: 1 }),
    ).rejects.toThrow(COMPOSED_NOT_OPEN);
    expect(sale.draftComposition).not.toHaveBeenCalled();
  });

  it('refazer só o item montado; aprovado, só em conta sem estoque', async () => {
    prisma.quotationProduct.findUnique.mockResolvedValue({
      id: 'i-1',
      origin: 'PRODUCT',
      draft: null,
    });
    await expect(service.updateComposed('i-1', {})).rejects.toThrow(
      COMPOSED_ITEM_NOT_FOUND,
    );
    prisma.quotationProduct.findUnique.mockResolvedValue({
      id: 'i-1',
      origin: 'COMPOSED',
      draft: { id: 'd-1', name: 'Placa', width: 1000, height: 1000 },
      quotation: { companyId: 'c-1', status: 'APPROVED' },
    });
    await expect(service.updateComposed('i-1', {})).rejects.toThrow(
      COMPOSED_NOT_OPEN,
    );
    expect(lines.approvedEditable).toHaveBeenCalledWith('c-1');
  });

  it('salvar como produto pede ao menos uma etapa', async () => {
    await expect(service.saveAsProduct('q-1', 'd-1', {})).rejects.toThrow(
      COMPOSED_WITHOUT_STAGES,
    );
  });

  it('a limpeza apaga o rascunho sem item com mais de 30 dias', async () => {
    const now = new Date('2026-11-30T03:15:00Z');
    await expect(service.cleanupDrafts(now)).resolves.toBe(2);
    expect(prisma.quotationDraft.deleteMany).toHaveBeenCalledWith({
      where: {
        createdAt: { lt: new Date('2026-10-31T03:15:00Z') },
        items: { none: {} },
      },
    });
  });
});
