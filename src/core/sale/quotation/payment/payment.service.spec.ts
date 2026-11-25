import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { PaymentService } from './payment.service';

const quotationId = 'quotation-uuid-3352';
const paymentConditionId = 'f9a23dd3-2e74-41ae-b84b-b57b99894f9f';

const createMockPrismaService = () => {
  const mock: any = {
    quotationPayment: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    quotationInstallment: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    paymentCondition: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    commission: {
      delete: jest.fn(),
      create: jest.fn(),
    },
  };
  // $transaction executa o callback com o mesmo mock (pass-through)
  mock.$transaction = jest.fn((cb: (prisma: any) => Promise<any>) => cb(mock));
  return mock;
};

describe('PaymentService', () => {
  let service: PaymentService;
  let prisma: ReturnType<typeof createMockPrismaService>;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [PaymentService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<PaymentService>(PaymentService);

    prisma.quotationPayment.findUnique.mockResolvedValue({
      id: 'payment-1',
      quotationId,
      commissionId: null,
    });
    prisma.quotationPayment.update.mockResolvedValue({
      id: 'payment-1',
      commissionId: null,
    });
  });

  describe('updatePayment', () => {
    it('grava 0 quando o formulário limpa o desconto e manda null', async () => {
      // Campo numérico apagado devolve null, e as colunas são NOT NULL: sem a
      // conversão, o Prisma recusava e a tela só via "Internal server error".
      await service.updatePayment(quotationId, {
        discount: {
          discountType: 'PERCENT',
          discountValue: null,
          discountTotal: null,
        },
      });

      const { data } = prisma.quotationPayment.update.mock.calls[0][0];
      expect(data.discountValue).toBe(0);
      expect(data.discountTotal).toBe(0);
    });

    it('grava 0 quando a entrada vem com valores nulos', async () => {
      await service.updatePayment(quotationId, {
        hasDownPayment: true,
        downPayment: {
          amount: null,
          additionalFee: null,
          paymentConditionId,
        },
      });

      const { data } = prisma.quotationPayment.update.mock.calls[0][0];
      expect(data.downPayment).toBe(0);
      expect(data.downPaymentAdditionalFee).toBe(0);
    });

    it('recusa entrada com valor e sem data de vencimento', async () => {
      // Deixar passar gravava downPaymentDueDate nulo, e a venda so
      // quebrava na aprovacao, ao criar a parcela da entrada: ficava
      // aprovada, com O.S., e sem nenhum lancamento no financeiro.
      await expect(
        service.updatePayment(quotationId, {
          hasDownPayment: true,
          downPayment: { amount: 2500, paymentConditionId },
        }),
      ).rejects.toThrow('Informe a data de vencimento da entrada.');

      expect(prisma.quotationPayment.update).not.toHaveBeenCalled();
    });

    it('à vista integral: a lista vazia com a entrada cobrindo o total tira as parcelas', async () => {
      // Lista Lite 24/11, item 1: sem crédito livre, "Receber à vista" manda
      // a venda inteira na entrada e nenhuma parcela; a parcela antiga ficava
      await service.updatePayment(quotationId, {
        hasDownPayment: true,
        totalValue: 20000,
        downPayment: {
          amount: 20000,
          dueDate: '2026-11-25T12:00:00.000Z',
          paymentConditionId,
        },
        installments: [],
      });

      expect(prisma.quotationInstallment.deleteMany).toHaveBeenCalledWith({
        where: { quotationPaymentId: 'payment-1' },
      });
      const { data } = prisma.quotationPayment.update.mock.calls[0][0];
      expect(data.installmentQty).toBe(0);
    });

    it('a lista vazia sem a entrada cobrindo o total não mexe nas parcelas', async () => {
      await service.updatePayment(quotationId, {
        hasDownPayment: true,
        totalValue: 20000,
        downPayment: {
          amount: 5000,
          dueDate: '2026-11-25T12:00:00.000Z',
          paymentConditionId,
        },
        installments: [],
      });

      expect(prisma.quotationInstallment.deleteMany).not.toHaveBeenCalled();
    });

    it('aceita entrada zerada sem data de vencimento', async () => {
      await service.updatePayment(quotationId, {
        hasDownPayment: true,
        downPayment: { amount: 0, paymentConditionId },
      });

      expect(prisma.quotationPayment.update).toHaveBeenCalled();
    });

    it('traduz erro de chave estrangeira em mensagem legível', async () => {
      prisma.quotationPayment.update.mockRejectedValue(
        Object.assign(new Error('FK violation'), { code: 'P2003' }),
      );

      await expect(
        service.updatePayment(quotationId, { totalValue: 116373 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('não engole a exceção de negócio lançada dentro da transação', async () => {
      prisma.quotationPayment.update.mockRejectedValue(
        new BadRequestException('Condição de pagamento inválida'),
      );

      await expect(
        service.updatePayment(quotationId, { totalValue: 116373 }),
      ).rejects.toThrow('Condição de pagamento inválida');
    });
  });
});
