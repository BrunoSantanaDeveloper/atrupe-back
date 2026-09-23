import { Test, TestingModule } from '@nestjs/testing';
import { FiscalOnboardingService } from './fiscal-onboarding.service';
import { PrismaService } from 'nestjs-prisma';
import {
  INVOICY_COMPANY_LINKED_TO_ANOTHER_PARTNER_MESSAGE,
  InvoicyHttpService,
} from '../invoicy/invoicy-http.service';
import { InvoicyService } from '../invoicy/invoicy.service';
import { EncryptionService } from '../../../shared/services/encryption.service';
import { FiscalRolloutPolicyService } from '../shared/fiscal-rollout-policy.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FiscalOnboardingDto } from './fiscal-onboarding.dto';
import { validatePfxCertificateCnpj } from '../utils/certificate-parser';

jest.mock('../utils/certificate-parser', () => ({
  validatePfxCertificateCnpj: jest.fn(),
}));

describe('FiscalOnboardingService', () => {
  let service: FiscalOnboardingService;
  const mockValidatePfxCertificateCnpj =
    validatePfxCertificateCnpj as jest.MockedFunction<
      typeof validatePfxCertificateCnpj
    >;

  const mockPrisma = {
    fiscalOnboardingRequest: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    company: {
      update: jest.fn(),
      // Sem transferência que trocou o CNPJ: nada é histórico.
      findUnique: jest.fn(),
    },
    invoicyConfig: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    companyEnvironmentCredential: {
      upsert: jest.fn().mockResolvedValue({ id: 'cred-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    address: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    cfopConfig: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([
        { id: 'cfop-5101', code: '5101' },
        { id: 'cfop-5102', code: '5102' },
        { id: 'cfop-6101', code: '6101' },
        { id: 'cfop-6102', code: '6102' },
      ]),
      create: jest.fn().mockResolvedValue({}),
    },
    operationNature: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    product: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    productFiscalData: {
      create: jest.fn().mockResolvedValue({}),
    },
    digitalCertificate: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn((callback) => callback(mockPrisma)),
  };

  const mockEncryptionService = {
    encrypt: jest.fn().mockReturnValue('encrypted-value'),
  };

  const mockFiscalRolloutPolicy = {
    shouldWriteToLegacy: jest.fn().mockReturnValue(true),
  };

  const mockInvoicyHttpService = {
    registerCompany: jest.fn(),
  };

  const mockInvoicyService = {};

  beforeEach(async () => {
    mockValidatePfxCertificateCnpj.mockReturnValue({
      valid: true,
      certificateCnpj: '12345678901234',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FiscalOnboardingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: InvoicyHttpService, useValue: mockInvoicyHttpService },
        { provide: InvoicyService, useValue: mockInvoicyService },
        { provide: EncryptionService, useValue: mockEncryptionService },
        {
          provide: FiscalRolloutPolicyService,
          useValue: mockFiscalRolloutPolicy,
        },
      ],
    }).compile();

    service = module.get<FiscalOnboardingService>(FiscalOnboardingService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('submitOnboarding', () => {
    const dto: FiscalOnboardingDto = {
      cnpj: '12345678901234',
      razaoSocial: 'Test Company',
      nomeFantasia: 'Test',
      ie: '123',
      im: '123',
      cnae: '123',
      uf: 'SP',
      codigoIbge: '123',
      cep: '12345678',
      logradouro: 'Rua',
      numero: '123',
      bairro: 'Centro',
      cidade: 'SP',
      certificate: 'base64',
      certificatePassword: 'pass',
      certificateType: 'A1',
    };

    it('should reject if already ACTIVE', async () => {
      mockPrisma.fiscalOnboardingRequest.findFirst.mockResolvedValue({
        status: 'ACTIVE',
      });
      await expect(service.submitOnboarding('company-1', dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject if already PROVISIONING', async () => {
      mockPrisma.fiscalOnboardingRequest.findFirst.mockResolvedValue({
        status: 'PROVISIONING',
      });
      await expect(service.submitOnboarding('company-1', dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should try autoProvision and return ACTIVE on success', async () => {
      mockPrisma.fiscalOnboardingRequest.findFirst.mockResolvedValue(null);
      mockPrisma.fiscalOnboardingRequest.create.mockResolvedValue({
        id: 'request-1',
        companyId: 'company-1',
        cnpj: dto.cnpj,
      });
      mockInvoicyHttpService.registerCompany.mockResolvedValue({
        accessKey: 'access-123',
        cryptoKey: 'crypto-123',
      });
      mockPrisma.invoicyConfig.findFirst.mockResolvedValue(null);

      const result = await service.submitOnboarding('company-1', dto);

      expect(result.status).toBe('ACTIVE');
      expect(mockInvoicyHttpService.registerCompany).toHaveBeenCalled();
      expect(mockPrisma.company.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'company-1' },
          data: expect.objectContaining({ accessKey: 'access-123' }),
        }),
      );
    });

    it('should fallback to PENDING_REVIEW if API fails', async () => {
      mockPrisma.fiscalOnboardingRequest.findFirst.mockResolvedValue(null);
      mockPrisma.fiscalOnboardingRequest.create.mockResolvedValue({
        id: 'request-1',
        companyId: 'company-1',
      });
      mockInvoicyHttpService.registerCompany.mockRejectedValue(
        new Error('API Error'),
      );

      const result = await service.submitOnboarding('company-1', dto);

      expect(result.status).toBe('PENDING_REVIEW');
      expect(mockPrisma.fiscalOnboardingRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PENDING_REVIEW' }),
        }),
      );
    });

    it('should explain when the company is linked to another Invoicy partner', async () => {
      mockPrisma.fiscalOnboardingRequest.findFirst.mockResolvedValue(null);
      mockPrisma.fiscalOnboardingRequest.create.mockResolvedValue({
        id: 'request-1',
        companyId: 'company-1',
      });
      mockInvoicyHttpService.registerCompany.mockRejectedValue(
        new Error(INVOICY_COMPANY_LINKED_TO_ANOTHER_PARTNER_MESSAGE),
      );

      const result = await service.submitOnboarding('company-1', dto);

      expect(result.status).toBe('PENDING_REVIEW');
      expect(result.message).toBe(
        INVOICY_COMPANY_LINKED_TO_ANOTHER_PARTNER_MESSAGE,
      );
      expect(mockPrisma.fiscalOnboardingRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'PENDING_REVIEW',
            errorMessage: INVOICY_COMPANY_LINKED_TO_ANOTHER_PARTNER_MESSAGE,
          }),
        }),
      );
    });
  });

  describe('adminApprove', () => {
    it('should throw NotFoundException if request not found', async () => {
      mockPrisma.fiscalOnboardingRequest.findUnique.mockResolvedValue(null);
      await expect(
        service.adminApprove('req-1', 'admin-1', 'key'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if not PENDING_REVIEW', async () => {
      mockPrisma.fiscalOnboardingRequest.findUnique.mockResolvedValue({
        status: 'ACTIVE',
      });
      await expect(
        service.adminApprove('req-1', 'admin-1', 'key'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should activate module and update request', async () => {
      mockPrisma.fiscalOnboardingRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        companyId: 'company-1',
        status: 'PENDING_REVIEW',
      });

      const result = await service.adminApprove('req-1', 'admin-1', 'key-123');

      expect(result.success).toBe(true);
      expect(mockPrisma.company.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'company-1' },
          data: expect.objectContaining({ accessKey: 'key-123' }),
        }),
      );
      expect(mockPrisma.fiscalOnboardingRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'req-1' },
          data: expect.objectContaining({ resolvedBy: 'admin-1' }),
        }),
      );
    });
  });

  describe('adminRetry', () => {
    it('should retry auto-provisioning and succeed', async () => {
      mockPrisma.fiscalOnboardingRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        companyId: 'company-1',
        cnpj: '123',
      });
      mockInvoicyHttpService.registerCompany.mockResolvedValue({
        accessKey: 'access-123',
      });

      const result = await service.adminRetry('req-1');

      expect(result.success).toBe(true);
      expect(mockInvoicyHttpService.registerCompany).toHaveBeenCalled();
    });

    it('should catch error on retry and mark for review', async () => {
      mockPrisma.fiscalOnboardingRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        companyId: 'company-1',
        cnpj: '123',
      });
      mockInvoicyHttpService.registerCompany.mockRejectedValue(
        new Error('Retry failed'),
      );

      await expect(service.adminRetry('req-1')).rejects.toThrow('Retry failed');
      expect(mockPrisma.fiscalOnboardingRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PENDING_REVIEW' }),
        }),
      );
    });
  });
});
