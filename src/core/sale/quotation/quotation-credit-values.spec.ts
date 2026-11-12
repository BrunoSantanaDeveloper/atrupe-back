import { BadRequestException, ConflictException } from '@nestjs/common';
import { QuotationController } from './quotation.controller';
import { CREDIT_EXCEEDED_NO_VALUES } from './credit-check.service';

/**
 * Pagamento antecipado (12/11/2026): a recusa do crédito e a conferência
 * saem sem os números para quem não vê valores, e o "Descartar venda" da
 * venda rápida só vale em digitação e fora do caixa.
 */
describe('Orçamento: crédito sem valores e descarte da venda rápida', () => {
  const service = {
    approve: jest.fn(),
    remove: jest.fn().mockResolvedValue({ id: 'q' }),
    assertOutsourcedAboveCost: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    quotation: {
      findUnique: jest.fn(),
    },
    pendingSale: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  let values: boolean;
  const abac = {
    canAccessOtherSellers: jest.fn().mockResolvedValue(true),
    hasPermission: jest.fn(async () => values),
  };
  const credit = { quotationCredit: jest.fn() };
  const controller = new QuotationController(
    service as any,
    abac as any,
    prisma as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  (controller as any).creditCheck = credit;
  const req = () => ({ user: { userId: 'u-a', companyId: 'empresa-a' } });
  const id = '6f1c2b8e-4d3a-4f5b-9c7d-1e2f3a4b5c6d';

  const refusal = () =>
    new ConflictException({
      statusCode: 409,
      code: 'CREDIT_CHECK',
      message:
        'Esta venda passa R$ 100,00 do limite de crédito do cliente (limite de R$ 1.000,00). Sugestão: uma entrada de R$ 100,00, que precisa ser paga para liberar a venda. Para mudar o limite, fale com o financeiro.',
      issues: [
        {
          code: 'CREDIT_LIMIT_EXCEEDED',
          limit: 100000,
          used: 80000,
          requested: 30000,
          excess: 10000,
          suggestedDownPayment: 10000,
        },
      ],
    });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.quotation.findUnique.mockResolvedValue({
      companyId: 'empresa-a',
      sellerId: 'v-a',
      quickSale: false,
      status: 'OPEN',
    });
    prisma.pendingSale.findUnique.mockResolvedValue(null);
  });

  it('a recusa sai sem os números para quem não vê valores', async () => {
    values = false;
    service.approve.mockRejectedValue(refusal());
    const error = await controller.approve(id, req()).catch((e) => e);
    expect(error).toBeInstanceOf(ConflictException);
    const body = error.getResponse();
    expect(body.issues).toEqual([{ code: 'CREDIT_LIMIT_EXCEEDED' }]);
    expect(body.message).toBe(CREDIT_EXCEEDED_NO_VALUES);
  });

  it('quem vê valores recebe a recusa inteira, com a entrada sugerida', async () => {
    values = true;
    service.approve.mockRejectedValue(refusal());
    const error = await controller.approve(id, req()).catch((e) => e);
    expect(error.getResponse().issues[0].suggestedDownPayment).toBe(10000);
  });

  it('a conferência troca o texto do limite para quem não vê valores', async () => {
    values = false;
    credit.quotationCredit.mockResolvedValue({
      issues: [{ code: 'CREDIT_LIMIT_EXCEEDED', message: 'passa R$ 100,00' }],
    });
    const result = await controller.credit(id, req());
    expect(result.issues[0].message).toBe(CREDIT_EXCEEDED_NO_VALUES);
  });

  it.each([
    ['aprovada', { status: 'APPROVED' }, null],
    ['pendente de pagamento', { status: 'PENDING_PAYMENT' }, null],
    ['no caixa', { status: 'OPEN' }, { cancelled: false }],
  ])('a venda rápida %s não é descartada', async (_label, sale, pending) => {
    prisma.quotation.findUnique.mockResolvedValue({
      companyId: 'empresa-a',
      sellerId: 'v-a',
      quickSale: true,
      ...sale,
    });
    prisma.pendingSale.findUnique.mockResolvedValue(pending);
    await expect(controller.remove(id, req())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(service.remove).not.toHaveBeenCalled();
  });

  it('a venda rápida em digitação é descartada', async () => {
    prisma.quotation.findUnique.mockResolvedValue({
      companyId: 'empresa-a',
      sellerId: 'v-a',
      quickSale: true,
      status: 'OPEN',
    });
    await controller.remove(id, req());
    expect(service.remove).toHaveBeenCalledWith(id);
  });
});
