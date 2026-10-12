import { NotFoundException } from '@nestjs/common';
import { SupplierService } from './supplier.service';

describe('SupplierService: cadastros da empresa', () => {
  let prisma: any;
  let service: SupplierService;

  beforeEach(() => {
    prisma = {
      supplier: { findUnique: jest.fn(), findFirst: jest.fn() },
      category: { count: jest.fn(async ({ where }) => where.id.in.length) },
      paymentCondition: {
        count: jest.fn(async ({ where }) => where.id.in.length),
      },
      $transaction: jest.fn(),
    };
    service = new SupplierService(prisma);
  });

  it('grupo de outra empresa é recusado antes de criar', async () => {
    prisma.category.count.mockResolvedValueOnce(0);

    await expect(
      service.create({
        companyId: 'c-1',
        general: { name: 'Forn', categoryId: 'grupo-de-outra' },
      } as any),
    ).rejects.toThrow(new NotFoundException('Grupo não encontrado.'));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('condição do limite de crédito de outra empresa é recusada na edição', async () => {
    prisma.supplier.findUnique.mockResolvedValueOnce({ companyId: 'c-1' });
    prisma.paymentCondition.count.mockResolvedValueOnce(0);

    await expect(
      service.update('f-1', {
        creditLimit: { conditions: [{ id: 'pc-de-outra' }] },
      } as any),
    ).rejects.toThrow(
      new NotFoundException('Condição de pagamento não encontrada.'),
    );
    expect(prisma.paymentCondition.count).toHaveBeenCalledWith({
      where: { id: { in: ['pc-de-outra'] }, companyId: 'c-1' },
    });
  });
});
