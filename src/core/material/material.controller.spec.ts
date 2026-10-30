import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { REQUIRED_FEATURE_KEY } from '../plan/guards/feature.guard';
import { MaterialController, PAPER_WITHOUT_COST } from './material.controller';

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
      // Com uma lista, basta uma das chaves (como o PlanControlService)
      enforceFeature: jest.fn(async (_company, key: string | string[]) => {
        const keys = Array.isArray(key) ? key : [key];
        if (!keys.some((item) => features.has(item))) {
          throw new ForbiddenException(`sem ${keys.join(',')}`);
        }
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
      // O corpo da tela de Materiais sempre tem a unidade
      await controller.create(request(), { unit: 'UN' } as any);
      granted.delete('values:values:view');
      await controller.create(request(), { unit: 'UN' } as any);

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

  describe('Papéis no LITE (paper_register sem a base de custos)', () => {
    beforeEach(() => {
      features = new Set(['paper_register']);
      granted = new Set([
        'product_settings:products:view',
        'product_settings:products:edit',
        'values:values:view',
      ]);
      materialService.createPaper = jest.fn().mockResolvedValue({ id: 'p' });
      materialService.updatePaper = jest.fn().mockResolvedValue({ id: 'p' });
      materialService.isPaper = jest.fn().mockResolvedValue(true);
    });

    it('cadastro e edição deixam passar o guard com uma das duas chaves', () => {
      for (const name of ['create', 'update'] as const) {
        expect(
          Reflect.getMetadata(
            REQUIRED_FEATURE_KEY,
            MaterialController.prototype[name],
          ),
        ).toEqual(['cost_base', 'paper_register']);
      }
      // As outras rotas continuam só da base de custos
      expect(
        Reflect.getMetadata(REQUIRED_FEATURE_KEY, MaterialController),
      ).toBe('cost_base');
    });

    it('a lista dos papéis sai sem custo nem preço, mesmo com valores', async () => {
      await controller.findAll(request(), { paper: true });

      expect(materialService.findAll).toHaveBeenCalledWith(
        'c-1',
        { paper: true },
        { values: false, paper: true },
      );
    });

    it('sem ?paper=true, a lista continua pedindo a base de custos', async () => {
      await expect(controller.findAll(request(), {})).rejects.toThrow(
        'sem cost_base',
      );
      expect(materialService.findAll).not.toHaveBeenCalled();
    });

    it('sem nenhuma das duas chaves, nem a lista dos papéis', async () => {
      features = new Set();

      await expect(
        controller.findAll(request(), { paper: true }),
      ).rejects.toThrow('sem cost_base,paper_register');
    });

    it('o cadastro cria o papel', async () => {
      const dto = { name: 'Couché 300 g', sheetFormat: 'SRA3' as const };

      await controller.create(request(), dto);

      expect(materialService.createPaper).toHaveBeenCalledWith('c-1', dto);
      expect(materialService.create).not.toHaveBeenCalled();
    });

    it.each([
      ['custo', { cost: 95 }],
      ['preço', { price: 180 }],
    ])('%s é recusado com o motivo do plano', async (_label, extra) => {
      await expect(
        controller.create(request(), { name: 'Couché', ...extra } as any),
      ).rejects.toThrow(new BadRequestException(PAPER_WITHOUT_COST));
      await expect(
        controller.update(request(), ID, extra as any),
      ).rejects.toThrow(PAPER_WITHOUT_COST);
      expect(materialService.createPaper).not.toHaveBeenCalled();
      expect(materialService.updatePaper).not.toHaveBeenCalled();
    });

    it('campo da tela completa de Materiais pede a base de custos', async () => {
      await expect(
        controller.create(request(), { name: 'Lona', unit: 'M2' } as any),
      ).rejects.toThrow('sem cost_base');
      expect(planControl.enforceFeature).toHaveBeenCalledWith(
        'c-1',
        'cost_base',
      );
      expect(materialService.createPaper).not.toHaveBeenCalled();
    });

    it('a edição do papel vai para o papel; o material que não é papel, 403', async () => {
      await controller.update(request(), ID, { grammage: 250 });
      expect(materialService.isPaper).toHaveBeenCalledWith('c-1', ID);
      expect(materialService.updatePaper).toHaveBeenCalledWith('c-1', ID, {
        grammage: 250,
      });

      materialService.isPaper.mockResolvedValue(false);
      await expect(
        controller.update(request(), ID, { name: 'Lona' }),
      ).rejects.toThrow('sem cost_base');
      expect(materialService.updatePaper).toHaveBeenCalledTimes(1);
      expect(materialService.update).not.toHaveBeenCalled();
    });

    it('com a base de custos, a tela completa segue como hoje', async () => {
      features.add('cost_base');

      await controller.create(request(), { name: 'Lona', unit: 'M2' } as any);
      await controller.update(request(), ID, { cost: 95 });

      expect(materialService.create).toHaveBeenCalled();
      expect(materialService.update).toHaveBeenCalled();
      expect(materialService.createPaper).not.toHaveBeenCalled();
      expect(materialService.updatePaper).not.toHaveBeenCalled();
    });
  });

  // A tela Papéis abre também no PRO (cost_base e paper_register): ela manda
  // só os campos do papel e lê a lista no formato do papel (30/10/2026)
  describe('Papéis no PRO (com a base de custos)', () => {
    beforeEach(() => {
      features = new Set(['cost_base', 'paper_register']);
      granted.add('product_settings:products:edit');
      materialService.createPaper = jest.fn().mockResolvedValue({ id: 'p' });
    });

    it('o corpo da tela Papéis cria o papel, sem pedir unidade', async () => {
      const dto = {
        name: 'Couché 300 g',
        sectorId: 's-1',
        grammage: 300,
        sheetFormat: 'SRA3' as const,
        usableWidth: 310,
        usableHeight: 440,
      };

      await controller.create(request(), dto);

      expect(materialService.createPaper).toHaveBeenCalledWith('c-1', dto);
      expect(materialService.create).not.toHaveBeenCalled();
    });

    it('a lista dos papéis sai no formato do papel, com a folha', async () => {
      await controller.findAll(request(), { paper: true });

      expect(materialService.findAll).toHaveBeenCalledWith(
        'c-1',
        { paper: true },
        { values: false, paper: true },
      );
      expect(planControl.enforceFeature).not.toHaveBeenCalled();
    });
  });
});
