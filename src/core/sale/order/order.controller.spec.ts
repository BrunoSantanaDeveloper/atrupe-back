import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { OrderController } from './order.controller';
import { TenantGuard } from '../../auth/guards/tenant.guard';
import { TENANT_RESOURCE_KEY } from '../../auth/guards/tenant-resource.decorator';

describe('OrderController: POST /sale/order', () => {
  const req = { user: { companyId: 'c-1', userId: 'u-1', role: 'r-1' } };
  let service: { create: jest.Mock };
  let abac: { hasPermission: jest.Mock };
  let controller: OrderController;

  beforeEach(() => {
    service = { create: jest.fn() };
    abac = { hasPermission: jest.fn() };
    controller = new OrderController(service as any, abac as any, {} as any);
  });

  it('cria só com sale:order:create, no orçamento da empresa da sessão', async () => {
    abac.hasPermission.mockResolvedValue(true);
    await controller.create(req, { quotationId: 'q-1' });
    expect(abac.hasPermission).toHaveBeenCalledWith(
      req.user,
      'create',
      'sale:order',
    );
    expect(service.create).toHaveBeenCalledWith({ quotationId: 'q-1' }, 'c-1');
  });

  it('sem a permissão, recusa com o 403 do guard e não cria', async () => {
    abac.hasPermission.mockResolvedValue(false);
    const error = await controller.create(req, { quotationId: 'q-1' }).then(
      () => undefined,
      (e) => e,
    );
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.getResponse()).toEqual(
      expect.objectContaining({
        code: 'PERMISSION_DENIED',
        permissions: ['sale:order:create'],
      }),
    );
    expect(service.create).not.toHaveBeenCalled();
  });
});

/**
 * Editar, cancelar e excluir buscavam a O.S. só pelo id: um usuário de
 * outra empresa alterava, cancelava (com as contas da venda) e inativava a
 * O.S. alheia. A empresa vem do orçamento da O.S.
 */
describe('OrderController: rotas por id conferem a empresa', () => {
  it.each([
    ['PATCH /sale/order/:id/info', 'updateOrderInfo'],
    ['POST /sale/order/:id/cancel', 'cancelOrder'],
    ['DELETE /sale/order/:id', 'remove'],
  ] as const)('%s', (_label, handler) => {
    const method = OrderController.prototype[handler];
    expect(Reflect.getMetadata(GUARDS_METADATA, method)).toContain(TenantGuard);
    expect(Reflect.getMetadata(TENANT_RESOURCE_KEY, method)).toEqual({
      model: 'order',
      paramName: 'id',
      via: 'quotation',
    });
  });
});
