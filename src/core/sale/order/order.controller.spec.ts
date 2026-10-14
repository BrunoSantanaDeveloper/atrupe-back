import { GUARDS_METADATA } from '@nestjs/common/constants';
import { OrderController } from './order.controller';
import { TenantGuard } from '../../auth/guards/tenant.guard';
import { TENANT_RESOURCE_KEY } from '../../auth/guards/tenant-resource.decorator';

describe('OrderController: POST /sale/order', () => {
  it('não existe: a O.S. nasce na aprovação do orçamento', () => {
    expect((OrderController.prototype as any).create).toBeUndefined();
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
