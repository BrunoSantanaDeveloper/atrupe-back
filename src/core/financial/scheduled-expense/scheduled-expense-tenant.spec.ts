import { NotFoundException } from '@nestjs/common';
import { ScheduledExpenseService } from './scheduled-expense.service';

const allFound = () =>
  jest.fn(async ({ where }: any) => where?.id?.in?.length ?? 0);

describe('ScheduledExpenseService: cadastros da empresa', () => {
  let prisma: any;
  let service: ScheduledExpenseService;

  beforeEach(() => {
    prisma = {
      scheduledExpense: { create: jest.fn(), update: jest.fn() },
      supplier: { count: allFound() },
      employee: { count: allFound() },
      client: { count: allFound() },
      nature: { count: allFound() },
      subCategory: { count: allFound() },
      bankAccount: { count: allFound() },
      paymentCondition: { count: allFound() },
    };
    service = new ScheduledExpenseService(prisma);
  });

  it('fornecedor de outra empresa é recusado antes de criar', async () => {
    prisma.supplier.count.mockResolvedValueOnce(0);

    await expect(
      service.create(
        { amount: 100, dueDay: 5, supplierId: 'forn-de-outra' } as any,
        'c-1',
      ),
    ).rejects.toThrow(new NotFoundException('Fornecedor não encontrado.'));
    expect(prisma.scheduledExpense.create).not.toHaveBeenCalled();
  });

  it('a natureza (categoryId) de outra empresa é recusada na edição', async () => {
    prisma.nature.count.mockResolvedValueOnce(0);

    await expect(
      service.update('d-1', { categoryId: 'natureza-de-outra' } as any, 'c-1'),
    ).rejects.toThrow(new NotFoundException('Natureza não encontrada.'));
    expect(prisma.nature.count).toHaveBeenCalledWith({
      where: { id: { in: ['natureza-de-outra'] }, companyId: 'c-1' },
    });
    expect(prisma.scheduledExpense.update).not.toHaveBeenCalled();
  });
});
