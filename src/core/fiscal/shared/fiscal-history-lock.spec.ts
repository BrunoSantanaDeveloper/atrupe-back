import {
  FiscalHistoryLock,
  isHistoricalDocument,
  loadFiscalHistoryLock,
} from './fiscal-history-lock';

describe('fiscal-history-lock', () => {
  const troca = new Date('2026-09-20T15:00:00.000Z');
  const trava: FiscalHistoryLock = {
    lockedBefore: troca,
    historicalEmitterIds: ['emissor-antigo'],
    reason: 'motivo',
  };

  describe('isHistoricalDocument', () => {
    it('sem troca de CNPJ, nada é histórico', () => {
      expect(
        isHistoricalDocument(
          { createdAt: new Date('2020-01-01'), invoicyConfigId: 'x' },
          null,
        ),
      ).toBe(false);
    });

    it('nota de um emissor do CNPJ anterior é histórico', () => {
      expect(
        isHistoricalDocument(
          {
            createdAt: new Date('2026-09-01'),
            invoicyConfigId: 'emissor-antigo',
          },
          trava,
        ),
      ).toBe(true);
    });

    it('rejeitada de antes, reemitida pelo emissor novo, deixa de ser histórico', () => {
      expect(
        isHistoricalDocument(
          {
            createdAt: new Date('2026-09-01'),
            invoicyConfigId: 'emissor-novo',
          },
          trava,
        ),
      ).toBe(false);
    });

    it('nota antiga sem emissor registrado: vale a data', () => {
      expect(
        isHistoricalDocument(
          { createdAt: new Date('2026-09-01'), invoicyConfigId: null },
          trava,
        ),
      ).toBe(true);
      expect(
        isHistoricalDocument(
          { createdAt: new Date('2026-09-21'), invoicyConfigId: null },
          trava,
        ),
      ).toBe(false);
    });
  });

  describe('loadFiscalHistoryLock', () => {
    it('empresa sem troca de CNPJ não tem trava, e não consulta emissores', async () => {
      const prisma = {
        company: {
          findUnique: jest.fn().mockResolvedValue({ fiscalResetAt: null }),
        },
        invoicyConfig: { findMany: jest.fn() },
      };

      await expect(
        loadFiscalHistoryLock(prisma as any, 'company-1'),
      ).resolves.toBeNull();
      expect(prisma.invoicyConfig.findMany).not.toHaveBeenCalled();
    });

    it('com a troca: os emissores de antes dela e o motivo com a data', async () => {
      const prisma = {
        company: {
          findUnique: jest.fn().mockResolvedValue({ fiscalResetAt: troca }),
        },
        invoicyConfig: {
          findMany: jest.fn().mockResolvedValue([{ id: 'emissor-antigo' }]),
        },
      };

      const lock = await loadFiscalHistoryLock(prisma as any, 'company-1');

      expect(prisma.invoicyConfig.findMany).toHaveBeenCalledWith({
        where: { companyId: 'company-1', createdAt: { lt: troca } },
        select: { id: true },
      });
      expect(lock).toMatchObject({
        lockedBefore: troca,
        historicalEmitterIds: ['emissor-antigo'],
      });
      expect(lock!.reason).toContain('20/09/2026');
    });
  });
});
