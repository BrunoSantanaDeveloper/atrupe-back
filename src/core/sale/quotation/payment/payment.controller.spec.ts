import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PaymentController } from './payment.controller';

describe('PaymentController (pagamento do orçamento)', () => {
  const req = {
    user: { companyId: 'c-1', employeeId: 'e-1', isAdmin: false, role: 'r' },
  };
  let prisma: any;
  let abac: any;
  let service: any;
  let controller: PaymentController;

  beforeEach(() => {
    prisma = {
      quotation: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'q-1', companyId: 'c-1', sellerId: 'e-1' }),
      },
      paymentCondition: { count: jest.fn() },
      supplier: { count: jest.fn() },
    };
    abac = { canAccessOtherSellers: jest.fn().mockResolvedValue(false) };
    service = {
      findOne: jest.fn(),
      updatePayment: jest.fn(),
      updateCommission: jest.fn(),
    };
    controller = new PaymentController(service, prisma, abac);
  });

  it('a leitura confere o orçamento: o de outra empresa é recusado', async () => {
    prisma.quotation.findUnique.mockResolvedValue({
      id: 'q-9',
      companyId: 'outra',
    });

    await expect(controller.findOne(req, 'q-9')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(service.findOne).not.toHaveBeenCalled();
  });

  it('a leitura do orçamento de outro vendedor pede ver outros vendedores', async () => {
    prisma.quotation.findUnique.mockResolvedValue({
      id: 'q-2',
      companyId: 'c-1',
      sellerId: 'e-2',
    });

    await expect(controller.findOne(req, 'q-2')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(abac.canAccessOtherSellers).toHaveBeenCalledWith(req.user, 'view');
  });

  it('condição de pagamento de outra empresa no corpo é recusada', async () => {
    prisma.paymentCondition.count.mockResolvedValue(1);

    await expect(
      controller.updatePayment(
        'q-1',
        {
          paymentConditionId: 'pc-1',
          installments: [{ paymentConditionId: 'pc-de-outra' }],
        } as any,
        req,
      ),
    ).rejects.toThrow(
      new NotFoundException('Condição de pagamento não encontrada.'),
    );
    expect(prisma.paymentCondition.count).toHaveBeenCalledWith({
      where: { id: { in: ['pc-1', 'pc-de-outra'] }, companyId: 'c-1' },
    });
    expect(service.updatePayment).not.toHaveBeenCalled();
  });

  it('fornecedor de outra empresa na comissão é recusado', async () => {
    prisma.supplier.count.mockResolvedValue(0);

    await expect(
      controller.updateCommission(
        'q-1',
        { supplier: { label: 'X', value: 'forn-de-outra' } } as any,
        req,
      ),
    ).rejects.toThrow(new NotFoundException('Fornecedor não encontrado.'));
    expect(service.updateCommission).not.toHaveBeenCalled();
  });
});
