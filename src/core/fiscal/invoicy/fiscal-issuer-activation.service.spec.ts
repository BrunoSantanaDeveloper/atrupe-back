import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { FiscalActivationStatus, FiscalEnvironment } from '@prisma/client';
import { FiscalIssuerActivationService } from './fiscal-issuer-activation.service';
import { PrismaService } from '../../../config/prisma/prisma.service';
import { FiscalRolloutPolicyService } from '../shared/fiscal-rollout-policy.service';
import { FiscalAuditService } from '../shared/fiscal-audit.service';
import { FiscalIssuerReadinessService } from './fiscal-issuer-readiness.service';
import { InvoicyCompanyRegistrationService } from './invoicy-company-registration.service';

describe('FiscalIssuerActivationService — gates', () => {
  let service: FiscalIssuerActivationService;

  const prisma = {
    invoicyConfig: { findUnique: jest.fn() },
  };
  const rolloutPolicy = {
    isRolloutActivationEnabled: jest.fn(),
    isProductionActivationEnabled: jest.fn(),
  };
  const auditService = { commitWithOutcome: jest.fn() };
  const readinessService = {
    checkLocalReadiness: jest.fn(),
    checkFullReadiness: jest.fn(),
  };
  const registrationService = { ensureRegistered: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FiscalIssuerActivationService,
        { provide: PrismaService, useValue: prisma },
        { provide: FiscalRolloutPolicyService, useValue: rolloutPolicy },
        { provide: FiscalAuditService, useValue: auditService },
        { provide: FiscalIssuerReadinessService, useValue: readinessService },
        {
          provide: InvoicyCompanyRegistrationService,
          useValue: registrationService,
        },
      ],
    }).compile();

    service = module.get(FiscalIssuerActivationService);
  });

  afterEach(() => jest.clearAllMocks());

  it('lança NotFound quando o emissor não pertence à empresa', async () => {
    prisma.invoicyConfig.findUnique.mockResolvedValue({
      id: 'e1',
      companyId: 'outra',
    });

    await expect(
      service.activate('company-1', 'e1', FiscalEnvironment.HOMOLOGACAO),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lança Forbidden quando o rollout de ativação está desabilitado', async () => {
    prisma.invoicyConfig.findUnique.mockResolvedValue({
      id: 'e1',
      companyId: 'company-1',
    });
    rolloutPolicy.isRolloutActivationEnabled.mockResolvedValue(false);

    await expect(
      service.activate('company-1', 'e1', FiscalEnvironment.HOMOLOGACAO),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lança Forbidden ao ativar PRODUCAO com a flag de produção desabilitada', async () => {
    prisma.invoicyConfig.findUnique.mockResolvedValue({
      id: 'e1',
      companyId: 'company-1',
    });
    rolloutPolicy.isRolloutActivationEnabled.mockResolvedValue(true);
    rolloutPolicy.isProductionActivationEnabled.mockReturnValue(false);

    await expect(
      service.activate('company-1', 'e1', FiscalEnvironment.PRODUCAO, {
        confirmFiscalValidity: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lança BadRequest ao ativar PRODUCAO sem confirmFiscalValidity', async () => {
    prisma.invoicyConfig.findUnique.mockResolvedValue({
      id: 'e1',
      companyId: 'company-1',
    });
    rolloutPolicy.isRolloutActivationEnabled.mockResolvedValue(true);
    rolloutPolicy.isProductionActivationEnabled.mockReturnValue(true);

    await expect(
      service.activate('company-1', 'e1', FiscalEnvironment.PRODUCAO, {
        confirmFiscalValidity: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('FiscalIssuerActivationService — lease / concorrência', () => {
  let service: FiscalIssuerActivationService;

  // tx mock cujo $queryRaw despacha pela query (independente da ordem de chamada).
  function makeTx(opts: {
    lockedRunning?: { id: string; expired: boolean }[];
    existing?: any;
    executeRawResult?: number;
  }) {
    const lockedRunning = opts.lockedRunning ?? [];
    return {
      $queryRaw: jest.fn((strings: TemplateStringsArray) => {
        const sql = Array.from(strings).join(' ');
        if (sql.includes('SELECT NOW()')) {
          return Promise.resolve([{ now: new Date() }]);
        }
        if (sql.includes('invoicy_configs')) {
          return Promise.resolve([{ id: 'e1' }]);
        }
        if (sql.includes('fiscal_activation_attempts')) {
          return Promise.resolve(lockedRunning);
        }
        return Promise.resolve([]);
      }),
      $executeRaw: jest.fn().mockResolvedValue(opts.executeRawResult ?? 1),
      fiscalActivationAttempt: {
        findUnique: jest.fn().mockResolvedValue(opts.existing ?? null),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
      },
      invoicyEnvironmentConfig: {
        upsert: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      invoicyConfig: { update: jest.fn().mockResolvedValue({}) },
    };
  }

  const prisma = {
    invoicyConfig: { findUnique: jest.fn() },
    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
  };
  const rolloutPolicy = {
    isRolloutActivationEnabled: jest.fn(),
    isProductionActivationEnabled: jest.fn(),
  };
  const auditService = { commitWithOutcome: jest.fn() };
  const readinessService = {
    checkLocalReadiness: jest.fn(),
    checkFullReadiness: jest.fn(),
  };
  const registrationService = { ensureRegistered: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FiscalIssuerActivationService,
        { provide: PrismaService, useValue: prisma },
        { provide: FiscalRolloutPolicyService, useValue: rolloutPolicy },
        { provide: FiscalAuditService, useValue: auditService },
        { provide: FiscalIssuerReadinessService, useValue: readinessService },
        {
          provide: InvoicyCompanyRegistrationService,
          useValue: registrationService,
        },
      ],
    }).compile();

    service = module.get(FiscalIssuerActivationService);
  });

  afterEach(() => jest.clearAllMocks());

  it('acquireLease rejeita com Conflict quando há lease vigente (RUNNING não expirado)', async () => {
    const tx = makeTx({ lockedRunning: [{ id: 'a1', expired: false }] });
    prisma.$transaction.mockImplementation((cb: any) => cb(tx));

    await expect(
      (service as any).acquireLease('e1', FiscalEnvironment.HOMOLOGACAO, null),
    ).rejects.toBeInstanceOf(ConflictException);

    // Não deve ter tentado limpar nem criar nova tentativa.
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.fiscalActivationAttempt.create).not.toHaveBeenCalled();
  });

  it('acquireLease faz takeover de lease expirado (marca FAILED e cria nova tentativa)', async () => {
    const tx = makeTx({ lockedRunning: [{ id: 'a1', expired: true }] });
    prisma.$transaction.mockImplementation((cb: any) => cb(tx));

    const result = await (service as any).acquireLease(
      'e1',
      FiscalEnvironment.HOMOLOGACAO,
      null,
    );

    // Limpeza das RUNNING expiradas (FAILED) deve ter ocorrido.
    expect(tx.$executeRaw).toHaveBeenCalled();
    // Nova tentativa criada e ambiente marcado VALIDATING.
    expect(tx.fiscalActivationAttempt.create).toHaveBeenCalled();
    expect(tx.invoicyEnvironmentConfig.upsert).toHaveBeenCalled();
    expect(result.replayed).toBe(false);
  });

  it('acquireLease faz replay quando idempotencyKey existente já SUCCEEDED', async () => {
    const tx = makeTx({
      existing: {
        id: 'row1',
        attemptId: 'prev-attempt',
        status: FiscalActivationStatus.SUCCEEDED,
        resultSnapshot: { environment: 'HOMOLOGACAO' },
      },
    });
    prisma.$transaction.mockImplementation((cb: any) => cb(tx));

    const result = await (service as any).acquireLease(
      'e1',
      FiscalEnvironment.HOMOLOGACAO,
      'idem-1',
    );

    expect(result.replayed).toBe(true);
    expect(result.attemptId).toBe('prev-attempt');
    expect(result.resultSnapshot).toEqual({ environment: 'HOMOLOGACAO' });
    // Não cria nova linha em replay.
    expect(tx.fiscalActivationAttempt.create).not.toHaveBeenCalled();
  });

  it('acquireLease reaproveita linha FAILED no retry com mesma idempotencyKey', async () => {
    const tx = makeTx({
      existing: {
        id: 'row1',
        attemptId: 'old-attempt',
        status: FiscalActivationStatus.FAILED,
      },
    });
    prisma.$transaction.mockImplementation((cb: any) => cb(tx));

    const result = await (service as any).acquireLease(
      'e1',
      FiscalEnvironment.HOMOLOGACAO,
      'idem-1',
    );

    expect(result.replayed).toBe(false);
    // Reaproveita a linha (update para RUNNING) em vez de criar nova → sem unique violation.
    expect(tx.fiscalActivationAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'row1' },
        data: expect.objectContaining({
          status: FiscalActivationStatus.RUNNING,
        }),
      }),
    );
    expect(tx.fiscalActivationAttempt.create).not.toHaveBeenCalled();
  });

  it('renewLease retorna true quando atualiza linha e false quando lease já não é RUNNING', async () => {
    prisma.$executeRaw.mockResolvedValueOnce(1);
    await expect((service as any).renewLease('att-1')).resolves.toBe(true);

    prisma.$executeRaw.mockResolvedValueOnce(0);
    await expect((service as any).renewLease('att-1')).resolves.toBe(false);
  });

  it('commitSuccess lança Conflict LEASE_LOST quando o CAS não casa (lease perdido)', async () => {
    prisma.invoicyConfig.findUnique.mockResolvedValue({ name: 'Emissor X' });
    const tx = makeTx({ executeRawResult: 0 });
    // commitWithOutcome executa o callback transacional com o tx mock.
    auditService.commitWithOutcome.mockImplementation((_meta: any, cb: any) =>
      cb(tx),
    );

    await expect(
      (service as any).commitSuccess(
        'company-1',
        'e1',
        FiscalEnvironment.HOMOLOGACAO,
        'att-1',
        { environment: 'HOMOLOGACAO' },
        'user-1',
        'Fulano',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    // CAS falhou → não deve atualizar o ambiente nem o emissor.
    expect(tx.invoicyEnvironmentConfig.update).not.toHaveBeenCalled();
    expect(tx.invoicyConfig.update).not.toHaveBeenCalled();
  });
});

/**
 * O Invoicy monta o QR Code com o CSC do cadastro dele, não com o salvo no
 * emissor. Até 23/10/2026 a ativação da NFC-e terminava "ativa" com o CSC só no
 * nosso banco; agora ela o envia logo depois de garantir o cadastro.
 */
describe('FiscalIssuerActivationService — CSC da NFC-e no provedor', () => {
  let service: FiscalIssuerActivationService;

  const prisma = { invoicyConfig: { findUnique: jest.fn() } };
  const rolloutPolicy = {
    isRolloutActivationEnabled: jest.fn(),
    isProductionActivationEnabled: jest.fn(),
  };
  const auditService = { commitWithOutcome: jest.fn() };
  const readinessService = {
    checkLocalReadiness: jest.fn(),
    checkFullReadiness: jest.fn(),
  };
  const registrationService = {
    ensureRegistered: jest.fn(),
    ensureNfceModule: jest.fn(),
    syncNfceCsc: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FiscalIssuerActivationService,
        { provide: PrismaService, useValue: prisma },
        { provide: FiscalRolloutPolicyService, useValue: rolloutPolicy },
        { provide: FiscalAuditService, useValue: auditService },
        { provide: FiscalIssuerReadinessService, useValue: readinessService },
        {
          provide: InvoicyCompanyRegistrationService,
          useValue: registrationService,
        },
      ],
    }).compile();

    service = module.get(FiscalIssuerActivationService);

    prisma.invoicyConfig.findUnique.mockResolvedValue({
      id: 'e1',
      companyId: 'company-1',
    });
    rolloutPolicy.isRolloutActivationEnabled.mockResolvedValue(true);
    readinessService.checkLocalReadiness.mockResolvedValue({
      localReady: true,
      checks: [],
    });
    readinessService.checkFullReadiness.mockResolvedValue({
      ready: true,
      checks: [],
    });
    registrationService.ensureRegistered.mockResolvedValue(undefined);
    registrationService.ensureNfceModule.mockResolvedValue({
      solicitado: false,
    });
    registrationService.syncNfceCsc.mockResolvedValue({ alterado: true });

    // Lease e commits têm testes próprios acima; aqui só o fluxo importa.
    jest
      .spyOn(service as any, 'acquireLease')
      .mockResolvedValue({ attemptId: 'att-1', replayed: false });
    jest.spyOn(service as any, 'renewLease').mockResolvedValue(true);
    jest.spyOn(service as any, 'commitSuccess').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'commitFailure').mockResolvedValue(undefined);
  });

  afterEach(() => jest.clearAllMocks());

  it('NFC-e: envia o CSC depois de garantir o cadastro e antes do readiness do provedor', async () => {
    await expect(
      service.activate('company-1', 'e1', FiscalEnvironment.HOMOLOGACAO, {
        docType: 'NFCE',
      }),
    ).resolves.toEqual({ success: true });

    expect(registrationService.syncNfceCsc).toHaveBeenCalledWith(
      'company-1',
      'e1',
      FiscalEnvironment.HOMOLOGACAO,
      expect.anything(),
    );
    const [registro] =
      registrationService.ensureRegistered.mock.invocationCallOrder;
    const [csc] = registrationService.syncNfceCsc.mock.invocationCallOrder;
    const [provedor] =
      readinessService.checkFullReadiness.mock.invocationCallOrder;
    expect(registro).toBeLessThan(csc);
    expect(csc).toBeLessThan(provedor);
  });

  it('NF-e não tem CSC: não chama o envio', async () => {
    await service.activate('company-1', 'e1', FiscalEnvironment.HOMOLOGACAO, {
      docType: 'NFE',
    });

    expect(registrationService.syncNfceCsc).not.toHaveBeenCalled();
    expect(registrationService.ensureNfceModule).not.toHaveBeenCalled();
  });

  // Terabyte, 06/11/2026: a empresa nasceu no Invoicy sem o módulo NFC-e, e a
  // ativação só passou depois de o módulo ser ligado à mão no painel.
  it('NFC-e: garante o módulo no provedor depois do cadastro e antes do CSC', async () => {
    rolloutPolicy.isProductionActivationEnabled.mockReturnValue(true);

    await expect(
      service.activate('company-1', 'e1', FiscalEnvironment.PRODUCAO, {
        docType: 'NFCE',
        confirmFiscalValidity: true,
      }),
    ).resolves.toEqual({ success: true });

    expect(registrationService.ensureNfceModule).toHaveBeenCalledWith(
      'company-1',
      'e1',
      FiscalEnvironment.PRODUCAO,
      expect.anything(),
    );
    const [registro] =
      registrationService.ensureRegistered.mock.invocationCallOrder;
    const [modulo] =
      registrationService.ensureNfceModule.mock.invocationCallOrder;
    const [csc] = registrationService.syncNfceCsc.mock.invocationCallOrder;
    expect(registro).toBeLessThan(modulo);
    expect(modulo).toBeLessThan(csc);
  });

  it('módulo NFC-e que não liga barra a ativação com motivo próprio, sem enviar o CSC', async () => {
    registrationService.ensureNfceModule.mockRejectedValue(
      new Error(
        'o Invoicy recusou o pedido do módulo NFC-e (Código 101: Módulo inválido)',
      ),
    );

    const erro = await service
      .activate('company-1', 'e1', FiscalEnvironment.HOMOLOGACAO, {
        docType: 'NFCE',
      })
      .catch((e) => e);

    expect(erro).toBeInstanceOf(UnprocessableEntityException);
    expect(erro.getResponse()).toEqual({
      errorCode: 'PROVIDER_NFCE_MODULE_INACTIVE',
      message: expect.stringContaining('Código 101: Módulo inválido'),
    });
    expect(erro.getResponse().message).toContain('suporte da Atrupe');
    expect(registrationService.syncNfceCsc).not.toHaveBeenCalled();
    expect(readinessService.checkFullReadiness).not.toHaveBeenCalled();
    expect((service as any).commitFailure).toHaveBeenCalledWith(
      'company-1',
      'e1',
      FiscalEnvironment.HOMOLOGACAO,
      'NFCE',
      'att-1',
      'PROVIDER_NFCE_MODULE_INACTIVE',
      'sistema',
    );
  });

  it('falha no envio do CSC barra a ativação com motivo próprio', async () => {
    registrationService.syncNfceCsc.mockRejectedValue(
      new Error('O ID do CSC tem até 6 dígitos'),
    );

    const erro = await service
      .activate('company-1', 'e1', FiscalEnvironment.HOMOLOGACAO, {
        docType: 'NFCE',
      })
      .catch((e) => e);

    expect(erro).toBeInstanceOf(UnprocessableEntityException);
    expect(erro.getResponse()).toEqual({
      errorCode: 'PROVIDER_CSC_SYNC_FAILED',
      message: expect.stringContaining('O ID do CSC tem até 6 dígitos'),
    });
    expect(readinessService.checkFullReadiness).not.toHaveBeenCalled();
    expect((service as any).commitFailure).toHaveBeenCalledWith(
      'company-1',
      'e1',
      FiscalEnvironment.HOMOLOGACAO,
      'NFCE',
      'att-1',
      'PROVIDER_CSC_SYNC_FAILED',
      'sistema',
    );
  });
});

