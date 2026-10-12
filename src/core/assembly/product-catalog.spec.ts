import { GUARDS_METADATA } from '@nestjs/common/constants';
import { HAS_PERMISSION_KEY } from '../auth/abac/has-permission.decorator';
import { valuesRuleOf } from '../auth/abac/values-visibility.interceptor';
import { FeatureGuard } from '../plan/guards/feature.guard';
import { ProductCatalogController } from './product-catalog.controller';
import { ProductCatalogService } from './product-catalog.service';

/**
 * Onde o produto é usado e duplicar: sem recurso de plano na rota; a
 * composição só vai na cópia com a base de custos.
 */
describe('ProductCatalogController', () => {
  const handler = (name: keyof ProductCatalogController) =>
    ProductCatalogController.prototype[name] as object;

  it('as rotas não pedem recurso de plano', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, ProductCatalogController),
    ).not.toContain(FeatureGuard);
  });

  it('onde é usado pede editar; duplicar pede criar', () => {
    expect(Reflect.getMetadata(HAS_PERMISSION_KEY, handler('usage'))).toEqual({
      action: 'edit',
      resource: 'product_settings:products',
    });
    expect(
      Reflect.getMetadata(HAS_PERMISSION_KEY, handler('duplicate')),
    ).toEqual({ action: 'create', resource: 'product_settings:products' });
  });

  it('a resposta do duplicar passa pelo helper de valores, como o produto', () => {
    expect(
      valuesRuleOf(handler('duplicate'), ProductCatalogController),
    ).toEqual(expect.objectContaining({ fields: expect.any(Set) }));
  });
});

describe('ProductCatalogService', () => {
  it('duplicar pede nome e confere a empresa', async () => {
    const prisma = {
      product: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new ProductCatalogService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
    );
    await expect(service.duplicate('c-1', 'pr-1', '  ')).rejects.toThrow(
      'Informe o nome do produto',
    );
    await expect(service.duplicate('c-1', 'pr-1', 'Cópia')).rejects.toThrow(
      'Produto não encontrado',
    );
    expect(prisma.product.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'pr-1', companyId: 'c-1' } }),
    );
  });
});
