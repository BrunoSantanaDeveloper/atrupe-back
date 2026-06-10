import { Test, TestingModule } from '@nestjs/testing';
import { FiscalOnboardingService } from './fiscal-onboarding.service';
import { PrismaService } from 'nestjs-prisma';
import { InvoicyHttpService } from '../invoicy/invoicy-http.service';
import { InvoicyService } from '../invoicy/invoicy.service';
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
    },
    invoicyConfig: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    cfopConfig: {
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
      upsert: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn((callback) => callback(mockPrisma)),
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
      expect(mockPrisma.company.update).toHaveBeenCalledWith({
        where: { id: 'company-1' },
        data: { accessKey: 'access-123' },
      });
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
      expect(mockPrisma.company.update).toHaveBeenCalledWith({
        where: { id: 'company-1' },
        data: { accessKey: 'key-123' },
      });
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
