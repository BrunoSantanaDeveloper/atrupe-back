import { ForbiddenException } from '@nestjs/common';
import { MaterialController } from './material.controller';

/**
 * O que o controller decide antes do service: quem lê a lista (a busca de
 * venda direta do orçamento é a exceção), o plano, e as rotas que só valem
 * para quem vê valores.
 */
describe('MaterialController', () => {
  let granted: Set<string>;
  let features: Set<string>;
  let materialService: Record<string, jest.Mock>;
  let importService: Record<string, jest.Mock>;
  let planControl: Record<string, jest.Mock>;
  let controller: MaterialController;

  const request = () => ({ user: { userId: 'u-1', companyId: 'c-1' } });
  const ID = '3f0f7a52-7a0c-4f4e-9a59-0d7f6f3a7b11';

  beforeEach(() => {
    granted = new Set(['product_settings:products:view', 'values:values:view']);
    features = new Set(['cost_base']);
    materialService = {
      findAll: jest.fn().mockResolvedValue({ data: ['material'] }),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      createVariations: jest.fn().mockResolvedValue({}),
      updateVariation: jest.fn().mockResolvedValue({}),
      updatePrice: jest.fn().mockResolvedValue({}),
      usage: jest.fn().mockResolvedValue({ data: [] }),
      toggleStatus: jest.fn().mockResolvedValue({}),
    };
    importService = {
      preview: jest.fn().mockResolvedValue({ data: [] }),
      apply: jest.fn().mockResolvedValue({}),
    };
    const has = (_user: unknown, action: string, resource: string) =>
      granted.has(`${resource}:${action}`);
    const abac = {
      hasPermission: jest.fn(async (user, action, resource) =>
        has(user, action, resource),
      ),
      hasAnyPermission: jest.fn(async (user, list) =>
        list.some((item: any) => has(user, item.action, item.resource)),
      ),
    };
    planControl = {
      hasFeature: jest.fn(async (_company, key) => features.has(key)),
      enforceFeature: jest.fn(async (_company, key) => {
        if (!features.has(key)) throw new ForbiddenException(`sem ${key}`);
      }),
    };
    controller = new MaterialController(
      materialService as any,
      importService as any,
      abac as any,
      planControl as any,
    );
  });

  describe('lista', () => {
    it('a tela de materiais lê a lista inteira, com valores', async () => {
      const result = await controller.findAll(request(), { search: 'lona' });

      expect(result).toEqual({ data: ['material'] });
      expect(materialService.findAll).toHaveBeenCalledWith(
        'c-1',
        { search: 'lona' },
        { values: true, directSale: false },
      );
    });

    it('a entrada de nota também lê a lista', async () => {
      granted = new Set(['stock:invoice_entry:view']);

      await controller.findAll(request(), {});

      expect(materialService.findAll).toHaveBeenCalledWith(
        'c-1',
        {},
        { values: false, directSale: false },
      );
    });

    it('quem só tem o orçamento não lê o cadastro', async () => {
      granted = new Set(['sale:quotation:create']);

      await expect(controller.findAll(request(), {})).rejects.toMatchObject({
        response: {
          code: 'PERMISSION_DENIED',
          permissions: [
            'product_settings:products:view',
            'stock:invoice_entry:view',
          ],
        },
      });
      expect(materialService.findAll).not.toHaveBeenCalled();
    });

    it('quem só tem o orçamento alcança a busca de venda direta', async () => {
      granted = new Set(['sale:quotation:edit']);

      await controller.findAll(request(), { directSale: true });

      expect(materialService.findAll).toHaveBeenCalledWith(
        'c-1',
        { directSale: true },
        { values: false, directSale: true },
      );
    });

    it('a busca de venda direta é só de ativos', async () => {
      granted = new Set(['sale:quotation:edit']);

      await expect(
        controller.findAll(request(), { directSale: true, active: false }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('sem a base de custos, a busca de venda direta responde lista vazia', async () => {
      features = new Set();
      granted = new Set(['sale:quotation:create']);

      expect(
        await controller.findAll(request(), { directSale: true, active: true }),
      ).toEqual({ data: [], page: 1, lastPage: 1, total: 0 });
      expect(materialService.findAll).not.toHaveBeenCalled();
    });

    it('sem a base de custos, a tela de materiais recebe o 403 do plano', async () => {
      features = new Set();

      await expect(controller.findAll(request(), {})).rejects.toThrow(
        'sem cost_base',
      );
      expect(materialService.findAll).not.toHaveBeenCalled();
    });
  });

  describe('valores', () => {
    it('o cadastro leva ao service se quem chama vê valores', async () => {
      await controller.create(request(), {} as any);
      granted.delete('values:values:view');
      await controller.create(request(), {} as any);

      expect(materialService.create.mock.calls[0][2]).toEqual({ values: true });
      expect(materialService.create.mock.calls[1][2]).toEqual({
        values: false,
      });
    });

    it.each([
      ['custo e preço da variação', 'updateVariation'],
      ['preço', 'updatePrice'],
      ['prévia da importação', 'previewImport'],
      ['importação', 'import'],
    ])('%s: recusa quem não vê valores', async (_label, method) => {
      granted = new Set(['product_settings:products:edit']);

      const call =
        method === 'updateVariation'
          ? controller.updateVariation(request(), ID, ID, {})
          : method === 'updatePrice'
            ? controller.updatePrice(request(), ID, {
                rule: 'FIXED',
                price: 100,
              })
            : method === 'previewImport'
              ? controller.previewImport(request(), { rows: [] })
              : controller.import(request(), { rows: [] });

      await expect(call).rejects.toMatchObject({
        response: {
          code: 'PERMISSION_DENIED',
          permissions: ['values:values:view'],
        },
      });
      expect(materialService.updateVariation).not.toHaveBeenCalled();
      expect(materialService.updatePrice).not.toHaveBeenCalled();
      expect(importService.preview).not.toHaveBeenCalled();
      expect(importService.apply).not.toHaveBeenCalled();
    });
  });

  describe('preço', () => {
    const body = { rule: 'FIXED' as const, price: 2600 };

    it('pelo cadastro, basta a base de custos', async () => {
      granted = new Set([
        'product_settings:products:edit',
        'values:values:view',
      ]);

      await controller.updatePrice(request(), ID, body);

      expect(planControl.enforceFeature).not.toHaveBeenCalled();
      expect(materialService.updatePrice).toHaveBeenCalledWith('c-1', ID, body);
    });

    it('só pela permissão da Precificação, exige o recurso dela', async () => {
      granted = new Set(['cost:pricing:edit', 'values:values:view']);

      await expect(controller.updatePrice(request(), ID, body)).rejects.toThrow(
        'sem pricing_center',
      );
      expect(planControl.enforceFeature).toHaveBeenCalledWith(
        'c-1',
        'pricing_center',
      );
      expect(materialService.updatePrice).not.toHaveBeenCalled();

      features.add('pricing_center');
      await controller.updatePrice(request(), ID, body);
      expect(materialService.updatePrice).toHaveBeenCalledTimes(1);
    });
  });

  it('inativar passa a situação e a visão de valores ao service', async () => {
    await controller.toggleStatus(request(), ID, { active: false });

    expect(materialService.toggleStatus).toHaveBeenCalledWith(
      'c-1',
      ID,
      false,
      { values: true },
    );
  });
});