// ---------------------------------------------------------------------------
// Testes de integração com concorrência real no PostgreSQL.
//
// Estes testes requerem um banco PostgreSQL real (docker-compose de testes ou
// instância de CI). Defina TEST_DATABASE_URL para habilitá-los.
// Comando: TEST_DATABASE_URL=postgresql://... npx jest fiscal-issuer-activation
//
// O que cobrem:
//   1. takeover vs. heartbeat: duas conexões concorrentes — uma renova o lease
//      (heartbeat) enquanto a outra tenta fazer takeover; a ordem de locks
//      (emissor → attempt) deve serializar sem deadlock.
//   2. Two activations simultaneously: ambas chegam ao acquireLease ao mesmo tempo;
//      apenas uma deve obter RUNNING, a outra recebe 409 ACTIVATION_IN_PROGRESS.
//   3. Clock drift: criation com NOW() e renewLease com NOW()+interval convergem
//      com CAS "leaseExpiresAt > NOW()" mesmo quando app clock drifta.
// ---------------------------------------------------------------------------
describe.skip('FiscalIssuerActivationService — integração concorrente (requer TEST_DATABASE_URL)', () => {
  it.todo('takeover e heartbeat concorrentes devem serializar sem deadlock');
  it.todo(
    'duas ativações simultâneas: apenas uma deve produzir status RUNNING',
  );
  it.todo(
    'CAS commitSuccess falha corretamente quando lease expirou por clock drift',
  );
});
