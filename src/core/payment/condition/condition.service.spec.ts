import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { ConditionService } from './condition.service';

describe('ConditionService: isolamento por empresa', () => {
  let service: ConditionService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      paymentCondition: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      bankAccountCashControl: { deleteMany: jest.fn() },
      $transaction: jest.fn((fn) => fn(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConditionService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(ConditionService);
  });

  it('findOne procura pelo id e pela empresa, com as parcelas', async () => {
    const condition = { id: 'pc-1', companyId: 'c-1', installments: [] };
    prisma.paymentCondition.findFirst.mockResolvedValue(condition);

    await expect(service.findOne('pc-1', 'c-1')).resolves.toBe(condition);
    expect(prisma.paymentCondition.findFirst).toHaveBeenCalledWith({
      where: { id: 'pc-1', companyId: 'c-1' },
      include: { installments: true },
    });
  });

  it('findOne responde 404 à condição de outra empresa', async () => {
    prisma.paymentCondition.findFirst.mockResolvedValue(null);
    await expect(service.findOne('pc-9', 'c-1')).rejects.toThrow(
      new NotFoundException('Condição de pagamento não encontrada.'),
    );
  });

  it('update não altera a condição de outra empresa', async () => {
    prisma.paymentCondition.findFirst.mockResolvedValue(null);
    await expect(
      service.update('pc-9', 'c-1', { name: 'x', installments: [] } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.paymentCondition.findFirst).toHaveBeenCalledWith({
      where: { id: 'pc-9', companyId: 'c-1' },
      select: { id: true },
    });
    expect(prisma.paymentCondition.update).not.toHaveBeenCalled();
  });

  it('update altera a condição da empresa e regrava as parcelas', async () => {
    prisma.paymentCondition.findFirst.mockResolvedValue({ id: 'pc-1' });
    await service.update('pc-1', 'c-1', {
      name: 'Cartão',
      installments: [{ operatorFeeRate: 2, operatorFeeTransfer: 1 }],
    } as any);
    expect(prisma.paymentCondition.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pc-1' },
        data: expect.objectContaining({
          name: 'Cartão',
          installments: {
            deleteMany: {},
            create: [
              { installment: 1, operatorFeeRate: 2, operatorFeeTransfer: 1 },
            ],
          },
        }),
      }),
    );
  });

  it('remove não desativa a condição de outra empresa', async () => {
    prisma.paymentCondition.findFirst.mockResolvedValue(null);
    await expect(service.remove('pc-9', 'c-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.paymentCondition.update).not.toHaveBeenCalled();
  });

  it('remove desativa a condição da empresa e tira os controles de caixa dela', async () => {
    prisma.paymentCondition.findFirst.mockResolvedValue({ id: 'pc-1' });
    prisma.paymentCondition.update.mockResolvedValue({ id: 'pc-1' });
    await service.remove('pc-1', 'c-1');
    expect(prisma.paymentCondition.update).toHaveBeenCalledWith({
      where: { id: 'pc-1' },
      data: { isActive: false },
    });
    expect(prisma.bankAccountCashControl.deleteMany).toHaveBeenCalledWith({
      where: { paymentConditionId: 'pc-1' },
    });
  });
});
