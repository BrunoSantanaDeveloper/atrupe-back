import {
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AiActionService } from './ai-action.service';

describe('AiActionService', () => {
  const user = { userId: 'user-1', companyId: 'company-1' };
  const id = '0b9f6a0e-5c1d-4e8a-9a3b-2f1c4d5e6f70';
  const payload = {
    items: [{ text: 'placa', status: 'OK', unitPrice: 9000, total: 18000 }],
    total: 18000,
  };

  function makeService(
    row: Record<string, unknown> | null,
    options: { features?: Record<string, boolean>; values?: boolean } = {},
  ) {
    const prisma = {
      aiAction: {
        create: jest.fn().mockResolvedValue({ id }),
        findFirst: jest.fn().mockResolvedValue(row),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const abacService = {
      hasPermission: jest.fn().mockResolvedValue(options.values ?? true),
    };
    const planControl = {
      getCompanyPlanInfo: jest.fn().mockResolvedValue({
        features: options.features ?? { ai_assistant: true },
        limits: {},
      }),
      enforceFeature: jest
        .fn()
        .mockRejectedValue(new ForbiddenException('fora do plano')),
    };
    const settings = { isAiAccessEnabled: jest.fn().mockResolvedValue(true) };
    const usage = { recordAction: jest.fn().mockResolvedValue(undefined) };
    const drafts = {
      apply: jest.fn().mockResolvedValue({
        status: 'APPLIED',
        quotationId: 'quotation-1',
        itemIds: ['item-1'],
        warnings: [],
      }),
      withoutValues: jest.fn((p) => ({ ...p, total: undefined })),
      summaryLine: jest.fn().mockReturnValue('Orçamento: 1 item'),
    };
    const service = new AiActionService(
      prisma as any,
      abacService as any,
      planControl as any,
      settings as any,
      usage as any,
      drafts as any,
    );
    return { service, prisma, drafts, usage, planControl };
  }

  const proposed = (overrides: Record<string, unknown> = {}) => ({
    id,
    companyId: 'company-1',
    userId: 'user-1',
    type: 'QUOTATION_DRAFT',
    status: 'PROPOSED',
    payload,
    result: null,
    expiresAt: new Date(Date.now() + 60_000),
    appliedAt: null,
    createdAt: new Date(),
    ...overrides,
  });

  it('propor grava PROPOSED com validade de 24 horas e conta a proposta', async () => {
    const { service, prisma, usage } = makeService(null);

    const action = await service.propose(
      user,
      'QUOTATION_DRAFT',
      payload,
      'c-1',
    );

    const data = prisma.aiAction.create.mock.calls[0][0].data;
    expect(data).toEqual(
      expect.objectContaining({
        companyId: 'company-1',
        userId: 'user-1',
        conversationId: 'c-1',
        type: 'QUOTATION_DRAFT',
      }),
    );
    expect(data.expiresAt.getTime() - Date.now()).toBeGreaterThan(
      23.9 * 3600_000,
    );
    expect(usage.recordAction).toHaveBeenCalledWith('company-1', 'proposed');
    expect(action).toEqual({
      id,
      type: 'QUOTATION_DRAFT',
      summary: 'Orçamento: 1 item',
    });
  });

  describe('aplicar: de outro usuário, vencida ou já aplicada', () => {
    it('de outro usuário: 404 (a busca é pelo dono)', async () => {
      const { service, prisma, drafts } = makeService(null);

      await expect(service.apply(id, user)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.aiAction.findFirst).toHaveBeenCalledWith({
        where: { id, companyId: 'company-1', userId: 'user-1' },
      });
      expect(drafts.apply).not.toHaveBeenCalled();
    });

    it('vencida: 410 e marca EXPIRED', async () => {
      const { service, prisma, drafts } = makeService(
        proposed({ expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(service.apply(id, user)).rejects.toBeInstanceOf(
        GoneException,
      );
      expect(prisma.aiAction.updateMany).toHaveBeenCalledWith({
        where: { id, status: 'PROPOSED' },
        data: { status: 'EXPIRED' },
      });
      expect(drafts.apply).not.toHaveBeenCalled();
    });

    it('já aplicada: devolve o resultado da primeira, sem gravar de novo', async () => {
      const first = { status: 'APPLIED', quotationId: 'quotation-1' };
      const { service, drafts } = makeService(
        proposed({ status: 'APPLIED', result: first }),
      );

      await expect(service.apply(id, user)).resolves.toEqual(first);
      expect(drafts.apply).not.toHaveBeenCalled();
    });
  });

  it('aplica: reserva, grava pelo serviço do tipo e registra APPLIED', async () => {
    const { service, prisma, drafts, usage } = makeService(proposed());
    const edited = { clientId: 'client-1' };

    const result = await service.apply(id, user, edited);

    expect(prisma.aiAction.updateMany).toHaveBeenCalledWith({
      where: { id, status: 'PROPOSED' },
      data: { status: 'APPLYING', edited },
    });
    expect(drafts.apply).toHaveBeenCalledWith(
      payload,
      edited,
      user,
      new Set(['ai_assistant']),
    );
    expect(prisma.aiAction.update).toHaveBeenCalledWith({
      where: { id },
      data: expect.objectContaining({ status: 'APPLIED', result }),
    });
    expect(usage.recordAction).toHaveBeenCalledWith('company-1', 'applied');
  });

  it('dois cliques ao mesmo tempo: o segundo recebe o resultado do primeiro', async () => {
    const first = { status: 'APPLIED', quotationId: 'quotation-1' };
    const { service, prisma, drafts } = makeService(proposed());
    prisma.aiAction.updateMany.mockResolvedValueOnce({ count: 0 });
    prisma.aiAction.findFirst
      .mockResolvedValueOnce(proposed())
      .mockResolvedValueOnce(proposed({ status: 'APPLIED', result: first }));

    await expect(service.apply(id, user)).resolves.toEqual(first);
    expect(drafts.apply).not.toHaveBeenCalled();
  });

  it('ainda em aplicação: 409', async () => {
    const { service, prisma } = makeService(proposed());
    prisma.aiAction.updateMany.mockResolvedValueOnce({ count: 0 });
    prisma.aiAction.findFirst
      .mockResolvedValueOnce(proposed())
      .mockResolvedValueOnce(proposed({ status: 'APPLYING' }));

    await expect(service.apply(id, user)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('falta escolher: a proposta volta a PROPOSED para a pessoa corrigir', async () => {
    const { service, prisma, drafts } = makeService(proposed());
    drafts.apply.mockRejectedValue(
      new UnprocessableEntityException('Falta a medida'),
    );

    await expect(service.apply(id, user)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(prisma.aiAction.update).toHaveBeenCalledWith({
      where: { id },
      data: { status: 'PROPOSED', result: { error: 'Falta a medida' } },
    });
  });

  it('plano sem o assistente: não aplica', async () => {
    const { service, drafts } = makeService(proposed(), { features: {} });

    await expect(service.apply(id, user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(drafts.apply).not.toHaveBeenCalled();
  });

  it('sem values:values, a proposta sai sem preços', async () => {
    const { service, drafts } = makeService(proposed(), { values: false });

    const view = await service.get(id, user);

    expect(drafts.withoutValues).toHaveBeenCalledWith(payload);
    expect(view.payload).toEqual(expect.objectContaining({ total: undefined }));
  });

  it('descartar: DISCARDED; aplicada não descarta', async () => {
    const open = makeService(proposed());
    await expect(open.service.discard(id, user)).resolves.toEqual({
      id,
      status: 'DISCARDED',
    });

    const applied = makeService(proposed({ status: 'APPLIED' }));
    await expect(applied.service.discard(id, user)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
