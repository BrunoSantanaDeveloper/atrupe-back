import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { HAS_PERMISSION_KEY } from '../auth/abac/has-permission.decorator';
import { HAS_ANY_PERMISSION_KEY } from '../auth/abac/has-any-permission.decorator';
import {
  FeatureGuard,
  REQUIRED_FEATURE_KEY,
} from '../plan/guards/feature.guard';
import { AssemblyResourceController } from './assembly-resource.controller';
import { ProcessController } from './process.controller';

const P = '7d7f2f8e-4c1b-4d7e-9a43-0f5b1a9c2e10';

/**
 * O que os controllers da composição decidem: plano `cost_base`, as chaves
 * do cadastro de produtos ("[ver]" e "[editar]"), o orçamento só com os
 * processos ativos e os valores só para quem tem `values:values:view`.
 */
describe('ProcessController', () => {
  let granted: Set<string>;
  let service: Record<string, jest.Mock>;
  let controller: ProcessController;
  const request = () => ({ user: { userId: 'u-1', companyId: 'c-1' } });

  beforeEach(() => {
    granted = new Set([
      'product_settings:products:view',
      'product_settings:products:edit',
      'values:values:view',
    ]);
    service = {
      list: jest.fn().mockResolvedValue({ data: [] }),
      detail: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
    };
    const abac = {
      hasPermission: jest.fn(async (_user, action, resource) =>
        granted.has(`${resource}:${action}`),
      ),
    };
    controller = new ProcessController(service as any, abac as any);
  });

  const handlers = () =>
    Object.getOwnPropertyNames(ProcessController.prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => [name, (ProcessController.prototype as any)[name]]);

  it('o controller inteiro pede a base de custos', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ProcessController)).toContain(
      FeatureGuard,
    );
    expect(Reflect.getMetadata(REQUIRED_FEATURE_KEY, ProcessController)).toBe(
      'cost_base',
    );
  });

  it('leitura pede ver produtos; escrita e remoção de linha pedem editar', () => {
    for (const [name, handler] of handlers()) {
      if (name === 'findAll') continue;
      const permission = Reflect.getMetadata(HAS_PERMISSION_KEY, handler);
      const method = Reflect.getMetadata(METHOD_METADATA, handler);
      expect([name, permission]).toEqual([
        name,
        {
          action: method === RequestMethod.GET ? 'view' : 'edit',
          resource: 'product_settings:products',
        },
      ]);
    }
  });

  it('a lista também serve ao orçamento, só com os ativos', async () => {
    expect(
      Reflect.getMetadata(
        HAS_ANY_PERMISSION_KEY,
        ProcessController.prototype.findAll,
      ),
    ).toEqual([
      { action: 'view', resource: 'product_settings:products' },
      { action: 'edit', resource: 'sale:quotation' },
    ]);

    await controller.findAll(request(), { status: 'inativos' });
    granted = new Set(['sale:quotation:edit']);
    await controller.findAll(request(), { status: 'inativos' });

    expect(service.list.mock.calls[0][2]).toEqual({ onlyActive: false });
    expect(service.list.mock.calls[1][2]).toEqual({ onlyActive: true });
  });

  it('o detalhe e o criar levam ao service se quem chama vê valores', async () => {
    await controller.findOne(request(), P, {});
    await controller.create(request(), { name: 'Ilhós', sectorId: P });
    granted.delete('values:values:view');
    await controller.findOne(request(), P, {});
    await controller.create(request(), { name: 'Ilhós', sectorId: P });

    expect(service.detail.mock.calls.map((call) => call[3])).toEqual([
      { values: true },
      { values: false },
    ]);
    expect(service.create.mock.calls.map((call) => call[2])).toEqual([
      { values: true },
      { values: false },
    ]);
  });
});

describe('AssemblyResourceController', () => {
  const page = {
    data: [
      {
        resourceId: 'material:lona',
        kind: 'MATERIAL',
        name: 'Lona',
        unit: 'm²',
        unitCost: 1250,
        unitSale: 2500,
      },
      {
        resourceId: 'material:ilhos',
        kind: 'MATERIAL',
        name: 'Ilhós',
        unit: 'un',
        unitCost: 12,
        unitSale: null,
      },
    ],
    page: 1,
    lastPage: 1,
    total: 2,
  };

  const build = (granted: string[]) =>
    new AssemblyResourceController(
      { list: jest.fn().mockResolvedValue(page) } as any,
      { referenceMarkupOf: jest.fn().mockResolvedValue(1.5) } as any,
      {
        hasPermission: jest.fn(async (_user, action, resource) =>
          granted.includes(`${resource}:${action}`),
        ),
      } as any,
    );
  const request = () => ({ user: { userId: 'u-1', companyId: 'c-1' } });

  it('pede ver produtos e a base de custos', () => {
    expect(
      Reflect.getMetadata(
        HAS_PERMISSION_KEY,
        AssemblyResourceController.prototype.list,
      ),
    ).toEqual({ action: 'view', resource: 'product_settings:products' });
    expect(
      Reflect.getMetadata(REQUIRED_FEATURE_KEY, AssemblyResourceController),
    ).toBe('cost_base');
  });

  it('sem preço próprio, a venda é custo × markup de referência (IP-25)', async () => {
    const result = await build(['values:values:view']).list(request(), {});
    expect(result.data.map((item) => item.unitSale)).toEqual([2500, 18]);
  });

  it('sem a permissão de valores, custo e venda saem', async () => {
    const result = await build([]).list(request(), {});
    expect(result.data[0]).toEqual({
      resourceId: 'material:lona',
      kind: 'MATERIAL',
      name: 'Lona',
      unit: 'm²',
    });
    expect(result.total).toBe(2);
  });
});
