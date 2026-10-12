import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { HAS_PERMISSION_KEY } from '../auth/abac/has-permission.decorator';
import {
  FeatureGuard,
  REQUIRED_FEATURE_KEY,
} from '../plan/guards/feature.guard';
import { ProductAssemblyController } from './product-assembly.controller';

const P = '7d7f2f8e-4c1b-4d7e-9a43-0f5b1a9c2e10';

/**
 * O que o controller da composição decide: as chaves do cadastro de
 * produtos, a base de custos na classe e a composição nas rotas dela, e os
 * valores só para quem tem `values:values:view`.
 */
describe('ProductAssemblyController', () => {
  let granted: Set<string>;
  let service: Record<string, jest.Mock>;
  let planControl: { enforceFeature: jest.Mock };
  let controller: ProductAssemblyController;
  const request = () => ({ user: { userId: 'u-1', companyId: 'c-1' } });

  beforeEach(() => {
    granted = new Set(['values:values:view']);
    service = new Proxy({} as Record<string, jest.Mock>, {
      get: (target, key: string) =>
        (target[key] ??= jest.fn().mockResolvedValue({ ok: key })),
    });
    planControl = { enforceFeature: jest.fn().mockResolvedValue(undefined) };
    controller = new ProductAssemblyController(
      service as any,
      {
        hasPermission: jest.fn(async (_user, action, resource) =>
          granted.has(`${resource}:${action}`),
        ),
      } as any,
      planControl as any,
    );
  });

  const handlers = () =>
    Object.getOwnPropertyNames(ProductAssemblyController.prototype)
      .filter((name) => name !== 'constructor' && name !== 'ctx')
      .map(
        (name) =>
          [name, (ProductAssemblyController.prototype as any)[name]] as const,
      );

  it('a classe pede a base de custos', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, ProductAssemblyController),
    ).toContain(FeatureGuard);
    expect(
      Reflect.getMetadata(REQUIRED_FEATURE_KEY, ProductAssemblyController),
    ).toBe('cost_base');
  });

  it('ler pede ver produtos; escrever e tirar de dentro pedem editar', () => {
    for (const [name, handler] of handlers()) {
      const method = Reflect.getMetadata(METHOD_METADATA, handler);
      expect([name, Reflect.getMetadata(HAS_PERMISSION_KEY, handler)]).toEqual([
        name,
        {
          action: method === RequestMethod.GET ? 'view' : 'edit',
          resource: 'product_settings:products',
        },
      ]);
    }
  });

  it('a composição pede também o recurso dela; o fluxo de processos não', async () => {
    await controller.read(request(), P, {});
    await controller.addBlock(request(), P, { type: 'OWN' } as any);
    expect(planControl.enforceFeature).toHaveBeenCalledTimes(2);
    expect(planControl.enforceFeature).toHaveBeenCalledWith(
      'c-1',
      'product_composition',
    );

    planControl.enforceFeature.mockClear();
    await controller.nextStep(request(), P, {});
    await controller.partCandidates(request(), P, {});
    expect(planControl.enforceFeature).not.toHaveBeenCalled();
  });

  it('a leitura leva ao service se quem chama vê valores', async () => {
    await controller.read(request(), P, { variationId: null });
    granted.clear();
    await controller.read(request(), P, {});
    expect(service.read.mock.calls.map((call) => call[2])).toEqual([
      { values: true },
      { values: false },
    ]);
    expect(service.read.mock.calls[0][0]).toEqual({
      companyId: 'c-1',
      productId: P,
      variationId: null,
    });
  });

  it('adotar o preço sugerido pede a permissão de valores', async () => {
    granted.clear();
    await expect(
      controller.adoptSuggestedPrice(request(), P, {}),
    ).rejects.toMatchObject({
      response: {
        code: 'PERMISSION_DENIED',
        permissions: ['values:values:view'],
      },
    });
    expect(service.adoptSuggestedPrice).not.toHaveBeenCalled();
  });
});
