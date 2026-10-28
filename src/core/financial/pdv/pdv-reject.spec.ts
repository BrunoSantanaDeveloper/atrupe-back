import { BadRequestException } from '@nestjs/common';
import { PdvService } from './pdv.service';

jest.mock('../../production/production-follow', () => ({
  ...jest.requireActual('../../production/production-follow'),
  cancelProjectOfQuotationInTx: jest.fn(),
}));

/**
 * Rejeitar a venda da fila do caixa (FC-13.1): só sem valor recebido, e o
 * motivo segue a regra da rejeição do orçamento (pacote de 27/10/2026).
 */
describe('PdvService.reject', () => {
  const user = { userId: 'u1', companyId: 'empresa-a' } as any;
  const actor = { id: 'u1', name: 'Caixa' } as any;

  function setup({
    sale = {},
    hasFeature = true,
    registered = 1,
    reason = { id: 'motivo-1', reason: 'Desistiu' } as any,
  }: {
    sale?: Record<string, unknown>;
    hasFeature?: boolean;
    registered?: number;
    reason?: { id: string; reason: string } | null;
  } = {}) {
    const tx = {
      quotation: { update: jest.fn() },
      deliverySchedule: { updateMany: jest.fn() },
      order: { updateMany: jest.fn(), findUnique: jest.fn() },
      pendingSale: { update: jest.fn() },
      quotationHistory: { create: jest.fn() },
      orderHistory: { create: jest.fn() },
    };
    const prisma = {
      pendingSale: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'venda-1',
          quotationId: 'orc-1',
          paid: 0,
          cancelled: false,
          goesToCash: true,
          ...sale,
        }),
      },
      reasons: {
        count: jest.fn().mockResolvedValue(registered),
        findFirst: jest.fn().mockResolvedValue(reason),
      },
      $transaction: jest.fn(async (fn) => fn(tx)),
    };
    const plan = {
      hasFeature: jest.fn().mockResolvedValue(hasFeature),
      enforceFeature: jest.fn(),
    };
    const service = new PdvService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      plan as any,
    );
    return { service, prisma, plan, tx };
  }

  it('com motivo de rejeição cadastrado, pede o motivo', async () => {
    const { service, tx } = setup();
    await expect(service.reject(user, 'venda-1', {}, actor)).rejects.toThrow(
      'Informe o motivo da rejeição',
    );
    expect(tx.quotation.update).not.toHaveBeenCalled();
  });

  it('sem nenhum motivo cadastrado, rejeita sem motivo', async () => {
    const { service, tx } = setup({ registered: 0 });
    await expect(service.reject(user, 'venda-1', {}, actor)).resolves.toEqual({
      rejected: true,
      reason: null,
    });
    expect(tx.quotation.update).toHaveBeenCalledWith({
      where: { id: 'orc-1' },
      data: { status: 'REJECTED' },
    });
  });

  it('só aceita motivo de rejeição da empresa', async () => {
    const { service, prisma } = setup({ reason: null });
    await expect(
      service.reject(user, 'venda-1', { reasonId: 'motivo-x' }, actor),
    ).rejects.toThrow('Motivo de rejeição não encontrado');
    expect(prisma.reasons.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'motivo-x',
          companyId: 'empresa-a',
          type: 'REJECTION',
        },
      }),
    );
  });

  it('com o motivo, grava no orçamento e tira a venda da fila', async () => {
    const { service, tx } = setup();
    await service.reject(user, 'venda-1', { reasonId: 'motivo-1' }, actor);
    expect(tx.quotation.update).toHaveBeenCalledWith({
      where: { id: 'orc-1' },
      data: { status: 'REJECTED', reasonId: 'motivo-1' },
    });
    expect(tx.pendingSale.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cancelled: true,
          cancelReason: 'Desistiu',
        }),
      }),
    );
  });

  it('sem o recurso no plano, o motivo informado esbarra no plano', async () => {
    const { service, plan } = setup({ hasFeature: false });
    await service.reject(user, 'venda-1', { reasonId: 'motivo-1' }, actor);
    expect(plan.enforceFeature).toHaveBeenCalledWith(
      'empresa-a',
      'quotation_rejection_reasons',
    );
  });

  it('venda com valor recebido vai pelo cancelamento com estorno', async () => {
    const { service } = setup({ sale: { paid: 1000 } });
    await expect(
      service.reject(user, 'venda-1', { reasonId: 'motivo-1' }, actor),
    ).rejects.toThrow(BadRequestException);
  });
});
