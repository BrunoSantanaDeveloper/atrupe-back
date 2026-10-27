import { BadRequestException } from '@nestjs/common';
import { QuotationController } from './quotation.controller';

/**
 * Motivo ao rejeitar (CRM fase 1, decisão do produto de 24/10/2026): com o
 * cadastro de motivos no plano, é obrigatório. Sem nenhum motivo de rejeição
 * cadastrado, a tela não teria o que oferecer e a rejeição segue livre
 * (5 das 325 empresas do homolog não tinham, 27/10/2026).
 */
describe('POST /sale/quotation/:id/reject — motivo', () => {
  const id = '6f1c2b8e-4d3a-4f5b-9c7d-1e2f3a4b5c6d';
  const req = {
    user: { userId: 'u-a', companyId: 'empresa-a', isAdmin: true },
  };

  function build({
    hasFeature,
    registered,
  }: {
    hasFeature: boolean;
    registered: number;
  }) {
    const service = { reject: jest.fn().mockResolvedValue({ id }) };
    const prisma = {
      quotation: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ companyId: 'empresa-a', sellerId: 'v-a' }),
      },
      reasons: { count: jest.fn().mockResolvedValue(registered) },
    };
    const plan = {
      hasFeature: jest.fn().mockResolvedValue(hasFeature),
      enforceFeature: jest.fn(),
    };
    const abac = { canAccessOtherSellers: jest.fn().mockResolvedValue(true) };
    const controller = new QuotationController(
      service as any,
      abac as any,
      prisma as any,
      plan as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { controller, service };
  }

  it('com motivos cadastrados, rejeitar sem motivo é recusado', async () => {
    const { controller, service } = build({ hasFeature: true, registered: 3 });
    await expect(controller.reject(id, {} as any, req)).rejects.toThrow(
      new BadRequestException('Informe o motivo da rejeição'),
    );
    expect(service.reject).not.toHaveBeenCalled();
  });

  it('com motivos cadastrados, rejeita com o motivo', async () => {
    const { controller, service } = build({ hasFeature: true, registered: 3 });
    await controller.reject(id, { reasonId: 'r-1' } as any, req);
    expect(service.reject).toHaveBeenCalled();
  });

  it('sem nenhum motivo cadastrado, rejeita livre', async () => {
    const { controller, service } = build({ hasFeature: true, registered: 0 });
    await controller.reject(id, {} as any, req);
    expect(service.reject).toHaveBeenCalled();
  });

  it('sem o cadastro de motivos no plano, rejeita livre', async () => {
    const { controller, service } = build({ hasFeature: false, registered: 3 });
    await controller.reject(id, {} as any, req);
    expect(service.reject).toHaveBeenCalled();
  });
});
