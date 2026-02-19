import { Test, TestingModule } from '@nestjs/testing';
import {
  UnauthorizedException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { CompanyManagementService } from './company-management.service';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { AsaasGatewayService } from './asaas-gateway.service';

jest.mock('argon2', () => ({
  verify: jest.fn(),
  hash: jest.fn(),
}));

import * as argon2 from 'argon2';

describe('CompanyManagementService', () => {
  let service: CompanyManagementService;

  const mockTx = {
    company: { update: jest.fn(), delete: jest.fn() },
    address: { update: jest.fn(), deleteMany: jest.fn() },
    user: { update: jest.fn(), delete: jest.fn(), deleteMany: jest.fn() },
    employee: { update: jest.fn(), deleteMany: jest.fn(), count: jest.fn() },
    customer: { update: jest.fn(), delete: jest.fn(), deleteMany: jest.fn() },
    subscription: {
      update: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
    },
    subscriptionHistory: { create: jest.fn(), deleteMany: jest.fn() },
    subscriptionFeature: { deleteMany: jest.fn() },
    companyHistory: { create: jest.fn(), deleteMany: jest.fn() },
    payment: { deleteMany: jest.fn() },
    nfce: { deleteMany: jest.fn() },
    nfse: { deleteMany: jest.fn() },
    nfe: { deleteMany: jest.fn() },
    invoicyConfig: { deleteMany: jest.fn() },
    cfopConfig: { deleteMany: jest.fn() },
    operationNature: { deleteMany: jest.fn() },
    digitalCertificate: { deleteMany: jest.fn() },
    productionStage: { deleteMany: jest.fn() },
    deliverySchedule: { deleteMany: jest.fn() },
    orderHistory: { deleteMany: jest.fn() },
    order: { deleteMany: jest.fn() },
    deliveryInfo: { deleteMany: jest.fn() },
    quotationHistory: { deleteMany: jest.fn() },
    quotationInstallment: { deleteMany: jest.fn() },
    quotationPayment: { deleteMany: jest.fn() },
    quotationProductItem: { deleteMany: jest.fn() },
    quotationProduct: { deleteMany: jest.fn() },
    quotation: { deleteMany: jest.fn() },
    transaction: { deleteMany: jest.fn() },
    receivableHistory: { deleteMany: jest.fn() },
    receivableInstallment: { deleteMany: jest.fn() },
    receivable: { deleteMany: jest.fn() },
    payableHistory: { deleteMany: jest.fn() },
    payableInstallment: { deleteMany: jest.fn() },
    commission: { deleteMany: jest.fn() },
    payable: { deleteMany: jest.fn() },
    bankAccountCashControl: { deleteMany: jest.fn() },
    cashRegister: { deleteMany: jest.fn() },
    clientPaymentCondition: { deleteMany: jest.fn() },
    supplierPaymentCondition: { deleteMany: jest.fn() },
    contact: { deleteMany: jest.fn() },
    client: { deleteMany: jest.fn() },
    supplier: { deleteMany: jest.fn() },
    productFiscalData: { deleteMany: jest.fn() },
    productItem: { deleteMany: jest.fn() },
    product: { deleteMany: jest.fn() },
    subCategory: { deleteMany: jest.fn() },
    nature: { deleteMany: jest.fn() },
    category: { deleteMany: jest.fn() },
    scheduledExpense: { deleteMany: jest.fn() },
    financialFlow: { deleteMany: jest.fn() },
    invoice: { deleteMany: jest.fn() },
    creditLimitPaymentCondition: { deleteMany: jest.fn() },
    creditLimitDefault: { deleteMany: jest.fn() },
    payrollItem: { deleteMany: jest.fn() },
    payroll: { deleteMany: jest.fn() },
    payrollSetup: { deleteMany: jest.fn() },
    payrollTemplate: { deleteMany: jest.fn() },
    employeeHistory: { deleteMany: jest.fn() },
    asset: { deleteMany: jest.fn() },
    assetType: { deleteMany: jest.fn() },
    installment: { deleteMany: jest.fn() },
    paymentCondition: { deleteMany: jest.fn() },
    bankAccount: { deleteMany: jest.fn() },
    saleSeries: { deleteMany: jest.fn() },
    quotationTag: { deleteMany: jest.fn() },
    sellerProfile: { deleteMany: jest.fn() },
    userRole: { deleteMany: jest.fn() },
    role: { deleteMany: jest.fn() },
    companySector: { deleteMany: jest.fn() },
    academyProgress: { deleteMany: jest.fn() },
    reasons: { deleteMany: jest.fn() },
    language: { deleteMany: jest.fn() },
    importLog: { deleteMany: jest.fn() },
    userActivity: { deleteMany: jest.fn() },
    userContract: { deleteMany: jest.fn() },
  };

  const mockPrismaService = {
    user: { findFirst: jest.fn(), findUnique: jest.fn() },
    company: { findUnique: jest.fn() },
    plan: { findFirst: jest.fn() },
    subscription: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    customer: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    employee: { findFirst: jest.fn(), findMany: jest.fn() },
    subscriptionHistory: { create: jest.fn() },
    $transaction: jest.fn((cb) => cb(mockTx)),
  };

  const mockAsaasGateway = {
    cancelAsaasSubscription: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompanyManagementService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AsaasGatewayService, useValue: mockAsaasGateway },
      ],
    }).compile();

    service = module.get<CompanyManagementService>(CompanyManagementService);
    jest.clearAllMocks();
    // Restore $transaction mock after clearAllMocks
    mockPrismaService.$transaction.mockImplementation((cb) => cb(mockTx));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── assignManual ──────────────────────────────────────────────────────

  describe('assignManual', () => {
    const assignDto = {
      companyId: 'company-1',
      password: 'admin-pass',
    };

    it('should throw UnauthorizedException when admin not found', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(null);

      await expect(
        service.assignManual(assignDto as any, 'admin-1'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when password is wrong', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue({
        id: 'admin-1',
        password: 'hashed',
      });
      (argon2.verify as jest.Mock).mockResolvedValue(false);

      await expect(
        service.assignManual(assignDto as any, 'admin-1'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw NotFoundException when company not found', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue({
        id: 'admin-1',
        password: 'hashed',
      });
      (argon2.verify as jest.Mock).mockResolvedValue(true);
      mockPrismaService.company.findUnique.mockResolvedValue(null);

      await expect(
        service.assignManual(assignDto as any, 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when START plan not found', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue({
        id: 'admin-1',
        password: 'hashed',
      });
      (argon2.verify as jest.Mock).mockResolvedValue(true);
      mockPrismaService.company.findUnique.mockResolvedValue({
        id: 'company-1',
        name: 'Test',
        customer: [],
      });
      mockPrismaService.plan.findFirst.mockResolvedValue(null);

      await expect(
        service.assignManual(assignDto as any, 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should deactivate existing subscription and create new one', async () => {
      mockPrismaService.user.findFirst
        .mockResolvedValueOnce({ id: 'admin-1', password: 'hashed' })
        .mockResolvedValueOnce({ email: 'user@test.com' }); // for customer creation
      (argon2.verify as jest.Mock).mockResolvedValue(true);
      mockPrismaService.company.findUnique.mockResolvedValue({
        id: 'company-1',
        name: 'Test Company',
        customer: [],
        email: 'company@test.com',
        cnpj: '12345678901234',
      });
      mockPrismaService.plan.findFirst.mockResolvedValue({
        id: 'plan-start',
        planType: 'START',
        basePrice: 9900,
      });
      mockPrismaService.subscription.findFirst.mockResolvedValue({
        id: 'old-sub',
        status: 'ACTIVE',
      });
      mockPrismaService.subscription.update.mockResolvedValue({});
      mockPrismaService.customer.create.mockResolvedValue({
        id: 'cus-new',
      });
      mockPrismaService.subscription.create.mockResolvedValue({
        id: 'sub-new',
      });
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        id: 'sub-new',
        plan: { name: 'START' },
        customer: { name: 'Test' },
      });

      const result = await service.assignManual(assignDto as any, 'admin-1');

      expect(result.message).toContain('sucesso');
      expect(mockPrismaService.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'old-sub' },
          data: { status: 'INACTIVE' },
        }),
      );
      expect(mockPrismaService.subscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'ACTIVE',
            value: 99,
          }),
        }),
      );
    });

    it('should use existing customer when available', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue({
        id: 'admin-1',
        password: 'hashed',
      });
      (argon2.verify as jest.Mock).mockResolvedValue(true);
      mockPrismaService.company.findUnique.mockResolvedValue({
        id: 'company-1',
        name: 'Test',
        customer: [{ id: 'existing-cus' }],
      });
      mockPrismaService.plan.findFirst.mockResolvedValue({
        id: 'plan-start',
        planType: 'START',
        basePrice: 5000,
      });
      mockPrismaService.subscription.findFirst.mockResolvedValue(null);
      mockPrismaService.subscription.create.mockResolvedValue({
        id: 'sub-new',
      });
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        id: 'sub-new',
      });

      await service.assignManual(assignDto as any, 'admin-1');

      expect(mockPrismaService.customer.create).not.toHaveBeenCalled();
      expect(mockPrismaService.subscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customerId: 'existing-cus',
          }),
        }),
      );
    });
  });

  // ─── updateActiveClient ────────────────────────────────────────────────

  describe('updateActiveClient', () => {
    const updateDto = {
      password: 'admin-pass',
      companyName: 'New Name',
    };

    it('should throw NotFoundException when company not found', async () => {
      mockPrismaService.company.findUnique.mockResolvedValue(null);

      await expect(
        service.updateActiveClient('company-1', updateDto as any, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw UnauthorizedException when user not found', async () => {
      mockPrismaService.company.findUnique.mockResolvedValue({
        id: 'company-1',
        address: [],
        customer: [],
      });
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(
        service.updateActiveClient('company-1', updateDto as any, 'user-1'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when password is wrong', async () => {
      mockPrismaService.company.findUnique.mockResolvedValue({
        id: 'company-1',
        address: [],
        customer: [],
      });
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        password: 'hashed',
        name: 'Admin',
      });
      (argon2.verify as jest.Mock).mockResolvedValue(false);

      await expect(
        service.updateActiveClient('company-1', updateDto as any, 'user-1'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw ConflictException when email already exists', async () => {
      mockPrismaService.company.findUnique.mockResolvedValue({
        id: 'company-1',
        address: [],
        customer: [{ id: 'cus-1' }],
      });
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        password: 'hashed',
        name: 'Admin',
      });
      (argon2.verify as jest.Mock).mockResolvedValue(true);
      mockPrismaService.employee.findFirst.mockResolvedValue({
        id: 'emp-1',
        user: { id: 'user-2', email: 'old@test.com' },
      });
      // Email duplicate found in User table
      mockPrismaService.user.findFirst.mockResolvedValue({
        id: 'other-user',
        email: 'new@test.com',
      });

      await expect(
        service.updateActiveClient(
          'company-1',
          { ...updateDto, email: 'new@test.com' } as any,
          'user-1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should successfully update company name in transaction', async () => {
      mockPrismaService.company.findUnique.mockResolvedValue({
        id: 'company-1',
        legalName: 'Old Name',
        name: 'Old Name',
        address: [],
        customer: [],
      });
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        password: 'hashed',
        name: 'Admin',
      });
      (argon2.verify as jest.Mock).mockResolvedValue(true);
      mockPrismaService.employee.findFirst.mockResolvedValue(null);

      const result = await service.updateActiveClient(
        'company-1',
        updateDto as any,
        'user-1',
      );

      expect(result.message).toContain('sucesso');
      expect(mockTx.company.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'company-1' },
          data: expect.objectContaining({
            legalName: 'New Name',
            name: 'New Name',
          }),
        }),
      );
      expect(mockTx.companyHistory.create).toHaveBeenCalled();
    });
  });

  // ─── deleteCompany ─────────────────────────────────────────────────────

  describe('deleteCompany', () => {
    it('should throw UnauthorizedException when admin not found', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteCompany('company-1', 'pass', 'admin-1'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when password is wrong', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue({
        id: 'admin-1',
        password: 'hashed',
        name: 'Admin',
      });
      (argon2.verify as jest.Mock).mockResolvedValue(false);

      await expect(
        service.deleteCompany('company-1', 'wrong-pass', 'admin-1'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw NotFoundException when company not found', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue({
        id: 'admin-1',
        password: 'hashed',
        name: 'Admin',
      });
      (argon2.verify as jest.Mock).mockResolvedValue(true);
      mockPrismaService.company.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteCompany('invalid-company', 'password', 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should cancel Asaas subscriptions before deleting', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue({
        id: 'admin-1',
        password: 'hashed',
        name: 'Admin',
      });
      (argon2.verify as jest.Mock).mockResolvedValue(true);
      mockPrismaService.company.findUnique.mockResolvedValue({
        id: 'company-1',
        name: 'Test Company',
        Subscription: [{ plan: { name: 'START' } }],
      });
      mockPrismaService.employee.findMany.mockResolvedValue([]);
      mockPrismaService.subscription.findMany.mockResolvedValue([
        {
          id: 'sub-1',
          customerId: 'cus-1',
          asaasSubscriptionId: 'asaas_sub_1',
        },
        { id: 'sub-2', customerId: 'cus-1', asaasSubscriptionId: null },
      ]);
      mockPrismaService.subscriptionHistory.create.mockResolvedValue({});
      mockTx.subscription.count.mockResolvedValue(0);
      mockTx.employee.count.mockResolvedValue(0);

      await service.deleteCompany('company-1', 'password', 'admin-1');

      // Should only cancel the one with asaasSubscriptionId
      expect(mockAsaasGateway.cancelAsaasSubscription).toHaveBeenCalledTimes(1);
      expect(mockAsaasGateway.cancelAsaasSubscription).toHaveBeenCalledWith(
        'asaas_sub_1',
      );
    });

    it('should continue deletion even if Asaas cancel fails', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue({
        id: 'admin-1',
        password: 'hashed',
        name: 'Admin',
      });
      (argon2.verify as jest.Mock).mockResolvedValue(true);
      mockPrismaService.company.findUnique.mockResolvedValue({
        id: 'company-1',
        name: 'Test',
        Subscription: [],
      });
      mockPrismaService.employee.findMany.mockResolvedValue([]);
      mockPrismaService.subscription.findMany.mockResolvedValue([
        { id: 'sub-1', customerId: 'cus-1', asaasSubscriptionId: 'asaas_fail' },
      ]);
      mockPrismaService.subscriptionHistory.create.mockResolvedValue({});
      mockAsaasGateway.cancelAsaasSubscription.mockRejectedValue(
        new Error('Asaas API down'),
      );
      mockTx.subscription.count.mockResolvedValue(0);
      mockTx.employee.count.mockResolvedValue(0);

      // Should NOT throw — deletion continues gracefully
      await expect(
        service.deleteCompany('company-1', 'password', 'admin-1'),
      ).resolves.toBeDefined();
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
    });

    it('should execute cascade delete in transaction', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue({
        id: 'admin-1',
        password: 'hashed',
        name: 'Admin',
      });
      (argon2.verify as jest.Mock).mockResolvedValue(true);
      mockPrismaService.company.findUnique.mockResolvedValue({
        id: 'company-1',
        name: 'Test',
        Subscription: [],
      });
      mockPrismaService.employee.findMany.mockResolvedValue([
        { userId: 'user-1' },
      ]);
      mockPrismaService.subscription.findMany.mockResolvedValue([
        { id: 'sub-1', customerId: 'cus-1', asaasSubscriptionId: null },
      ]);
      mockPrismaService.subscriptionHistory.create.mockResolvedValue({});
      mockTx.subscription.count.mockResolvedValue(0);
      mockTx.employee.count.mockResolvedValue(0);

      const result = await service.deleteCompany(
        'company-1',
        'password',
        'admin-1',
      );

      expect(result.message).toContain('excluída');
      expect(mockTx.company.delete).toHaveBeenCalledWith({
        where: { id: 'company-1' },
      });
      expect(mockTx.customer.delete).toHaveBeenCalledWith({
        where: { id: 'cus-1' },
      });
    });
  });
});
