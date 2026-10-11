import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { PlanController } from './plan.controller';

describe('PlanController — rotas públicas', () => {
  const route = (handler: 'getPublicFeatureMap' | 'getPublicModules') => ({
    path: Reflect.getMetadata(PATH_METADATA, PlanController.prototype[handler]),
    guards: Reflect.getMetadata(
      GUARDS_METADATA,
      PlanController.prototype[handler],
    ),
  });

  it('o mapa de chaves é público como as outras rotas /plan/public/*', () => {
    expect(route('getPublicFeatureMap')).toEqual({
      path: 'public/feature-map',
      guards: undefined,
    });
    expect(route('getPublicModules')).toEqual({
      path: 'public/modules',
      guards: undefined,
    });
    expect(
      Reflect.getMetadata(GUARDS_METADATA, PlanController),
    ).toBeUndefined();
  });

  it('entrega o mapa que o serviço monta', async () => {
    const service = {
      getPublicFeatureMap: jest.fn().mockResolvedValue({ features: [] }),
    };
    const controller = new PlanController(service as any);

    await expect(controller.getPublicFeatureMap()).resolves.toEqual({
      features: [],
    });
  });
});
