import { ConflictException } from '@nestjs/common';
import { ConditionService } from './condition.service';

// A forma de pagamento de uma condição já usada não muda; parcelas sim
// (decisão do PO, 14/10)
describe('ConditionService: a forma da condição já usada', () => {
  let prisma: any;
  let service: ConditionService;

  const condition = (used: number) => ({
    paymentMethodId: 'credito',
    _count: {
      quotationPayments: used,
      downPaymentConditions: 0,
      quotationInstallments: 0,
      payableInstallments: 0,
      receivableInstallments: 0,
    },
  });

  beforeEach(() => {
    prisma = {
      paymentCondition: {
        findFirst: jest.fn().mockResolvedValue({ id: 'pc-1' }),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'pc-1' }),
      },
    };
    service = new ConditionService(prisma);
  });

  it('usada: trocar a forma é recusado', async () => {
    prisma.paymentCondition.findUnique.mockResolvedValue(condition(3));
    await expect(
      service.update('pc-1', 'c-1', {
        paymentMethodId: 'pix',
        installments: [],
      } as any),
    ).rejects.toThrow(
      new ConflictException(
        'Esta condição já foi usada: a forma de pagamento não muda. Para outra forma, crie uma condição nova.',
      ),
    );
    expect(prisma.paymentCondition.update).not.toHaveBeenCalled();
  });

  it('usada: mudar as parcelas, com a mesma forma, passa', async () => {
    prisma.paymentCondition.findUnique.mockResolvedValue(condition(3));
    await service.update('pc-1', 'c-1', {
      paymentMethodId: 'credito',
      maxInstallments: 12,
      installments: [],
    } as any);
    expect(prisma.paymentCondition.update).toHaveBeenCalled();
  });

  it('nunca usada: a forma muda', async () => {
    prisma.paymentCondition.findUnique.mockResolvedValue(condition(0));
    await service.update('pc-1', 'c-1', {
      paymentMethodId: 'pix',
      installments: [],
    } as any);
    expect(prisma.paymentCondition.update).toHaveBeenCalled();
  });
});
