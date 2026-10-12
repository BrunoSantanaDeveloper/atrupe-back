import { NotFoundException } from '@nestjs/common';
import { DeliveryScheduleController } from './delivery-schedule.controller';

describe('DeliveryScheduleController: pedido do corpo', () => {
  const req = { user: { companyId: 'c-1' } };
  let prisma: any;
  let service: any;
  let controller: DeliveryScheduleController;

  beforeEach(() => {
    prisma = {
      order: { count: jest.fn().mockResolvedValue(0) },
      deliverySchedule: {
        findFirst: jest.fn().mockResolvedValue({ id: 'ag-1' }),
      },
    };
    service = { create: jest.fn(), update: jest.fn() };
    controller = new DeliveryScheduleController(service, {} as any, prisma);
  });

  it('criar a agenda no pedido de outra empresa é recusado', async () => {
    await expect(
      controller.create(req, { orderId: 'pedido-de-outra' } as any),
    ).rejects.toThrow(new NotFoundException('Pedido não encontrado.'));
    expect(prisma.order.count).toHaveBeenCalledWith({
      where: {
        id: { in: ['pedido-de-outra'] },
        quotation: { companyId: 'c-1' },
      },
    });
    expect(service.create).not.toHaveBeenCalled();
  });

  it('mudar a agenda para o pedido de outra empresa é recusado', async () => {
    await expect(
      controller.update(req, 'ag-1', { orderId: 'pedido-de-outra' } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(service.update).not.toHaveBeenCalled();
  });
});
