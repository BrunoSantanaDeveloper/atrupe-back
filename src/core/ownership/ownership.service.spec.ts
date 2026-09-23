import { ForbiddenException } from '@nestjs/common';
import { hashInviteToken } from './ownership.domain';
import { OwnershipService } from './ownership.service';

describe('OwnershipService', () => {
  const NOW = new Date('2026-09-22T12:00:00.000Z');
  const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

  const company = {
    id: 'company-1',
    name: 'Marcenaria Horizonte',
    legalName: 'Marcenaria Horizonte Ltda',
    cnpj: '11222333000181',
    createdAt: new Date('2025-03-10T12:00:00.000Z'),
    ownerUserId: 'titular',
    principalCompanyId: null,
    _count: { subsidiaries: 0 },
  };

  let prisma: any;
  let quoteService: any;
  let mailer: any;
  let service: OwnershipService;

  beforeEach(() => {
    prisma = {
      company: { findUnique: jest.fn().mockResolvedValue(company) },
      ownershipPeriod: { findMany: jest.fn().mockResolvedValue([]) },
      ownershipTransfer: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(async ({ data }) => ({
          id: 'transfer-1',
          createdAt: NOW,
          status: 'PENDING',
          ...data,
        })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      contractAcceptance: {
        findFirst: jest.fn().mockResolvedValue({
          contractorName: 'Marcenaria Horizonte Ltda',
          contractorDocument: '11222333000181',
        }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          name: 'Ana Titular',
          email: 'ana@horizonte.com.br',
        }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'titular',
          name: 'Ana Titular',
          email: 'ana@horizonte.com.br',
        }),
      },
      companyHistory: { create: jest.fn() },
      $executeRaw: jest.fn(),
    };
    prisma.$transaction = jest.fn(async (fn) => fn(prisma));
    quoteService = {
      getBillingContext: jest.fn().mockResolvedValue({ hasOpenCharge: false }),
    };
    mailer = { sendMail: jest.fn().mockResolvedValue(undefined) };
    service = new OwnershipService(prisma, quoteService, mailer);
    process.env.FRONTEND_URL = 'https://app.atrupe.com.br';
    process.env.APP_ENV = 'production';
  });

  describe('view', () => {
    it('o titular atual com os dados de hoje do contratante, e os anteriores', async () => {
      prisma.ownershipPeriod.findMany.mockResolvedValue([
        {
          holderName: 'Nome do cadastro',
          document: null,
          email: 'ana@horizonte.com.br',
          startedAt: days(30),
          endedAt: null,
        },
        {
          holderName: 'Studio Norte Ltda',
          document: '99888777000166',
          email: 'marcos@norte.com.br',
          startedAt: days(400),
          endedAt: days(30),
        },
      ]);

      const view = await service.view('company-1', 'titular', NOW);

      expect(view.isOwner).toBe(true);
      expect(view.current).toMatchObject({
        holderName: 'Marcenaria Horizonte Ltda',
        document: '11222333000181',
        startedAt: days(30),
        endedAt: null,
      });
      expect(view.previous).toEqual([
        expect.objectContaining({ holderName: 'Studio Norte Ltda' }),
      ]);
      expect(view.canSend).toBe(true);
    });

    it('pendente dentro do prazo aparece com os dias restantes e trava novo envio', async () => {
      prisma.ownershipTransfer.findMany.mockResolvedValue([
        {
          status: 'PENDING',
          createdAt: days(3),
          targetEmail: 'nova@empresa.com.br',
          fromUserName: 'Ana Titular',
        },
      ]);

      const view = await service.view('company-1', 'titular', NOW);

      expect(view.pending).toMatchObject({
        targetEmail: 'nova@empresa.com.br',
        daysLeft: 11,
      });
      expect(view.canSend).toBe(false);
    });

    it('pendente vencida não conta: o envio volta a ficar disponível', async () => {
      prisma.ownershipTransfer.findMany.mockResolvedValue([
        { status: 'PENDING', createdAt: days(15), targetEmail: 'x@y.com' },
      ]);

      const view = await service.view('company-1', 'titular', NOW);

      expect(view.pending).toBeNull();
      expect(view.canSend).toBe(true);
    });

    it('administrador que não é o titular vê a titularidade, sem poder transferir', async () => {
      const view = await service.view('company-1', 'outro-admin', NOW);

      expect(view.isOwner).toBe(false);
      expect(view.canSend).toBe(false);
      expect(view.current).not.toBeNull();
    });

    it('cobrança em aberto bloqueia, com o motivo', async () => {
      quoteService.getBillingContext.mockResolvedValue({ hasOpenCharge: true });

      const view = await service.view('company-1', 'titular', NOW);

      expect(view.blocked).toMatchObject({ code: 'OPEN_CHARGE' });
      expect(view.canSend).toBe(false);
    });
  });

  describe('send', () => {
    const dto = {
      targetEmail: ' Nova@Empresa.com.br ',
      confirmLossOfAccess: true,
    };

    it('quem não é o titular não envia, e nada é criado', async () => {
      await expect(
        service.send(
          { userId: 'outro-admin', companyId: 'company-1' },
          dto,
          NOW,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.ownershipTransfer.create).not.toHaveBeenCalled();
    });

    it('o próprio e-mail não é destino', async () => {
      await expect(
        service.send(
          { userId: 'titular', companyId: 'company-1' },
          { targetEmail: 'ANA@horizonte.com.br', confirmLossOfAccess: true },
          NOW,
        ),
      ).rejects.toMatchObject({ response: { code: 'SAME_EMAIL' } });
    });

    it('cobrança em aberto recusa o envio', async () => {
      quoteService.getBillingContext.mockResolvedValue({ hasOpenCharge: true });

      await expect(
        service.send({ userId: 'titular', companyId: 'company-1' }, dto, NOW),
      ).rejects.toMatchObject({ response: { code: 'OPEN_CHARGE' } });
      expect(prisma.ownershipTransfer.create).not.toHaveBeenCalled();
    });

    it('ambiente com filiais é transferido com a Atrupe', async () => {
      prisma.company.findUnique.mockResolvedValue({
        ...company,
        _count: { subsidiaries: 2 },
      });

      await expect(
        service.send({ userId: 'titular', companyId: 'company-1' }, dto, NOW),
      ).rejects.toMatchObject({ response: { code: 'BRANCHES_NOT_SUPPORTED' } });
    });

    it('com uma pendente, recusa: é preciso cancelá-la antes', async () => {
      prisma.ownershipTransfer.findMany.mockResolvedValue([
        { status: 'PENDING', createdAt: days(1) },
      ]);

      await expect(
        service.send({ userId: 'titular', companyId: 'company-1' }, dto, NOW),
      ).rejects.toMatchObject({ response: { code: 'TRANSFER_PENDING' } });
      expect(prisma.ownershipTransfer.create).not.toHaveBeenCalled();
    });

    it('cria a pendente com o hash do token e manda o convite com o link', async () => {
      await service.send(
        { userId: 'titular', companyId: 'company-1' },
        dto,
        NOW,
      );

      const data = prisma.ownershipTransfer.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        companyId: 'company-1',
        companyName: 'Marcenaria Horizonte',
        fromUserId: 'titular',
        targetEmail: 'nova@empresa.com.br',
      });

      const mail = mailer.sendMail.mock.calls[0][0];
      expect(mail.to).toBe('nova@empresa.com.br');
      expect(mail.template).toBe('ownership-transfer-invite');
      const link: string = mail.context.inviteLink;
      expect(
        link.startsWith(
          'https://app.atrupe.com.br/convite-de-transferencia?token=',
        ),
      ).toBe(true);
      // Só o hash vai para o banco: o token do link o reproduz.
      const token = decodeURIComponent(link.split('token=')[1]);
      expect(hashInviteToken(token)).toBe(data.tokenHash);
      expect(data.tokenHash).not.toContain(token);
    });

    it('fora de produção o link volta na resposta, para testar sem e-mail', async () => {
      process.env.APP_ENV = 'homolog';

      const result: any = await service.send(
        { userId: 'titular', companyId: 'company-1' },
        dto,
        NOW,
      );

      expect(result.devInviteUrl).toContain('/convite-de-transferencia?token=');
    });

    it('e-mail que falha não desfaz a pendente', async () => {
      mailer.sendMail.mockRejectedValue(new Error('SMTP fora do ar'));

      await expect(
        service.send({ userId: 'titular', companyId: 'company-1' }, dto, NOW),
      ).resolves.toBeDefined();
      expect(prisma.ownershipTransfer.create).toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('só o titular cancela', async () => {
      await expect(
        service.cancel({ userId: 'outro-admin', companyId: 'company-1' }, NOW),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('sem pendente, diz que não há o que cancelar', async () => {
      await expect(
        service.cancel({ userId: 'titular', companyId: 'company-1' }, NOW),
      ).rejects.toMatchObject({ response: { code: 'NO_PENDING_TRANSFER' } });
    });

    it('cancela a pendente e registra no histórico da empresa', async () => {
      prisma.ownershipTransfer.findMany.mockResolvedValue([
        {
          id: 'transfer-1',
          status: 'PENDING',
          createdAt: days(2),
          targetEmail: 'nova@empresa.com.br',
        },
      ]);

      await service.cancel({ userId: 'titular', companyId: 'company-1' }, NOW);

      expect(prisma.ownershipTransfer.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'CANCELED', canceledAt: NOW },
        }),
      );
      expect(prisma.companyHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'OWNERSHIP_TRANSFER_CANCELED',
          }),
        }),
      );
    });

    it('um aceite em curso não é interrompido', async () => {
      prisma.ownershipTransfer.findMany.mockResolvedValue([
        { id: 'transfer-1', status: 'ACCEPTING', createdAt: days(2) },
      ]);
      prisma.ownershipTransfer.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.cancel({ userId: 'titular', companyId: 'company-1' }, NOW),
      ).rejects.toMatchObject({
        response: { code: 'TRANSFER_BEING_ACCEPTED' },
      });
    });
  });
});
