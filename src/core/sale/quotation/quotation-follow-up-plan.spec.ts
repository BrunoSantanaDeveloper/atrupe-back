import { ForbiddenException } from '@nestjs/common';
import { QuotationController } from './quotation.controller';

/**
 * O próximo contato do orçamento é do acompanhamento comercial (CRM-7,
 * 29/10/2026): o card da tela o grava pelo PATCH do orçamento, e a API
 * pede a chave quando ele vem no corpo.
 */
describe('Orçamento: o próximo contato pede o acompanhamento comercial', () => {
  const service = { update: jest.fn().mockResolvedValue({ id: 'q' }) };
  const prisma = {
    quotation: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ companyId: 'empresa-a', sellerId: 'v-a' }),
    },
  };
  const abac = { canAccessOtherSellers: jest.fn().mockResolvedValue(true) };
  let features: Set<string>;
  const planControl = {
    enforceFeature: jest.fn(async (_company: string, key: string) => {
      if (!features.has(key)) throw new ForbiddenException(`sem ${key}`);
    }),
  };
  const controller = new QuotationController(
    service as any,
    abac as any,
    prisma as any,
    planControl as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const req = { user: { userId: 'u-a', companyId: 'empresa-a' } };
  const id = '6f1c2b8e-4d3a-4f5b-9c7d-1e2f3a4b5c6d';

  beforeEach(() => {
    jest.clearAllMocks();
    features = new Set();
  });

  it.each([
    ['a data', { nextContactAt: '2026-11-03T12:00:00.000Z' }],
    ['a anotação', { nextContactNote: 'Ligar depois do almoço' }],
    ['a limpeza', { nextContactAt: null }],
  ])('sem a chave, %s do próximo contato é recusada', async (_label, dto) => {
    await expect(controller.update(id, dto as any, req)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(planControl.enforceFeature).toHaveBeenCalledWith(
      'empresa-a',
      'sales_follow_up',
    );
    expect(service.update).not.toHaveBeenCalled();
  });

  it('com a chave, o próximo contato é gravado', async () => {
    features.add('sales_follow_up');
    const dto = { nextContactAt: '2026-11-03T12:00:00.000Z' };

    await controller.update(id, dto as any, req);

    expect(service.update).toHaveBeenCalled();
  });

  it('o resto do orçamento não pede a chave', async () => {
    await controller.update(id, { description: 'Banner' } as any, req);

    expect(planControl.enforceFeature).not.toHaveBeenCalled();
    expect(service.update).toHaveBeenCalled();
  });
});
