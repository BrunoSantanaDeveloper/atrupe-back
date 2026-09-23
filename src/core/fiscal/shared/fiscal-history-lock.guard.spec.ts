import { ConflictException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FiscalHistoryLockGuard } from './fiscal-history-lock.guard';

describe('FiscalHistoryLockGuard', () => {
  const troca = new Date('2026-09-20T15:00:00.000Z');
  let prisma: any;
  let reflector: Reflector;
  let guard: FiscalHistoryLockGuard;

  const contextOf = (request: any) =>
    ({
      getHandler: () => 'handler',
      switchToHttp: () => ({ getRequest: () => request }),
    }) as any;

  beforeEach(() => {
    prisma = {
      company: {
        findUnique: jest.fn().mockResolvedValue({ fiscalResetAt: troca }),
      },
      invoicyConfig: {
        findMany: jest.fn().mockResolvedValue([{ id: 'emissor-antigo' }]),
      },
      nfe: { findFirst: jest.fn() },
      nfse: { findFirst: jest.fn() },
      nfce: { findFirst: jest.fn() },
    };
    reflector = new Reflector();
    guard = new FiscalHistoryLockGuard(reflector, prisma);
  });

  it('rota que não mexe em nota emitida passa sem consultar nada', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue(undefined);

    await expect(
      guard.canActivate(contextOf({ user: { companyId: 'c1' }, params: {} })),
    ).resolves.toBe(true);
    expect(prisma.company.findUnique).not.toHaveBeenCalled();
  });

  it('cancelar nota do CNPJ anterior é recusado, com o motivo', async () => {
    jest
      .spyOn(reflector, 'get')
      .mockReturnValue({ kind: 'nfe', from: { param: 'id' } });
    prisma.nfe.findFirst.mockResolvedValue({
      createdAt: new Date('2026-08-01'),
      invoicyConfigId: 'emissor-antigo',
    });

    const request = { user: { companyId: 'c1' }, params: { id: 'nfe-1' } };
    await expect(guard.canActivate(contextOf(request))).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.nfe.findFirst).toHaveBeenCalledWith({
      where: { id: 'nfe-1', companyId: 'c1' },
      select: { createdAt: true, invoicyConfigId: true },
    });
  });

  it('nota do emissor novo passa', async () => {
    jest
      .spyOn(reflector, 'get')
      .mockReturnValue({ kind: 'nfce', from: { param: 'id' } });
    prisma.nfce.findFirst.mockResolvedValue({
      createdAt: new Date('2026-09-21'),
      invoicyConfigId: 'emissor-novo',
    });

    await expect(
      guard.canActivate(
        contextOf({ user: { companyId: 'c1' }, params: { id: 'nfce-1' } }),
      ),
    ).resolves.toBe(true);
  });

  it('reemissão pelo corpo: a nota de origem do CNPJ anterior é recusada', async () => {
    jest
      .spyOn(reflector, 'get')
      .mockReturnValue({ kind: 'nfe', from: { body: 'reissueOfNfeId' } });
    prisma.nfe.findFirst.mockResolvedValue({
      createdAt: new Date('2026-08-01'),
      invoicyConfigId: null,
    });

    await expect(
      guard.canActivate(
        contextOf({
          user: { companyId: 'c1' },
          params: {},
          body: { reissueOfNfeId: 'nfe-velha' },
        }),
      ),
    ).rejects.toMatchObject({ response: { code: 'FISCAL_DOCUMENT_LOCKED' } });
  });

  it('emissão avulsa, sem nota de origem, passa', async () => {
    jest
      .spyOn(reflector, 'get')
      .mockReturnValue({ kind: 'nfe', from: { body: 'reissueOfNfeId' } });

    await expect(
      guard.canActivate(
        contextOf({ user: { companyId: 'c1' }, params: {}, body: {} }),
      ),
    ).resolves.toBe(true);
    expect(prisma.company.findUnique).not.toHaveBeenCalled();
  });

  it('empresa sem troca de CNPJ não consulta a nota', async () => {
    jest
      .spyOn(reflector, 'get')
      .mockReturnValue({ kind: 'nfse', from: { param: 'id' } });
    prisma.company.findUnique.mockResolvedValue({ fiscalResetAt: null });

    await expect(
      guard.canActivate(
        contextOf({ user: { companyId: 'c1' }, params: { id: 'nfse-1' } }),
      ),
    ).resolves.toBe(true);
    expect(prisma.nfse.findFirst).not.toHaveBeenCalled();
  });
});
