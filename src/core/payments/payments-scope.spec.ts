import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';

/**
 * As cobranças da assinatura (valor, vencimento, boleto, PIX e o cliente da
 * cobrança) eram lidas pelo id por qualquer conta, e o status consultava o
 * Asaas e gravava na cobrança alheia.
 */
describe('Cobranças da assinatura: só da conta da sessão', () => {
  let prisma: any;
  let service: PaymentsService;

  beforeEach(() => {
    prisma = {
      payment: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    service = new PaymentsService(prisma, {} as any);
  });

  it('a cobrança de outra conta responde 404', async () => {
    await expect(service.findOne('cobranca-b', 'empresa-a')).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.payment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cobranca-b', subscription: { companyId: 'empresa-a' } },
      }),
    );
  });

  it('o status também: não consulta o Asaas nem grava', async () => {
    await expect(
      service.getPaymentStatus('cobranca-b', 'empresa-a'),
    ).rejects.toThrow(NotFoundException);
  });

  it('as cobranças de uma assinatura de outra conta não aparecem', async () => {
    await expect(
      service.findBySubscription('assinatura-b', 'empresa-a'),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          subscriptionId: 'assinatura-b',
          subscription: { companyId: 'empresa-a' },
        },
      }),
    );
  });

  describe('o controller passa a empresa da sessão', () => {
    const payments = { findOne: jest.fn(), findBySubscription: jest.fn() };
    const controller = new PaymentsController(payments as any);

    beforeEach(() => jest.clearAllMocks());

    it('usuário da conta', async () => {
      await controller.findOne('cobranca-1', {
        user: { companyId: 'empresa-a' },
      });
      expect(payments.findOne).toHaveBeenCalledWith('cobranca-1', 'empresa-a');
    });

    it('superadmin vê qualquer uma', async () => {
      await controller.findOne('cobranca-1', {
        user: { companyId: 'empresa-x', isSystemAdmin: true },
      });
      expect(payments.findOne).toHaveBeenCalledWith('cobranca-1', undefined);
    });

    it('sem empresa na sessão, ninguém vê', async () => {
      await expect(
        controller.findBySubscription('assinatura-1', { user: {} }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(payments.findBySubscription).not.toHaveBeenCalled();
    });
  });
});
