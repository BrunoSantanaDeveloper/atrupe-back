import { QuickSaleService } from './quick-sale.service';

/**
 * A venda rápida nasce quando a tela abre: a que ficou sem item (aba fechada
 * antes do primeiro item) sai da lista de madrugada, inativa, como no
 * "excluir" da tela (revisão de 23/10/2026).
 */
describe('QuickSaleService.cleanupEmpty', () => {
  const build = (updateMany: jest.Mock) =>
    new QuickSaleService(
      { quotation: { updateMany } } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

  it('inativa a venda rápida aberta, sem item, fora do caixa, de mais de 12 horas', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 2 });
    const now = new Date('2026-10-23T06:25:00.000Z');

    await expect(build(updateMany).cleanupEmpty(now)).resolves.toBe(2);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        quickSale: true,
        isActive: true,
        status: 'OPEN',
        createdAt: { lt: new Date('2026-10-22T18:25:00.000Z') },
        quotationProduct: { none: {} },
        pendingSale: { is: null },
      },
      data: { isActive: false },
    });
  });

  it('a falha fica no log, sem derrubar a rotina', async () => {
    const updateMany = jest.fn().mockRejectedValue(new Error('banco fora'));
    const service = build(updateMany);
    const logError = jest
      .spyOn((service as any).logger, 'error')
      .mockImplementation(() => undefined);

    await expect(service.cleanupEmpty()).resolves.toBe(0);
    expect(logError).toHaveBeenCalled();
  });
});
