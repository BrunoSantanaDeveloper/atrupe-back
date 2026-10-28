import { BadRequestException } from '@nestjs/common';
import { AiProposalsService } from './ai-proposals.service';
import { AiProposalDeniedError } from './ai-quotation-draft.service';

describe('AiProposalsService', () => {
  const user = {
    userId: 'user-1',
    username: 'vendedor@teste',
    companyId: 'company-1',
    employeeId: 'employee-1',
    isAdmin: false,
  };
  const ids = {
    item: '11111111-1111-4111-8111-111111111111',
    quotation: '22222222-2222-4222-8222-222222222222',
    product: '33333333-3333-4333-8333-333333333333',
    payable: '44444444-4444-4444-8444-444444444444',
  };

  function makeService(
    options: {
      permissions?: (action: string, resource: string) => boolean;
      seller?: string;
      status?: string;
    } = {},
  ) {
    const allow = options.permissions ?? (() => true);
    const prisma = {
      quotationProduct: {
        findFirst: jest.fn().mockResolvedValue({
          id: ids.item,
          quotationId: ids.quotation,
          description: 'Banner',
          technicalDescription: null,
          allowEditDescription: true,
          product: { name: 'Banner' },
        }),
      },
      quotation: {
        findFirst: jest.fn().mockResolvedValue({
          id: ids.quotation,
          sellerId: options.seller ?? 'employee-1',
          status: options.status ?? 'OPEN',
          quotationNumber: 42,
          nextContactAt: null,
          nextContactNote: null,
          client: { name: 'Clínica Sorriso' },
        }),
      },
      pendingSale: { findUnique: jest.fn().mockResolvedValue(null) },
      product: {
        findFirst: jest.fn().mockResolvedValue({
          id: ids.product,
          name: 'Banner',
          technicalDescription: 'antigo',
        }),
      },
      payable: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: ids.payable, description: 'Conta de luz' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      supplier: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const abacService = {
      hasPermission: jest.fn(async (_user, action, resource) =>
        allow(action, resource),
      ),
      hasAnyPermission: jest.fn(async (_user, list) =>
        list.some(({ action, resource }) => allow(action, resource)),
      ),
      canAccessOtherSellers: jest.fn().mockResolvedValue(false),
    };
    const products = { update: jest.fn().mockResolvedValue({}) };
    const quotations = {
      updateProductInQuotation: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    };
    const payables = { updateTitle: jest.fn().mockResolvedValue({}) };
    const service = new AiProposalsService(
      prisma as any,
      abacService as any,
      products as any,
      quotations as any,
      payables as any,
    );
    return { service, prisma, products, quotations, payables };
  }

  describe('descritivo', () => {
    it('do item aberto na tela: propõe e, ao aplicar, grava pelo serviço do item', async () => {
      const { service, quotations } = makeService();

      const payload = await service.buildItemDescription(
        { text: 'Lona 440 g, impressão digital, bainha e ilhós a cada 50 cm.' },
        user,
        { quotationItemId: ids.item },
      );
      expect(payload).toEqual(
        expect.objectContaining({
          target: 'QUOTATION_ITEM',
          id: ids.item,
          name: 'Banner',
          current: null,
        }),
      );

      await service.applyItemDescription(
        payload,
        { text: 'Lona 440 g com ilhós.' },
        user,
      );
      expect(quotations.updateProductInQuotation).toHaveBeenCalledWith(
        ids.item,
        { technicalDescription: 'Lona 440 g com ilhós.' },
      );
    });

    it('item que não permite editar o descritivo: recusa', async () => {
      const { service, prisma } = makeService();
      prisma.quotationProduct.findFirst.mockResolvedValue({
        id: ids.item,
        quotationId: ids.quotation,
        allowEditDescription: false,
      });

      await expect(
        service.buildItemDescription({ text: 'x' }, user, {
          quotationItemId: ids.item,
        }),
      ).rejects.toBeInstanceOf(AiProposalDeniedError);
    });

    it('produto sem permissão de editar produtos: recusa', async () => {
      const { service } = makeService({
        permissions: (_a, resource) => resource !== 'product_settings:products',
      });

      await expect(
        service.buildItemDescription({ text: 'x' }, user, {
          productId: ids.product,
        }),
      ).rejects.toBeInstanceOf(AiProposalDeniedError);
    });

    it('do produto: grava pelo serviço do produto', async () => {
      const { service, products } = makeService();
      const payload = await service.buildItemDescription(
        { text: 'Novo descritivo' },
        user,
        { productId: ids.product },
      );

      await service.applyItemDescription(payload, undefined, user);

      expect(products.update).toHaveBeenCalledWith(ids.product, {
        technicalDescription: 'Novo descritivo',
      });
    });
  });

  describe('categoria do lançamento', () => {
    const history = (description: string, nature: string, supplier = null) => ({
      description,
      natureId: nature,
      subCategoryId: `${nature}-sub`,
      supplierId: supplier,
      nature: { description: `Natureza ${nature}` },
      subCategory: { description: `Sub ${nature}` },
      supplier: supplier ? { name: 'Copel' } : null,
    });

    it('o histórico vota pela categoria mais usada nas descrições parecidas', async () => {
      const { service, prisma } = makeService();
      prisma.payable.findMany.mockResolvedValue([
        history('Conta de luz', 'energia', 'copel'),
        history('Conta de luz março', 'energia', 'copel'),
        history('Conta de água', 'agua'),
      ]);

      const payload = await service.buildFinancialCategory(
        { description: 'conta de luz' },
        user,
        {},
      );

      expect(payload.suggestion).toEqual({
        natureId: 'energia',
        natureName: 'Natureza energia',
        subCategoryId: 'energia-sub',
        subCategoryName: 'Sub energia',
        supplierId: 'copel',
        supplierName: 'Copel',
      });
      expect(payload.confidence).toBe('HIGH');
      expect(prisma.payable.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ companyId: 'company-1' }),
        }),
      );
    });

    it('sem histórico parecido: sem sugestão, com o aviso', async () => {
      const { service } = makeService();

      const payload = await service.buildFinancialCategory(
        { description: 'manutenção da plotter' },
        user,
        {},
      );

      expect(payload.suggestion).toBeNull();
      expect(payload.warnings[0]).toContain('Não há lançamentos parecidos');
    });

    it('lançamento gravado: aplica pelo serviço de contas a pagar', async () => {
      const { service, payables, prisma } = makeService();
      prisma.payable.findMany.mockResolvedValue([
        history('Conta de luz', 'energia', 'copel'),
      ]);
      const payload = await service.buildFinancialCategory(
        { description: 'conta de luz' },
        user,
        { payableId: ids.payable },
      );

      const result = await service.applyFinancialCategory(
        payload,
        undefined,
        user,
      );

      expect(payables.updateTitle).toHaveBeenCalledWith(
        ids.payable,
        {
          natureId: 'energia',
          subCategoryId: 'energia-sub',
          supplierId: 'copel',
        },
        'user-1',
        'vendedor@teste',
      );
      expect(result.payableId).toBe(ids.payable);
    });

    it('lançamento novo (no formulário): devolve os campos sem gravar', async () => {
      const { service, payables, prisma } = makeService();
      prisma.payable.findMany.mockResolvedValue([
        history('Conta de luz', 'energia'),
      ]);
      const payload = await service.buildFinancialCategory(
        { description: 'conta de luz' },
        user,
        {},
      );

      const result = await service.applyFinancialCategory(
        payload,
        undefined,
        user,
      );

      expect(payables.updateTitle).not.toHaveBeenCalled();
      expect(result.fields).toEqual(
        expect.objectContaining({ natureId: 'energia' }),
      );
    });

    it('sem permissão de contas a pagar: recusa', async () => {
      const { service } = makeService({
        permissions: (_a, resource) =>
          resource !== 'financial:payable' && resource !== 'financial:flow',
      });

      await expect(
        service.buildFinancialCategory({ description: 'luz' }, user, {}),
      ).rejects.toBeInstanceOf(AiProposalDeniedError);
    });
  });

  describe('próximo contato', () => {
    const future = new Date(Date.now() + 3 * 86_400_000)
      .toISOString()
      .slice(0, 10);

    it('do orçamento aberto: data e lembrete; aplicar grava pelo serviço do orçamento', async () => {
      const { service, quotations } = makeService({ status: 'DONE' });

      const payload = await service.buildNextContact(
        { date: future, time: '14:30', note: 'ligar para a Juliana' },
        user,
        { quotationId: ids.quotation },
      );
      expect(payload).toEqual(
        expect.objectContaining({
          quotationId: ids.quotation,
          quotationNumber: 42,
          clientName: 'Clínica Sorriso',
          nextContactAt: new Date(`${future}T14:30:00-03:00`).toISOString(),
          note: 'ligar para a Juliana',
        }),
      );

      await service.applyNextContact(payload, undefined, user);
      expect(quotations.update).toHaveBeenCalledWith(
        ids.quotation,
        {
          nextContactAt: payload.nextContactAt,
          nextContactNote: 'ligar para a Juliana',
        },
        'user-1',
        'company-1',
      );
    });

    it('data que já passou: recusa', async () => {
      const { service } = makeService();

      await expect(
        service.buildNextContact({ date: '2020-01-01' }, user, {
          quotationId: ids.quotation,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('orçamento de outro vendedor: recusa', async () => {
      const { service } = makeService({ seller: 'outro' });

      await expect(
        service.buildNextContact({ date: future }, user, {
          quotationId: ids.quotation,
        }),
      ).rejects.toBeInstanceOf(AiProposalDeniedError);
    });

    it('orçamento aprovado (fora da negociação): recusa', async () => {
      const { service } = makeService({ status: 'APPROVED' });

      await expect(
        service.buildNextContact({ date: future }, user, {
          quotationId: ids.quotation,
        }),
      ).rejects.toBeInstanceOf(AiProposalDeniedError);
    });
  });
});
