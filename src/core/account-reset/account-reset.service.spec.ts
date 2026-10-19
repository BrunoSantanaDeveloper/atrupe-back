import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { RESET_STEPS, delegateOf } from './account-reset.plan';
import { AccountResetService } from './account-reset.service';

jest.mock('argon2', () => ({ verify: jest.fn() }));

/** Um Prisma de mentira: cada delegate conta o que o teste mandar. */
function fakePrisma(countByModel: Record<string, number> = {}) {
  const delegates: Record<string, any> = {};
  for (const step of RESET_STEPS) {
    delegates[delegateOf(step.model)] = {
      count: jest.fn().mockResolvedValue(countByModel[step.model] ?? 0),
    };
  }
  return {
    ...delegates,
    employee: {
      count: jest
        .fn()
        .mockImplementation(({ where }) =>
          Promise.resolve(where.userId ? 3 : 4),
        ),
      findFirst: jest.fn(),
    },
    digitalCertificate: { count: jest.fn().mockResolvedValue(1) },
    subscription: {
      findFirst: jest.fn().mockResolvedValue({
        status: 'ACTIVE',
        value: 217,
        cycle: 'MONTHLY',
        plan: { name: 'Atrupe Start' },
      }),
    },
    company: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'company-1',
        name: 'Bravix Comunicação Visual',
        cnpj: '44383650000139',
        ownerUserId: 'owner-1',
      }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'admin-1',
        name: 'Superadmin',
        password: 'hash',
      }),
    },
    companyDataReset: {
      updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  } as any;
}

describe('AccountResetService', () => {
  const companyService = { createDefaultItems: jest.fn() } as any;

  beforeEach(() => jest.clearAllMocks());

  describe('prévia', () => {
    it('conta o que sai por grupo; notas e configurações só entram se escolhidas', async () => {
      const prisma = fakePrisma({
        Quotation: 57,
        Order: 21,
        Client: 35,
        Product: 35,
        Receivable: 27,
        Payable: 21,
        PaymentCondition: 5,
        Nfe: 2,
      });
      const service = new AccountResetService(prisma, companyService);

      const preview = await service.preview('company-1', {
        includeFiscalDocuments: false,
        restoreDefaults: false,
      });

      const group = (name: string) =>
        preview.groups.find((g) => g.group === name)!;
      expect(group('documents')).toMatchObject({ included: true, total: 78 });
      expect(group('fiscal')).toMatchObject({
        optional: true,
        included: false,
        total: 2,
      });
      expect(group('settings')).toMatchObject({
        optional: true,
        included: false,
        total: 5,
      });
      // Notas (2) e condições (5) ficam fora do total sem as opções.
      expect(preview.totalToDelete).toBe(57 + 21 + 35 + 35 + 27 + 21);
      expect(preview.kept).toEqual({
        users: 3,
        employees: 4,
        digitalCertificates: 1,
        subscription: {
          plan: 'Atrupe Start',
          status: 'ACTIVE',
          value: 217,
          cycle: 'MONTHLY',
        },
      });
    });

    it('com as opções, notas e configurações entram no total', async () => {
      const prisma = fakePrisma({ Quotation: 1, Nfe: 2, PaymentCondition: 5 });
      const service = new AccountResetService(prisma, companyService);

      const preview = await service.preview('company-1', {
        includeFiscalDocuments: true,
        restoreDefaults: true,
      });

      expect(preview.totalToDelete).toBe(1 + 2 + 5);
    });
  });

  describe('confirmação', () => {
    it('senha errada não chega a apagar', async () => {
      const prisma = fakePrisma();
      (argon2.verify as jest.Mock).mockResolvedValue(false);
      const service = new AccountResetService(prisma, companyService);

      await expect(
        service.reset(
          'company-1',
          { password: 'x', confirmation: 'Bravix Comunicação Visual' },
          'admin-1',
        ),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('nome diferente do da empresa não chega a apagar', async () => {
      const prisma = fakePrisma();
      (argon2.verify as jest.Mock).mockResolvedValue(true);
      const service = new AccountResetService(prisma, companyService);

      await expect(
        service.reset(
          'company-1',
          { password: 'x', confirmation: 'Bravix' },
          'admin-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  it('descarta as cópias vencidas, e só elas', async () => {
    const prisma = fakePrisma();
    const service = new AccountResetService(prisma, companyService);
    const now = new Date('2026-11-20T12:00:00Z');

    await expect(service.purgeExpiredBackups(now)).resolves.toBe(2);
    expect(prisma.companyDataReset.updateMany).toHaveBeenCalledWith({
      where: { backupExpiresAt: { lt: now }, backup: { not: null } },
      data: { backup: null },
    });
  });

  it('cópia descartada não é baixada', async () => {
    const prisma = fakePrisma();
    prisma.companyDataReset.findUnique.mockResolvedValue({
      backup: null,
      companyId: 'company-1',
      createdAt: new Date(),
    });
    const service = new AccountResetService(prisma, companyService);

    await expect(service.backupFile('reset-1')).rejects.toThrow(
      NotFoundException,
    );
  });
});
