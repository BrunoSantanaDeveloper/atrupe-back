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
    invoicyEnvironmentConfig: {
      upsert: jest.fn(),
    },
    // update() abre transação para gravar as colunas legadas e as linhas
    // ambientais de numeração de uma vez.
    $transaction: jest.fn((callback: any) => callback(mockPrisma)),
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
    // Usado por mapDbToResponse/syncEnvironmentNumbering para saber de qual
    // ambiente sai a numeração efetiva de cada docType.
    resolveEnvironmentFromConfig: jest.fn().mockReturnValue('HOMOLOGACAO'),
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

  /**
   * A numeração vive em invoicy_environment_configs por (emissor, ambiente,
   * docType) desde a Fase 3, e é de lá que a reserva atômica tira o número.
   * Enquanto o PATCH gravava só a coluna legada global, o próximo número
   * digitado na tela de Emissor não tinha efeito nenhum na emissão.
   */
  describe('update — numeração por ambiente', () => {
    const configExistente = {
      id: 'config-1',
      companyId: 'company-1',
      name: 'Matriz',
      activeEnvironmentNfe: 'PRODUCAO',
    };

    const upsertDocTypes = () =>
      mockPrisma.invoicyEnvironmentConfig.upsert.mock.calls.map(
        (call: any) =>
          call[0].where.invoicyConfigId_environment_docType.docType,
      );

    beforeEach(() => {
      mockPrisma.invoicyConfig.findUnique.mockResolvedValue(configExistente);
      mockPrisma.invoicyConfig.update.mockResolvedValue(configExistente);
    });

    it('grava o próximo número na linha do ambiente ativo, não só na coluna legada', async () => {
      mockCredentialResolver.resolveEnvironmentFromConfig.mockReturnValue(
        'PRODUCAO',
      );

      await service.update('config-1', { proximoNumeroNfe: 703 } as any);

      expect(mockPrisma.invoicyEnvironmentConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            invoicyConfigId_environment_docType: {
              invoicyConfigId: 'config-1',
              environment: 'PRODUCAO',
              docType: 'NFE',
            },
          },
          update: { nfeNextNumber: 703 },
        }),
      );
    });

    it('respeita o ambiente explicitamente informado no DTO', async () => {
      mockCredentialResolver.resolveEnvironmentFromConfig.mockReturnValue(
        'PRODUCAO',
      );

      await service.update('config-1', {
        proximoNumeroNfe: 12,
        serieNfe: 2,
        nfeNumberingEnvironment: 'HOMOLOGACAO',
      } as any);

      expect(mockPrisma.invoicyEnvironmentConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            invoicyConfigId_environment_docType: {
              invoicyConfigId: 'config-1',
              environment: 'HOMOLOGACAO',
              docType: 'NFE',
            },
          },
          update: { nfeSeries: 2, nfeNextNumber: 12 },
        }),
      );
    });

    it('não mexe na numeração dos outros documentos num PATCH parcial', async () => {
      await service.update('config-1', { proximoNumeroNfe: 703 } as any);

      expect(upsertDocTypes()).toEqual(['NFE']);
    });

    it('não faz upsert nenhum quando o PATCH não traz numeração', async () => {
      await service.update('config-1', { name: 'Matriz SP' } as any);

      expect(mockPrisma.invoicyEnvironmentConfig.upsert).not.toHaveBeenCalled();
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

  /**
   * mapDbToResponse e' uma allowlist explicita: campo que nao esta la' chega
   * como `undefined` nos servicos fiscais. Os campos da Reforma ficaram de
   * fora e o grupo de IBS/CBS nunca era enviado, por mais que a coluna
   * estivesse ligada no banco.
   */
  describe('campos da Reforma Tributaria na allowlist', () => {
    const configComReforma = {
      id: 'config-1',
      companyId: 'company-1',
      name: 'Matriz',
      isDefault: true,
      environmentConfigs: [],
      ibsCbsEnviarValores: true,
      reformaTributariaAtiva: true,
      regApIbsCbsSn: 2,
      aliquotaIbsUf: 0.05,
      aliquotaIbsMun: 0.02,
      aliquotaCbs: 0.8,
      company: {
        id: 'company-1',
        cnpj: '11222333000181',
        address: [],
        DigitalCertificate: null,
        environmentCredentials: [],
      },
    };

    it('devolve os campos da Reforma para os servicos fiscais', async () => {
      mockPrisma.invoicyConfig.findFirst.mockResolvedValue(configComReforma);

      const config: any = await service.getConfig('company-1');

      expect(config.reformaTributariaAtiva).toBe(true);
      expect(config.ibsCbsEnviarValores).toBe(true);
      expect(config.regApIbsCbsSn).toBe(2);
      expect(config.aliquotaIbsUf).toBe(0.05);
      expect(config.aliquotaIbsMun).toBe(0.02);
      expect(config.aliquotaCbs).toBe(0.8);
    });

    /** Emissor sem a Reforma nao pode chegar com `undefined` ao calculo. */
    it('devolve os flags desligados quando o emissor nao tem os campos', async () => {
      mockPrisma.invoicyConfig.findFirst.mockResolvedValue({
        ...configComReforma,
        ibsCbsEnviarValores: null,
        reformaTributariaAtiva: null,
        aliquotaIbsUf: null,
      });

      const config: any = await service.getConfig('company-1');

      expect(config.reformaTributariaAtiva).toBe(false);
      expect(config.ibsCbsEnviarValores).toBe(false);
      expect(config.aliquotaIbsUf).toBeNull();
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
