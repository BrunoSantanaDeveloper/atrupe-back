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
    const controller = new QuotationController(
      service as any,
      abac as any,
      prisma as any,
      {} as any,
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
