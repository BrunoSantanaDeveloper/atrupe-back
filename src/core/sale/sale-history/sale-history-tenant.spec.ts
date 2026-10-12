import { SaleHistoryService } from './sale-history.service';

/**
 * O histórico da venda (alterações, contas e usuários) era lido pelo id do
 * orçamento ou da O.S. de qualquer empresa.
 */
describe('Histórico da venda: só da empresa da sessão', () => {
  const prisma = {
    quotation: { findFirst: jest.fn().mockResolvedValue(null) },
    order: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const service = new SaleHistoryService(prisma as any);

  it('orçamento de outra empresa: não encontrado', async () => {
    await expect(
      service.getSaleHistory('orcamento-b', 'empresa-a'),
    ).rejects.toThrow('Orçamento não encontrado');
    expect(prisma.quotation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'orcamento-b', companyId: 'empresa-a' },
      }),
    );
  });

  it('O.S. de outra empresa: não encontrada', async () => {
    await expect(
      service.getSaleHistoryByOrderId('os-b', 'empresa-a'),
    ).rejects.toThrow('Ordem de serviço não encontrada');
    expect(prisma.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'os-b', quotation: { companyId: 'empresa-a' } },
      }),
    );
  });
});
