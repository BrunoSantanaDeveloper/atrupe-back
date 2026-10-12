import { NotFoundException } from '@nestjs/common';
import { DeliveryController } from './delivery.controller';

describe('DeliveryController (entrega do orçamento)', () => {
  const req = {
    user: { companyId: 'c-1', employeeId: 'e-1', isAdmin: true, role: 'r' },
  };
  let prisma: any;
  let service: any;
  let controller: DeliveryController;

  beforeEach(() => {
    prisma = {
      quotation: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'q-1', companyId: 'c-1', sellerId: 'e-1' }),
      },
      deliveryInfo: {
        findUnique: jest.fn().mockResolvedValue({
          quotationId: 'q-1',
          clientAddressId: 'ad-atual',
        }),
      },
      supplier: { count: jest.fn(async ({ where }) => where.id.in.length) },
      address: { count: jest.fn(async ({ where }) => where.id.in.length) },
    };
    service = { createDeliveryInfo: jest.fn(), updateDeliveryInfo: jest.fn() };
    const abac = { canAccessOtherSellers: jest.fn().mockResolvedValue(true) };
    controller = new DeliveryController(service, prisma, abac as any);
  });

  it('transportadora de outra empresa é recusada', async () => {
    prisma.supplier.count.mockResolvedValueOnce(0);

    await expect(
      controller.createDeliveryInfo(
        'q-1',
        { deliveryType: 'CARRIER', supplierId: 'forn-de-outra' } as any,
        req,
      ),
    ).rejects.toThrow(new NotFoundException('Fornecedor não encontrado.'));
    expect(service.createDeliveryInfo).not.toHaveBeenCalled();
  });

  it('endereço que não é de cliente da empresa é recusado', async () => {
    prisma.address.count.mockResolvedValueOnce(0);

    await expect(
      controller.updateDeliveryInfo(
        'di-1',
        { clientAddressId: 'ad-de-outra' } as any,
        req,
      ),
    ).rejects.toThrow(new NotFoundException('Endereço não encontrado.'));
    expect(prisma.address.count).toHaveBeenCalledWith({
      where: { id: { in: ['ad-de-outra'] }, client: { companyId: 'c-1' } },
    });
    expect(service.updateDeliveryInfo).not.toHaveBeenCalled();
  });

  it.each(['custom', '', 'ad-atual'])(
    'endereço %p (personalizado, vazio ou o atual da entrega) não é consultado',
    async (clientAddressId) => {
      await controller.updateDeliveryInfo(
        'di-1',
        { clientAddressId } as any,
        req,
      );
      expect(prisma.address.count).not.toHaveBeenCalled();
      expect(service.updateDeliveryInfo).toHaveBeenCalled();
    },
  );
});
