import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { QuotationController } from './quotation.controller';
import { QuotationCrudService } from './quotation-crud.service';

/**
 * Orçamento de outra empresa: excluir, faturar, duplicar e ler os dados do
 * PDF não conferiam a empresa; e a criação, a edição e a duplicação gravavam
 * a empresa, a série e os cadastros do corpo sem conferir.
 */
describe('Orçamento: outra empresa', () => {
  describe('rotas por id conferem a empresa antes de agir', () => {
    const service = {
      remove: jest.fn(),
      billQuotation: jest.fn(),
      duplicate: jest.fn(),
      getQuotationPdfData: jest.fn(),
    };
    const prisma = {
      quotation: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ companyId: 'empresa-b', sellerId: 'v-b' }),
      },
    };
    const abac = { canAccessOtherSellers: jest.fn().mockResolvedValue(true) };
    const lines = { preview: jest.fn(), add: jest.fn(), remove: jest.fn() };
    const results = { result: jest.fn(), exportPdf: jest.fn() };
    const credit = { quotationCredit: jest.fn(), clientCredit: jest.fn() };
    // O item montado na hora (ORC-11, Fase 4.5)
    const composed = {
      createDraft: jest.fn(),
      draftOf: jest.fn(),
      addComposed: jest.fn(),
      saveAsProduct: jest.fn(),
    };
    const assemblies = { read: jest.fn(), addBlock: jest.fn() };
    const controller = new QuotationController(
      service as any,
      abac as any,
      prisma as any,
      {} as any,
      lines as any,
      results as any,
      credit as any,
      composed as any,
      assemblies as any,
    );
    const req = { user: { userId: 'u-a', companyId: 'empresa-a' } };
    const id = '6f1c2b8e-4d3a-4f5b-9c7d-1e2f3a4b5c6d';

    it.each([
      [
        'DELETE /sale/quotation/:id',
        'remove',
        () => controller.remove(id, req),
      ],
      [
        'POST /sale/quotation/:id/bill',
        'billQuotation',
        () => controller.bill(id, req),
      ],
      [
        'POST /sale/quotation/:id/duplicate',
        'duplicate',
        () => controller.duplicate(id, {} as any, req),
      ],
      [
        'GET /sale/quotation/:id/pdf-data',
        'getQuotationPdfData',
        () => controller.getQuotationPdfData(id, req),
      ],
    ] as const)('%s', async (_label, action, call) => {
      await expect(call()).rejects.toBeInstanceOf(ForbiddenException);
      expect(service[action]).not.toHaveBeenCalled();
    });

    // As linhas acrescentadas dentro do item (ORC-5, Fase 4.2)
    it.each([
      [
        'POST /sale/quotation/:id/item/:itemId/line/preview',
        'preview',
        () => controller.previewItemLine(id, 'item-b', {} as any, req),
      ],
      [
        'POST /sale/quotation/:id/item/:itemId/line',
        'add',
        () => controller.addItemLine(id, 'item-b', {} as any, req),
      ],
      [
        'DELETE /sale/quotation/:id/item/:itemId/line/:lineId',
        'remove',
        () => controller.removeItemLine(id, 'item-b', 'linha-b', req),
      ],
    ] as const)('%s', async (_label, action, call) => {
      await expect(call()).rejects.toBeInstanceOf(ForbiddenException);
      expect(lines[action]).not.toHaveBeenCalled();
    });

    // O resultado previsto da venda (ORC-8, Fase 4.6)
    it.each([
      [
        'GET /sale/quotation/:id/result',
        'result',
        () => controller.getResult(id, req),
      ],
      [
        'GET /sale/quotation/:id/result/export',
        'exportPdf',
        () => controller.exportResult(id, req, {} as any),
      ],
    ] as const)('%s', async (_label, action, call) => {
      await expect(call()).rejects.toBeInstanceOf(ForbiddenException);
      expect(results[action]).not.toHaveBeenCalled();
    });

    // O item montado na hora: o rascunho de outra empresa não é alcançado
    const draftId = '7a2d3c4b-5e6f-4a1b-8c9d-0e1f2a3b4c5d';
    it.each([
      [
        'POST /sale/quotation/:id/composed-draft',
        () => controller.createComposedDraft(id, {} as any, req),
      ],
      [
        'GET /sale/quotation/:id/composed-draft/:draftId/assembly',
        () => controller.readComposedDraft(id, draftId, {} as any, req),
      ],
      [
        'POST /sale/quotation/:id/composed-draft/:draftId/assembly/block',
        () => controller.addComposedBlock(id, draftId, {} as any, req),
      ],
      [
        'POST /sale/quotation/:id/add-composed',
        () => controller.addComposedItem(id, { draftId } as any, req),
      ],
      [
        'POST /sale/quotation/:id/composed-draft/:draftId/save-as-product',
        () => controller.saveComposedAsProduct(id, draftId, {} as any, req),
      ],
    ] as const)('%s', async (_label, call) => {
      await expect(call()).rejects.toBeInstanceOf(ForbiddenException);
      expect(composed.createDraft).not.toHaveBeenCalled();
      expect(composed.draftOf).not.toHaveBeenCalled();
      expect(assemblies.read).not.toHaveBeenCalled();
      expect(assemblies.addBlock).not.toHaveBeenCalled();
    });

    // A conferência de crédito (PO, 14/10)
    it('GET /sale/quotation/:id/credit', async () => {
      await expect(controller.credit(id, req)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(credit.quotationCredit).not.toHaveBeenCalled();
    });

    it('GET /sale/quotation/client-credit/:clientId lê o cliente pela empresa da sessão', async () => {
      credit.clientCredit.mockResolvedValueOnce(null);
      await expect(controller.clientCredit(id, req)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(credit.clientCredit).toHaveBeenCalledWith('empresa-a', id);
    });
  });

  describe('empresa, série e cadastros do corpo', () => {
    let prisma: any;
    let service: QuotationCrudService;

    beforeEach(() => {
      prisma = {
        // A conta da sessão: a empresa A e a filial A2
        company: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'empresa-a', principalCompanyId: null },
            { id: 'filial-a2', principalCompanyId: 'empresa-a' },
          ]),
          findUnique: jest.fn(),
        },
        client: { count: jest.fn().mockResolvedValue(1) },
        employee: { count: jest.fn().mockResolvedValue(1) },
        contactSource: { count: jest.fn().mockResolvedValue(1) },
        quotationTag: { count: jest.fn().mockResolvedValue(1) },
        saleSeries: {
          count: jest.fn().mockResolvedValue(1),
          findUnique: jest.fn(),
          update: jest.fn(),
        },
        quotation: {
          findUnique: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
        },
        contact: { findFirst: jest.fn() },
      };
      prisma.$transaction = jest.fn(async (fn) => fn(prisma));
      service = new QuotationCrudService(prisma);
      jest.spyOn((service as any).logger, 'error').mockImplementation();
    });

    const createDto = {
      companyId: 'empresa-a',
      sellerId: 'vendedor-a',
      clientId: 'cliente-a',
      seriesId: 'serie-a',
    } as any;

    it('criar na empresa de outra conta: 404, sem consumir número de série', async () => {
      await expect(
        service.create(
          { ...createDto, companyId: 'empresa-b' },
          'u-a',
          'empresa-a',
        ),
      ).rejects.toThrow(new NotFoundException('Empresa não encontrada.'));
      expect(prisma.saleSeries.update).not.toHaveBeenCalled();
      expect(prisma.quotation.create).not.toHaveBeenCalled();
    });

    it.each([
      ['cliente', 'client', 'Cliente não encontrado.'],
      ['vendedor', 'employee', 'Vendedor não encontrado.'],
      ['série', 'saleSeries', 'Série não encontrada.'],
    ])(
      'criar com %s de outra empresa: 404, sem consumir número de série',
      async (_label, model, message) => {
        prisma[model].count.mockResolvedValue(0);

        await expect(
          service.create(createDto, 'u-a', 'empresa-a'),
        ).rejects.toThrow(new NotFoundException(message));
        expect(prisma[model].count).toHaveBeenCalledWith({
          where: {
            id: { in: [expect.any(String)] },
            companyId: { in: ['empresa-a', 'filial-a2'] },
          },
        });
        expect(prisma.saleSeries.update).not.toHaveBeenCalled();
      },
    );

    it('criar com responsável e sem cliente: 400, sem consumir número de série', async () => {
      prisma.saleSeries.findUnique.mockResolvedValue({ id: 'serie-a' });
      prisma.company.findUnique.mockResolvedValue({
        id: 'empresa-a',
        principalCompanyId: null,
      });

      await expect(
        service.create(
          {
            ...createDto,
            clientId: undefined,
            contactId: 'contato-de-outra-empresa',
          },
          'u-a',
          'empresa-a',
        ),
      ).rejects.toThrow('Informe um cliente para vincular o responsável.');
      expect(prisma.saleSeries.update).not.toHaveBeenCalled();
      expect(prisma.quotation.create).not.toHaveBeenCalled();
    });

    it('editar com status (tag) de outra empresa: 404, sem gravar', async () => {
      prisma.quotation.findUnique.mockResolvedValue({
        id: 'orcamento-a',
        companyId: 'empresa-a',
        seriesId: 'serie-a',
        series: { code: 'V1' },
      });
      prisma.quotationTag.count.mockResolvedValue(0);

      await expect(
        service.update(
          'orcamento-a',
          { tagId: 'tag-b' } as any,
          'u-a',
          'empresa-a',
        ),
      ).rejects.toThrow(new NotFoundException('Status não encontrado.'));
      expect(prisma.quotation.update).not.toHaveBeenCalled();
    });

    it('a empresa do corpo é a emissora: grava a principal e a filial, como na criação', async () => {
      prisma.quotation.findUnique.mockResolvedValue({
        id: 'orcamento-a',
        companyId: 'empresa-a',
        seriesId: 'serie-a',
        series: { code: 'V1' },
      });
      prisma.quotation.update.mockResolvedValue({ id: 'orcamento-a' });

      await service.update(
        'orcamento-a',
        { companyId: 'filial-a2' } as any,
        undefined,
        'empresa-a',
      );

      expect(prisma.quotation.update).toHaveBeenCalledWith({
        where: { id: 'orcamento-a' },
        data: expect.objectContaining({
          companyId: 'empresa-a',
          subCompanyId: 'filial-a2',
        }),
      });
    });

    it('editar movendo para a empresa de outra conta: 404', async () => {
      prisma.quotation.findUnique.mockResolvedValue({
        id: 'orcamento-a',
        companyId: 'empresa-a',
        seriesId: 'serie-a',
        series: { code: 'V1' },
      });

      await expect(
        service.update(
          'orcamento-a',
          { companyId: 'empresa-b' } as any,
          undefined,
          'empresa-a',
        ),
      ).rejects.toThrow(new NotFoundException('Empresa não encontrada.'));
      expect(prisma.quotation.update).not.toHaveBeenCalled();
    });
  });
});
