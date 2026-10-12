import { ForbiddenException } from '@nestjs/common';
import { OrderController } from './order.controller';

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
