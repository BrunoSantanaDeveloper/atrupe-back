import { Test, TestingModule } from '@nestjs/testing';
import { InvoicyService } from './invoicy.service';
import { PrismaService } from 'nestjs-prisma';
import { ConfigService } from '@nestjs/config';
import { InvoicyHttpService } from './invoicy-http.service';
import { EncryptionService } from '../../../shared/services/encryption.service';
import { FiscalRolloutPolicyService } from '../shared/fiscal-rollout-policy.service';
import { FiscalAuditService } from '../shared/fiscal-audit.service';
import { FiscalCredentialResolverService } from '../shared/fiscal-credential-resolver.service';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { FiscalEnvironment } from '@prisma/client';

describe('InvoicyService', () => {
  let service: InvoicyService;

  const mockPrisma = {
    invoicyConfig: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
    },
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockInvoicyHttpService = {
    validateRawAccessKey: jest.fn(),
    clearTokenCache: jest.fn(),
  };
  const mockEncryptionService = { encrypt: jest.fn() };
  const mockRolloutPolicy = {
    shouldWriteToLegacy: jest.fn().mockReturnValue(false),
    isRolloutActivationEnabled: jest.fn().mockResolvedValue(true),
    isEnvironmentSwitchLocked: jest.fn().mockResolvedValue(false),
  };
  const mockAuditService = {
    runAuditedAction: jest.fn(),
    commitWithOutcome: jest.fn(),
    recordFailedAction: jest.fn(),
  };
  const mockCredentialResolver = {
    resolveOperationalEnvironment: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoicyService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: InvoicyHttpService, useValue: mockInvoicyHttpService },
        { provide: EncryptionService, useValue: mockEncryptionService },
        { provide: FiscalRolloutPolicyService, useValue: mockRolloutPolicy },
        { provide: FiscalAuditService, useValue: mockAuditService },
        {
          provide: FiscalCredentialResolverService,
          useValue: mockCredentialResolver,
        },
      ],
    }).compile();

    service = module.get<InvoicyService>(InvoicyService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create config', () => {
    it('should throw ConflictException if name exists', async () => {
      mockPrisma.invoicyConfig.findFirst.mockResolvedValue({ id: 'config-1' });
      await expect(
        service.create('company-1', { name: 'Matriz' } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('should create default configs with default values', async () => {
      mockPrisma.invoicyConfig.findFirst.mockResolvedValue(null);
      mockPrisma.invoicyConfig.count.mockResolvedValue(0);
      mockPrisma.invoicyConfig.create.mockResolvedValue({
        id: 'config-1',
        isDefault: true,
        environment: 'HOMOLOGACAO',
        ambiente: 2,
        serieNfe: 1,
        proximoNumeroNfe: 1,
      });

      const result = await service.create('company-1', {
        name: 'Matriz',
        ambiente: 2,
        environment: 'HOMOLOGACAO',
      } as any);

      expect(mockPrisma.invoicyConfig.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isDefault: true,
            ambiente: 2,
            environment: 'HOMOLOGACAO',
          }),
        }),
      );
      expect(result).toBeDefined();
    });

    it('should remove default from others if creating a new default', async () => {
      mockPrisma.invoicyConfig.findFirst.mockResolvedValue(null);
      mockPrisma.invoicyConfig.count.mockResolvedValue(1); // not first
      mockPrisma.invoicyConfig.updateMany.mockResolvedValue({});
      mockPrisma.invoicyConfig.create.mockResolvedValue({
        id: 'config-2',
        isDefault: true,
      });

      await service.create('company-1', {
        name: 'Filial',
        isDefault: true,
      } as any);

      expect(mockPrisma.invoicyConfig.updateMany).toHaveBeenCalledWith({
        where: { companyId: 'company-1', isDefault: true },
        data: { isDefault: false },
      });
    });
  });

  describe('increment numbers', () => {
    it('should increment nfe number and return the previous value', async () => {
      mockPrisma.invoicyConfig.update.mockResolvedValue({
        proximoNumeroNfe: 11,
      }); // Value after increment

      const result = await service.incrementNfeNumber('config-1');

      expect(mockPrisma.invoicyConfig.update).toHaveBeenCalledWith({
        where: { id: 'config-1' },
        data: { proximoNumeroNfe: { increment: 1 } },
        select: { proximoNumeroNfe: true },
      });
      expect(result).toBe(10); // 11 - 1
    });

    it('should throw NotFoundException if incrementing nfe number of non-existent config', async () => {
      mockPrisma.invoicyConfig.update.mockResolvedValue(null);
      await expect(service.incrementNfeNumber('config-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should increment nfce number and return the previous value', async () => {
      mockPrisma.invoicyConfig.update.mockResolvedValue({
        proximoNumeroNfce: 5,
      });

      const result = await service.incrementNfceNumber('config-1');

      expect(mockPrisma.invoicyConfig.update).toHaveBeenCalledWith({
        where: { id: 'config-1' },
        data: { proximoNumeroNfce: { increment: 1 } },
        select: { proximoNumeroNfce: true },
      });
      expect(result).toBe(4); // 5 - 1
    });
  });

  describe('setAccessKey', () => {
    it('audita a rejeição sem abrir a transação de persistência', async () => {
      mockPrisma.invoicyConfig.findUnique.mockResolvedValue({
        id: 'config-1',
        companyId: 'company-1',
        name: 'Matriz',
        company: { cnpj: '11222333000181' },
      });
      mockInvoicyHttpService.validateRawAccessKey.mockResolvedValue(false);
      mockAuditService.recordFailedAction.mockResolvedValue(undefined);

      await expect(
        service.setAccessKey(
          'config-1',
          FiscalEnvironment.HOMOLOGACAO,
          'invalid-key',
          'user-1',
          'Usuário',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mockAuditService.recordFailedAction).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: 'company-1',
          invoicyConfigId: 'config-1',
          action: 'CREDENTIALS_ROTATE',
        }),
        expect.any(BadRequestException),
      );
      expect(mockAuditService.runAuditedAction).not.toHaveBeenCalled();
    });
  });

  describe('setNfceNumbering', () => {
    it('rejeita série/número inválidos antes de qualquer persistência', async () => {
      await expect(
        service.setNfceNumbering(
          'config-1',
          FiscalEnvironment.PRODUCAO,
          0,
          1,
          'user-1',
          'Usuário',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrisma.invoicyConfig.findUnique).not.toHaveBeenCalled();
      expect(mockAuditService.runAuditedAction).not.toHaveBeenCalled();
    });

    it('lança NotFound quando o emissor não existe', async () => {
      mockPrisma.invoicyConfig.findUnique.mockResolvedValue(null);
      await expect(
        service.setNfceNumbering(
          'config-x',
          FiscalEnvironment.PRODUCAO,
          1,
          10,
          'user-1',
          'Usuário',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('persiste numeração ambiental com ação auditada ENVIRONMENT_CONFIG_CREATE', async () => {
      mockPrisma.invoicyConfig.findUnique.mockResolvedValue({
        id: 'config-1',
        companyId: 'company-1',
        name: 'Matriz',
      });
      mockCredentialResolver.resolveOperationalEnvironment.mockResolvedValue(
        FiscalEnvironment.HOMOLOGACAO,
      );
      const tx = {
        invoicyEnvironmentConfig: { upsert: jest.fn().mockResolvedValue({}) },
        invoicyConfig: { update: jest.fn() },
      };
      mockAuditService.runAuditedAction.mockImplementation(
        (_meta: any, cb: any) => cb(tx),
      );

      const result = await service.setNfceNumbering(
        'config-1',
        FiscalEnvironment.PRODUCAO,
        2,
        55,
        'user-1',
        'Usuário',
      );

      expect(result).toEqual({ success: true });
      expect(mockAuditService.runAuditedAction).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: 'company-1',
          invoicyConfigId: 'config-1',
          action: 'ENVIRONMENT_CONFIG_CREATE',
          environment: FiscalEnvironment.PRODUCAO,
        }),
        expect.any(Function),
      );
      expect(tx.invoicyEnvironmentConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            invoicyConfigId_environment_docType: {
              invoicyConfigId: 'config-1',
              environment: FiscalEnvironment.PRODUCAO,
              docType: 'NFCE',
            },
          },
          update: { nfceSeries: 2, nfceNextNumber: 55 },
        }),
      );
    });
  });

  describe('providerConfigured (credencial cifrada)', () => {
    it('na listagem nao bloqueia a primeira ativacao quando o rollout esta habilitado', async () => {
      mockRolloutPolicy.isRolloutActivationEnabled.mockResolvedValue(true);
      mockPrisma.invoicyConfig.findMany.mockResolvedValue([
        {
          id: 'config-1',
          companyId: 'company-1',
          name: 'Matriz',
          activeEnvironment: null,
          environmentConfigs: [
            {
              environment: FiscalEnvironment.HOMOLOGACAO,
              status: 'DRAFT',
              cscTokenEncrypted: null,
            },
          ],
          company: {
            id: 'company-1',
            cnpj: '11222333000181',
            accessKey: null,
            address: [],
            DigitalCertificate: null,
            environmentCredentials: [],
          },
        },
      ]);

      const [mapped]: any = await service.getAllByCompany('company-1');

      expect(mapped.activeEnvironment).toBeNull();
      expect(mapped.environmentSwitchLocked).toBe(false);
    });

    it('marca providerConfigured=true quando há credencial ambiental cifrada, mesmo sem accessKey legado', async () => {
      mockPrisma.invoicyConfig.findUnique.mockResolvedValue({
        id: 'config-1',
        companyId: 'company-1',
        name: 'Matriz',
        environmentConfigs: [],
        company: {
          id: 'company-1',
          cnpj: '11222333000181',
          accessKey: null,
          environmentCredentials: [
            {
              environment: FiscalEnvironment.PRODUCAO,
              providerAccessKeyEncrypted: 'enc::abc',
            },
          ],
        },
      });

      const mapped: any = await service.getById('config-1');
      expect(mapped.company.providerConfigured).toBe(true);
    });

    it('marca providerConfigured=false quando não há accessKey nem credencial cifrada', async () => {
      mockPrisma.invoicyConfig.findUnique.mockResolvedValue({
        id: 'config-1',
        companyId: 'company-1',
        name: 'Matriz',
        environmentConfigs: [],
        company: {
          id: 'company-1',
          cnpj: '11222333000181',
          accessKey: null,
          environmentCredentials: [
            {
              environment: FiscalEnvironment.PRODUCAO,
              providerAccessKeyEncrypted: null,
            },
          ],
        },
      });

      const mapped: any = await service.getById('config-1');
      expect(mapped.company.providerConfigured).toBe(false);
    });

    it('marca cscConfigured=true quando há CSC cifrado em configuração ambiental', async () => {
      mockPrisma.invoicyConfig.findUnique.mockResolvedValue({
        id: 'config-1',
        companyId: 'company-1',
        name: 'Matriz',
        cscToken: null,
        environmentConfigs: [
          {
            environment: FiscalEnvironment.PRODUCAO,
            status: 'DRAFT',
            cscTokenEncrypted: 'enc::csc',
          },
        ],
        company: {
          id: 'company-1',
          cnpj: '11222333000181',
          accessKey: null,
          environmentCredentials: [],
        },
      });

      const mapped: any = await service.getById('config-1');

      expect(mapped.cscConfigured).toBe(true);
      expect(mapped.environments[0].cscConfigured).toBe(true);
    });
  });
});
