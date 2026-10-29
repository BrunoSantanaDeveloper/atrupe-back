import { GUARDS_METADATA } from '@nestjs/common/constants';
import {
  FeatureGuard,
  REQUIRED_FEATURE_KEY,
} from '../plan/guards/feature.guard';
import { valuesRuleOf } from '../auth/abac/values-visibility.interceptor';
import { ProductVariationController } from './product-variation.controller';

const P = '7d7f2f8e-4c1b-4d7e-9a43-0f5b1a9c2e10';

/**
 * O que o controller decide: variações sem recurso de plano (START), faixas
 * com `product_composition`, e a gravação da tabela só para quem vê valores.
 */
describe('ProductVariationController', () => {
  let granted: Set<string>;
  let service: Record<string, jest.Mock>;
  let controller: ProductVariationController;
  const request = () => ({ user: { userId: 'u-1', companyId: 'c-1' } });

  beforeEach(() => {
    granted = new Set(['values:values:view']);
    service = {
      list: jest.fn().mockResolvedValue({ data: [] }),
      replace: jest.fn().mockResolvedValue({ data: [] }),
      update: jest.fn().mockResolvedValue({}),
      remove: jest.fn().mockResolvedValue(undefined),
      tiers: jest.fn().mockResolvedValue({ inherited: false, tiers: [] }),
      saveTiers: jest.fn().mockResolvedValue({ inherited: false, tiers: [] }),
    };
    const abac = {
      hasPermission: jest.fn(async (_user, action, resource) =>
        granted.has(`${resource}:${action}`),
      ),
    };
    controller = new ProductVariationController(service as any, abac as any);
  });

  const handler = (name: keyof ProductVariationController) =>
    ProductVariationController.prototype[name] as object;

  it('ler variações é livre; gravar variações e faixas pede a composição (LITE em diante, 27/10/2026)', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, handler('list')),
    ).toBeUndefined();
    for (const name of [
      'replace',
      'update',
      'remove',
      'tiers',
      'saveTiers',
    ] as const) {
      expect(Reflect.getMetadata(GUARDS_METADATA, handler(name))).toEqual([
        FeatureGuard,
      ]);
      expect(Reflect.getMetadata(REQUIRED_FEATURE_KEY, handler(name))).toBe(
        'product_composition',
      );
    }
  });

  it('as leituras passam o preço pelo helper de valores', () => {
    for (const name of ['list', 'replace', 'update', 'tiers'] as const) {
      expect(valuesRuleOf(handler(name), ProductVariationController)).toEqual({
        fields: new Set(['unitPrice']),
      });
    }
  });

  it('a lista inteira leva ao service se quem chama vê valores', async () => {
    await controller.replace(request(), P, { variations: [] });
    granted.clear();
    await controller.replace(request(), P, { variations: [] });

    expect(service.replace.mock.calls[0][3]).toBe(true);
    expect(service.replace.mock.calls[1][3]).toBe(false);
  });

  it('gravar a tabela de faixas pede a permissão de valores', async () => {
    granted.clear();

    await expect(
      controller.saveTiers(request(), P, { tiers: [] }),
    ).rejects.toMatchObject({
      response: {
        code: 'PERMISSION_DENIED',
        permissions: ['values:values:view'],
      },
    });
    expect(service.saveTiers).not.toHaveBeenCalled();

    granted.add('values:values:view');
    await controller.saveTiers(request(), P, { tiers: [] });
    expect(service.saveTiers).toHaveBeenCalledWith('c-1', P, { tiers: [] });
  });
});
