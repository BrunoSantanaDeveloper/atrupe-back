import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { FiscalCredentialResolverService } from './fiscal-credential-resolver.service';
import { FiscalRolloutPolicyService } from './fiscal-rollout-policy.service';
import { PrismaService } from '../../../config/prisma/prisma.service';
import { EncryptionService } from '../../../shared/services/encryption.service';
import { FiscalEnvironment } from '@prisma/client';

/**
 * Cobertura da reserva atômica de numeração fiscal (Fase 3).
 *
 * Dois invariantes são testados aqui porque errá-los é caro: numeração
 * duplicada em produção exige inutilização junto à SEFAZ.
 *   1. A linha ambiental é a autoridade quando existe — sequências de
 *      homologação e produção são independentes.
 *   2. O valor retornado é o ANTERIOR ao incremento (o número a usar).
 */
describe('FiscalCredentialResolverService — reserva de numeração', () => {
  let service: FiscalCredentialResolverService;
  let tx: any;

  const CONFIG_ID = 'emissor-1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FiscalCredentialResolverService,
        { provide: PrismaService, useValue: {} },
        { provide: EncryptionService, useValue: { decrypt: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        {
          provide: FiscalRolloutPolicyService,
          useValue: {
            shouldReadFromEncrypted: jest.fn().mockReturnValue(true),
            shouldWriteToLegacy: jest.fn().mockReturnValue(false),
          },
        },
      ],
    }).compile();

    service = module.get(FiscalCredentialResolverService);

    tx = {
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn().mockResolvedValue(1),
      invoicyEnvironmentConfig: { create: jest.fn() },
    };
  });

  describe('reserveNfeNumber', () => {
    it('usa a linha ambiental quando ela existe e devolve o número anterior ao incremento', async () => {
      tx.$queryRaw
        // lock do emissor legado
        .mockResolvedValueOnce([
          { id: CONFIG_ID, proximoNumeroNfe: 999, serieNfe: 9 },
        ])
        // lock da linha ambiental
        .mockResolvedValueOnce([
          { id: 'env-1', nfeNextNumber: 42, nfeSeries: 3 },
        ]);

      const result = await service.reserveNfeNumber(
        tx,
        CONFIG_ID,
        FiscalEnvironment.PRODUCAO,
      );

      // A linha ambiental vence o campo legado (999/9).
      expect(result).toEqual({ reservedNumber: 42, series: 3 });
      expect(tx.invoicyEnvironmentConfig.create).not.toHaveBeenCalled();
    });

    it('cai no campo legado quando não há linha ambiental e cria a linha', async () => {
      tx.$queryRaw
        .mockResolvedValueOnce([
          { id: CONFIG_ID, proximoNumeroNfe: 7, serieNfe: 2 },
        ])
        .mockResolvedValueOnce([]);

      const result = await service.reserveNfeNumber(
        tx,
        CONFIG_ID,
        FiscalEnvironment.HOMOLOGACAO,
      );

      expect(result).toEqual({ reservedNumber: 7, series: 2 });
      expect(tx.invoicyEnvironmentConfig.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          invoicyConfigId: CONFIG_ID,
          environment: FiscalEnvironment.HOMOLOGACAO,
          docType: 'NFE',
          nfeNextNumber: 8,
          nfeSeries: 2,
        }),
      });
    });

    it('começa em 1 quando nem a linha ambiental nem o legado têm número', async () => {
      tx.$queryRaw
        .mockResolvedValueOnce([
          { id: CONFIG_ID, proximoNumeroNfe: null, serieNfe: null },
        ])
        .mockResolvedValueOnce([]);

      const result = await service.reserveNfeNumber(
        tx,
        CONFIG_ID,
        FiscalEnvironment.HOMOLOGACAO,
      );

      expect(result).toEqual({ reservedNumber: 1, series: 1 });
    });

    it('lança quando o emissor não existe', async () => {
      tx.$queryRaw.mockResolvedValueOnce([]);

      await expect(
        service.reserveNfeNumber(tx, CONFIG_ID, FiscalEnvironment.HOMOLOGACAO),
      ).rejects.toThrow(NotFoundException);
    });

    it('trava o emissor antes da linha ambiental (ordem de locks anti-deadlock)', async () => {
      tx.$queryRaw
        .mockResolvedValueOnce([
          { id: CONFIG_ID, proximoNumeroNfe: 1, serieNfe: 1 },
        ])
        .mockResolvedValueOnce([
          { id: 'env-1', nfeNextNumber: 1, nfeSeries: 1 },
        ]);

      await service.reserveNfeNumber(
        tx,
        CONFIG_ID,
        FiscalEnvironment.HOMOLOGACAO,
      );

      const primeiroLock = tx.$queryRaw.mock.calls[0][0].join('');
      const segundoLock = tx.$queryRaw.mock.calls[1][0].join('');
      expect(primeiroLock).toContain('invoicy_configs');
      expect(segundoLock).toContain('invoicy_environment_configs');
    });
  });

  describe('reserveNfseRpsNumber', () => {
    it('usa a linha ambiental e preserva a série alfanumérica', async () => {
      tx.$queryRaw
        .mockResolvedValueOnce([
          { id: CONFIG_ID, proximoRpsNfse: 500, serieNfse: 'ZZ' },
        ])
        .mockResolvedValueOnce([
          { id: 'env-1', nfseNextNumber: 12, nfseSeries: 'B2' },
        ]);

      const result = await service.reserveNfseRpsNumber(
        tx,
        CONFIG_ID,
        FiscalEnvironment.PRODUCAO,
      );

      expect(result).toEqual({ reservedNumber: 12, series: 'B2' });
    });

    it('cai no legado e usa A1 como série padrão', async () => {
      tx.$queryRaw
        .mockResolvedValueOnce([
          { id: CONFIG_ID, proximoRpsNfse: null, serieNfse: null },
        ])
        .mockResolvedValueOnce([]);

      const result = await service.reserveNfseRpsNumber(
        tx,
        CONFIG_ID,
        FiscalEnvironment.HOMOLOGACAO,
      );

      expect(result).toEqual({ reservedNumber: 1, series: 'A1' });
      expect(tx.invoicyEnvironmentConfig.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          docType: 'NFSE',
          nfseNextNumber: 2,
          nfseSeries: 'A1',
        }),
      });
    });

    it('lança quando o emissor não existe', async () => {
      tx.$queryRaw.mockResolvedValueOnce([]);

      await expect(
        service.reserveNfseRpsNumber(
          tx,
          CONFIG_ID,
          FiscalEnvironment.HOMOLOGACAO,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
