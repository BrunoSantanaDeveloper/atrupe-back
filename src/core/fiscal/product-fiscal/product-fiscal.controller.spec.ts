import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ProductFiscalController } from './product-fiscal.controller';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { TenantGuard } from '../../auth/guards/tenant.guard';
import { TENANT_RESOURCE_KEY } from '../../auth/guards/tenant-resource.decorator';

/**
 * As rotas por produto buscavam o cadastro fiscal e as regras de ST só pelo
 * id: um usuário de outra empresa lia, sobrescrevia e excluía os dados
 * fiscais do produto alheio. O produto que vem no corpo (POST e upsert) é
 * conferido no service.
 */
describe('ProductFiscalController: rotas por produto conferem a empresa', () => {
  it('o TenantGuard roda depois do login', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      ProductFiscalController,
    );
    expect(guards.indexOf(TenantGuard)).toBeGreaterThan(
      guards.indexOf(JwtAuthGuard),
    );
  });

  it.each([
    'listStRules',
    'upsertStRule',
    'removeStRule',
    'findByProductId',
    'update',
    'delete',
  ] as const)('%s', (handler) => {
    expect(
      Reflect.getMetadata(
        TENANT_RESOURCE_KEY,
        ProductFiscalController.prototype[handler],
      ),
    ).toEqual({ model: 'product', paramName: 'productId', via: undefined });
  });

  it('o produto do corpo vai ao service com a empresa da sessão', async () => {
    const service = { create: jest.fn(), upsert: jest.fn() };
    const controller = new ProductFiscalController(service as any);
    const req = { user: { companyId: 'empresa-1' } };
    const dto = { productId: 'produto-1' } as any;

    await controller.create(dto, req);
    await controller.upsert(dto, req);

    expect(service.create).toHaveBeenCalledWith(dto, 'empresa-1');
    expect(service.upsert).toHaveBeenCalledWith(dto, 'empresa-1');
  });
});
