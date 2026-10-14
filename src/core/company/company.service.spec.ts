import { Test, TestingModule } from '@nestjs/testing';
import { CompanyService } from './company.service';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { PlugService } from '../../svc/plug/plug.service';
import { CompanySeedsService } from './company-seeds.service';
import { CompanyHistoryService } from './company-history.service';
import { Logger, NotFoundException } from '@nestjs/common';
import { EncryptionService } from 'src/shared/services/encryption.service';
import { FiscalRolloutPolicyService } from '../fiscal/shared/fiscal-rollout-policy.service';
import { FiscalCredentialResolverService } from '../fiscal/shared/fiscal-credential-resolver.service';
import { InvoicyCompanyRegistrationService } from '../fiscal/invoicy/invoicy-company-registration.service';

// Mock data
const mockCompanyId = 'company-uuid-123';
const mockEmail = 'admin@empresa.com.br';

const mockCompanyRaw = {
  id: mockCompanyId,
  name: 'Empresa Teste',
  legalName: 'Empresa Teste LTDA',
  cnpj: '12345678000199',
  email: 'contato@empresa.com.br',
  phone: '11999999999',
  mobile: '11988888888',
  municipalRegistration: '123456',
  stateRegistration: '654321',
  siteUrl: 'https://empresa.com.br',
  isActive: true,
  logoUrl: 'https://empresa.com.br/logo.png',
  favIconUrl: 'https://empresa.com.br/favicon.ico',
  textBeforeItems: 'Segue abaixo:',
  textAfterItems: 'Termos e condições',
  instagram: '@empresa',
  facebook: 'empresa',
  linkedin: 'empresa-ltda',
  cnae: '1234567',
  partnerKey: 'partner-key',
  accessKey: 'access-key',
  address: [
    {
      id: 'address-1',
      street: 'Rua Teste',
      number: '123',
      complement: 'Sala 1',
      neighborhood: 'Centro',
      city: 'São Paulo',
      state: 'SP',
      zipcode: '01234567',
      ownerType: 'COMPANY',
    },
  ],
  DigitalCertificate: {
    id: 'cert-1',
    type: 'A1',
    description: 'Certificado A1',
    password: 'senha123',
    certificate: 'base64cert',
    name: 'certificado.pfx',
    lastUpload: new Date(),
    updatedAt: new Date(),
  },
  environmentCredentials: [],
};

const mockCreateCompanyDto = {
  general: {
    name: 'Nova Empresa',
    legalName: 'Nova Empresa LTDA',
    cnpj: '98765432000111',
    email: 'nova@empresa.com.br',
    phone: '11977777777',
    mobile: '11966666666',
    municipalRegistration: '999999',
    stateRegistration: '888888',
    siteUrl: 'https://nova.empresa.com.br',
  },
  address: {
    street: 'Av Nova',
    number: '456',
    complement: '',
    neighborhood: 'Centro',
    city: 'Rio de Janeiro',
    state: 'RJ',
    zipcode: '22222000',
  },
  personalization: {
    logoUrl: null,
    favIconUrl: null,
  },
  socialNetworks: {
    instagram: null,
    facebook: null,
    linkedin: null,
  },
  fiscal: {
    cnae: '7654321',
    partnerKey: null,
    accessKey: null,
    certificateType: null,
    certificate: null,
    certificateName: null,
    certificatePassword: null,
    certificateDescription: null,
  },
};

const mockUpdateCompanyDto = {
  general: {
    name: 'Empresa Atualizada',
    legalName: 'Empresa Atualizada LTDA',
    cnpj: '12345678000199',
    email: 'novo@empresa.com.br',
    phone: '11955555555',
    mobile: null,
    municipalRegistration: '123456',
    stateRegistration: '654321',
    siteUrl: null,
  },
  address: {
    street: 'Rua Nova',
    number: '789',
    complement: '',
    neighborhood: 'Centro Histórico',
    city: 'São Paulo',
    state: 'SP',
    zipcode: '01234000',
  },
  personalization: {
    logoUrl: 'https://empresa.com.br/novo-logo.png',
    favIconUrl: null,
    textsBeforeItems: 'Novo texto antes',
    textsAfterItems: 'Novo texto depois',
  },
  socialNetworks: {
    instagram: '@empresa_nova',
    facebook: null,
    linkedin: null,
  },
  fiscal: {
    cnae: '9999999',
    partnerKey: null,
    accessKey: null,
    certificateType: 'A1' as const,
    certificate: 'newbase64cert',
    certificateName: 'novo_certificado.pfx',
    certificatePassword: 'novasenha',
    certificateDescription: 'Novo certificado',
  },
};

// Mock implementations
const mockPrismaService = {
  company: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  address: {
    create: jest.fn(),
    updateMany: jest.fn(),
  },
  digitalCertificate: {
    upsert: jest.fn(),
    delete: jest.fn(),
  },
  companySector: {
    findMany: jest.fn(),
    createMany: jest.fn(),
    findFirst: jest.fn(),
  },
  unit: {
    createMany: jest.fn(),
  },
  saleSeries: {
    findMany: jest.fn(),
    create: jest.fn(),
    createMany: jest.fn(),
  },
  paymentCondition: {
    findMany: jest.fn(),
    createMany: jest.fn(),
    create: jest.fn(),
  },
  paymentMethod: {
    findMany: jest.fn(),
  },
  bankAccount: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  nature: {
    findMany: jest.fn(),
    createMany: jest.fn(),
  },
  role: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
  category: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
  product: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
  client: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
  scheduledExpense: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
  reasons: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
  payrollTemplate: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  cfopConfig: {
    findMany: jest.fn(),
    createMany: jest.fn(),
  },
  operationNature: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
  companyHistory: {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  employee: {
    findMany: jest.fn(),
  },
  user: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  sellerProfile: {
    create: jest.fn(),
  },
  payrollSetup: {
    create: jest.fn(),
  },
  invoicyEnvironmentConfig: {
    updateMany: jest.fn(),
  },
  companyEnvironmentCredential: {
    count: jest.fn().mockResolvedValue(0),
    updateMany: jest.fn(),
  },
  $transaction: jest.fn((callback) => callback(mockPrismaService)),
};

const mockPlugService = {
  company: jest.fn(),
};

const mockCompanySeedsService = {
  createDefaultItems: jest.fn(),
  createMissingDefaultItems: jest.fn(),
};

const mockCompanyHistoryService = {
  createHistory: jest.fn(),
  listHistory: jest.fn(),
};

const mockEncryptionService = {
  encrypt: jest.fn(),
  decrypt: jest.fn(),
  reEncrypt: jest.fn(),
  generateAAD: jest.fn(),
};

const mockFiscalRolloutPolicyService = {
  shouldReadFromEncrypted: jest.fn().mockReturnValue(false),
  shouldWriteToLegacy: jest.fn().mockReturnValue(true),
  isRolloutActivationEnabled: jest.fn().mockResolvedValue(false),
  isProductionActivationEnabled: jest.fn().mockReturnValue(false),
  isEnvironmentSwitchLocked: jest.fn().mockResolvedValue(true),
  validateBootstrapConfig: jest.fn().mockResolvedValue(undefined),
};

const mockFiscalCredentialResolverService = {
  getCompanyRuntimeCredentials: jest.fn(),
  getEmissorRuntimeCredentials: jest.fn(),
  getCompanyCredentialsForValidation: jest.fn(),
  getEmissorCredentialsForValidation: jest.fn(),
  resolveOperationalEnvironment: jest.fn(),
  reserveNfceNumber: jest.fn(),
};

const mockInvoicyCompanyRegistrationService = {
  ensureRegistered: jest.fn(),
  syncRegistrationData: jest.fn().mockResolvedValue([]),
};

describe('CompanyService', () => {
  let service: CompanyService;
  let prisma: typeof mockPrismaService;
  let plugService: typeof mockPlugService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompanyService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: PlugService, useValue: mockPlugService },
        { provide: CompanySeedsService, useValue: mockCompanySeedsService },
        { provide: CompanyHistoryService, useValue: mockCompanyHistoryService },
        { provide: EncryptionService, useValue: mockEncryptionService },
        {
          provide: FiscalRolloutPolicyService,
          useValue: mockFiscalRolloutPolicyService,
        },
        {
          provide: FiscalCredentialResolverService,
          useValue: mockFiscalCredentialResolverService,
        },
        {
          provide: InvoicyCompanyRegistrationService,
          useValue: mockInvoicyCompanyRegistrationService,
        },
      ],
    }).compile();

    // Silence logger during tests
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();

    service = module.get<CompanyService>(CompanyService);
    prisma = module.get(PrismaService);
    plugService = module.get(PlugService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ============================================
  // formatCompany Tests
  // ============================================
  describe('formatCompany', () => {
    it('should format company with all fields', () => {
      // Access private method via bracket notation
      const result = (service as any).formatCompany(mockCompanyRaw);

      expect(result).toHaveProperty('id', mockCompanyId);
      expect(result).toHaveProperty('isActive', true);
      expect(result.general).toHaveProperty('name', 'Empresa Teste');
      expect(result.general).toHaveProperty('cnpj', '12345678000199');
      expect(result.address).toHaveProperty('street', 'Rua Teste');
      expect(result.personalization).toHaveProperty('logoUrl');
      expect(result.socialNetworks).toHaveProperty('instagram', '@empresa');
      expect(result.fiscal).toHaveProperty('certificateType', 'A1');
    });

    it('should handle company without address', () => {
      const companyNoAddress = { ...mockCompanyRaw, address: [] };
      const result = (service as any).formatCompany(companyNoAddress);

      expect(result.address).toBeNull();
    });

    it('should handle company without certificate', () => {
      const companyNoCert = { ...mockCompanyRaw, DigitalCertificate: null };
      const result = (service as any).formatCompany(companyNoCert);

      expect(result.fiscal.certificateType).toBeUndefined();
      expect(result.fiscal.certificate).toBeUndefined();
    });

    it('should set isPrincipal when provided', () => {
      const result = (service as any).formatCompany(mockCompanyRaw, true);

      expect(result.principal).toBe(true);
    });
  });

  // ============================================
  // findOne Tests
  // ============================================
  describe('findOne', () => {
    it('should return formatted company when found', async () => {
      prisma.company.findFirst.mockResolvedValue(mockCompanyRaw);

      const result = await service.findOne(mockCompanyId);

      expect(result).toHaveProperty('id', mockCompanyId);
      expect(result.general).toHaveProperty('name', 'Empresa Teste');
      expect(prisma.company.findFirst).toHaveBeenCalledWith({
        where: { id: mockCompanyId },
        include: {
          address: true,
          DigitalCertificate: true,
          environmentCredentials: true,
        },
      });
    });

    it('should return null when company not found', async () => {
      prisma.company.findFirst.mockResolvedValue(null);

      const result = await service.findOne('invalid-id');
      expect(result).toBeNull();
    });
  });

  // ============================================
  // assertInAccount Tests
  // ============================================
  describe('assertInAccount', () => {
    const user = { companyId: mockCompanyId };

    it('a empresa da sessão e as filiais dela passam', async () => {
      prisma.company.count.mockResolvedValue(1);

      await expect(
        service.assertInAccount('filial-1', user),
      ).resolves.toBeUndefined();
      expect(prisma.company.count).toHaveBeenCalledWith({
        where: {
          id: 'filial-1',
          OR: [{ id: mockCompanyId }, { principalCompanyId: mockCompanyId }],
        },
      });
    });

    it('empresa de outra conta responde 404', async () => {
      prisma.company.count.mockResolvedValue(0);

      await expect(service.assertInAccount('outra', user)).rejects.toThrow(
        new NotFoundException('Empresa não encontrada.'),
      );
    });

    it('o superadmin passa sem consultar', async () => {
      await expect(
        service.assertInAccount('outra', { ...user, isSystemAdmin: true }),
      ).resolves.toBeUndefined();
      expect(prisma.company.count).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // findAll Tests
  // ============================================
  describe('findAll', () => {
    it('should return paginated list of companies', async () => {
      prisma.company.count.mockResolvedValue(1);
      prisma.company.findMany.mockResolvedValue([mockCompanyRaw]);

      const result = await service.findAll({
        page: '1',
        limit: '10',
        companyId: mockCompanyId,
      });

      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
      expect(result.lastPage).toBe(1);
    });

    it('should calculate last page correctly', async () => {
      prisma.company.count.mockResolvedValue(25);
      prisma.company.findMany.mockResolvedValue([mockCompanyRaw]);

      const result = await service.findAll({
        page: '1',
        limit: '10',
        companyId: mockCompanyId,
      });

      expect(result.lastPage).toBe(3);
    });

    it('should prioritize principal company in sorting', async () => {
      const companies = [
        { ...mockCompanyRaw, id: 'child-company' },
        { ...mockCompanyRaw, id: mockCompanyId },
      ];
      prisma.company.count.mockResolvedValue(2);
      prisma.company.findMany.mockResolvedValue(companies);

      const result = await service.findAll({
        page: '1',
        limit: '10',
        companyId: mockCompanyId,
      });

      // Principal company should be first
      expect(result.data[0].id).toBe(mockCompanyId);
    });
  });

  // ============================================
  // check (CNPJ validation via PlugService) Tests
  // ============================================
  describe('check', () => {
    it('should return company data from plug service', async () => {
      const plugResponse = { name: 'Empresa Via CNPJ', cnpj: '12345678000199' };
      plugService.company.mockResolvedValue(plugResponse);

      const result = await service.check('12345678000199');

      expect(result).toEqual(plugResponse);
      expect(plugService.company).toHaveBeenCalledWith('12345678000199');
    });

    it('should propagate errors from plug service', async () => {
      plugService.company.mockRejectedValue(new Error('CNPJ inválido'));

      await expect(service.check('invalid')).rejects.toThrow('CNPJ inválido');
    });
  });

  // ============================================
  // createMainCompany Tests
  // ============================================
  describe('createMainCompany', () => {
    beforeEach(() => {
      // Mock all seed check methods to return true (already exists)
      prisma.companySector.findMany.mockResolvedValue([{ id: 'sector-1' }]);
      // findUnique returns full company so formatCompany (which requires fiscal
      // relations) succeeds both for seed checks and for the final fetch.
      prisma.company.findUnique.mockResolvedValue({
        ...mockCompanyRaw,
        unitDefaults: 'UN',
      });
      prisma.saleSeries.findMany.mockResolvedValue([{ id: 'series-1' }]);
      prisma.paymentCondition.findMany.mockResolvedValue([{ id: 'cond-1' }]);
      prisma.bankAccount.findFirst.mockResolvedValue({ id: 'bank-1' });
      prisma.nature.findMany.mockResolvedValue([{ id: 'nature-1' }]);
      prisma.role.findMany.mockResolvedValue([{ id: 'role-1' }]);
      prisma.category.findMany.mockResolvedValue([{ id: 'cat-1' }]);
      prisma.product.findMany.mockResolvedValue([{ id: 'prod-1' }]);
      prisma.client.findMany.mockResolvedValue([{ id: 'client-1' }]);
      prisma.scheduledExpense.findMany.mockResolvedValue([{ id: 'exp-1' }]);
      prisma.reasons.findMany.mockResolvedValue([{ id: 'reason-1' }]);
      prisma.payrollTemplate.findFirst.mockResolvedValue({ id: 'template-1' });
      prisma.cfopConfig.findMany.mockResolvedValue([{ id: 'cfop-1' }]);
      prisma.operationNature.findMany.mockResolvedValue([{ id: 'opnat-1' }]);
    });

    it('should create company with all data', async () => {
      const createdCompany = {
        ...mockCompanyRaw,
        id: 'new-company-id',
        name: mockCreateCompanyDto.general.name,
      };
      prisma.company.create.mockResolvedValue(createdCompany);
      // Override findUnique so the final fetch returns the newly created company.
      prisma.company.findUnique.mockResolvedValue(createdCompany);

      const result = await service.createMainCompany(
        mockEmail,
        mockCreateCompanyDto,
      );

      expect(result.general.name).toBe('Nova Empresa');
      expect(prisma.company.create).toHaveBeenCalled();
    });

    it('should strip CNPJ formatting', async () => {
      const dtoWithFormattedCnpj = {
        ...mockCreateCompanyDto,
        general: {
          ...mockCreateCompanyDto.general,
          cnpj: '98.765.432/0001-11',
        },
      };
      prisma.company.create.mockResolvedValue(mockCompanyRaw);

      await service.createMainCompany(mockEmail, dtoWithFormattedCnpj);

      expect(prisma.company.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cnpj: '98765432000111',
          }),
        }),
      );
    });

    it('should call createDefaultItems after creation', async () => {
      prisma.company.create.mockResolvedValue(mockCompanyRaw);
      const createDefaultItemsSpy = jest.spyOn(
        service as any,
        'createDefaultItems',
      );

      await service.createMainCompany(mockEmail, mockCreateCompanyDto);

      expect(createDefaultItemsSpy).toHaveBeenCalledWith(
        mockEmail,
        mockCompanyRaw.id,
      );
    });
  });

  // ============================================
  // createDefaultItems Tests
  // ============================================
  describe('createDefaultItems', () => {
    beforeEach(() => {
      // Mock all checks to return "exists" (populated arrays/values)
      prisma.companySector.findMany.mockResolvedValue([{ id: 'sector-1' }]);
      prisma.company.findUnique.mockResolvedValue({ unitDefaults: 'UN' });
      prisma.saleSeries.findMany.mockResolvedValue([{ id: 'series-1' }]);
      prisma.paymentCondition.findMany.mockResolvedValue([{ id: 'cond-1' }]);
      prisma.bankAccount.findFirst.mockResolvedValue({ id: 'bank-1' });
      prisma.nature.findMany.mockResolvedValue([{ id: 'nature-1' }]);
      prisma.role.findMany.mockResolvedValue([{ id: 'role-1' }]);
      prisma.category.findMany.mockResolvedValue([{ id: 'cat-1' }]);
      prisma.product.findMany.mockResolvedValue([{ id: 'prod-1' }]);
      prisma.client.findMany.mockResolvedValue([{ id: 'client-1' }]);
      prisma.scheduledExpense.findMany.mockResolvedValue([{ id: 'exp-1' }]);
      prisma.reasons.findMany.mockResolvedValue([{ id: 'reason-1' }]);
      prisma.payrollTemplate.findFirst.mockResolvedValue({ id: 'template-1' });
      prisma.cfopConfig.findMany.mockResolvedValue([{ id: 'cfop-1' }]);
      prisma.operationNature.findMany.mockResolvedValue([{ id: 'opnat-1' }]);
    });

    it('should skip items that already exist', async () => {
      // All items exist, so no createMany should be called
      await service.createDefaultItems(mockEmail, mockCompanyId);

      // Sectors already exist, so createMany should NOT be called
      expect(prisma.companySector.createMany).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // createMissingDefaultItems Tests
  // ============================================
  describe('createMissingDefaultItems', () => {
    beforeEach(() => {
      // Mock all as existing so no creates are attempted
      prisma.company.findUnique.mockResolvedValue(mockCompanyRaw);
      prisma.companySector.findMany.mockResolvedValue([{ id: 'sector-1' }]);
      prisma.saleSeries.findMany.mockResolvedValue([{ id: 'series-1' }]);
      prisma.paymentCondition.findMany.mockResolvedValue([{ id: 'cond-1' }]);
      prisma.bankAccount.findFirst.mockResolvedValue({ id: 'bank-1' });
      prisma.nature.findMany.mockResolvedValue([{ id: 'nature-1' }]);
      prisma.role.findMany.mockResolvedValue([{ id: 'role-1' }]);
      prisma.category.findMany.mockResolvedValue([{ id: 'cat-1' }]);
      prisma.product.findMany.mockResolvedValue([{ id: 'prod-1' }]);
      prisma.client.findMany.mockResolvedValue([{ id: 'client-1' }]);
      prisma.scheduledExpense.findMany.mockResolvedValue([{ id: 'exp-1' }]);
      prisma.reasons.findMany.mockResolvedValue([{ id: 'reason-1' }]);
      prisma.payrollTemplate.findFirst.mockResolvedValue({ id: 'template-1' });
      prisma.cfopConfig.findMany.mockResolvedValue([{ id: 'cfop-1' }]);
      prisma.operationNature.findMany.mockResolvedValue([{ id: 'opnat-1' }]);
    });

    it('should throw error if company not found', async () => {
      prisma.company.findUnique.mockResolvedValue(null);

      await expect(
        service.createMissingDefaultItems('invalid-id'),
      ).rejects.toThrow('Company not found');
    });

    it('should return success when all items exist', async () => {
      const result = await service.createMissingDefaultItems(mockCompanyId);

      expect(result).toHaveProperty(
        'message',
        'Missing default items created successfully',
      );
      expect(result).toHaveProperty('companyId', mockCompanyId);
      expect(result).toHaveProperty('createdItems');
      // All items exist, so createdItems should be empty
      expect(result.createdItems).toEqual([]);
    });
  });

  // ============================================
  // update Tests
  // ============================================
  describe('update', () => {
    beforeEach(() => {
      prisma.company.update.mockResolvedValue(mockCompanyRaw);
      prisma.company.findUnique.mockResolvedValue(mockCompanyRaw);
    });

    it('should update company basic data', async () => {
      const result = await service.update(mockCompanyId, mockUpdateCompanyDto);

      expect(prisma.company.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockCompanyId },
        }),
      );
      expect(result).toHaveProperty('id', mockCompanyId);
    });

    it('should upsert digital certificate when provided', async () => {
      prisma.digitalCertificate.upsert.mockResolvedValue({ id: 'cert-2' });

      await service.update(mockCompanyId, mockUpdateCompanyDto);

      expect(prisma.digitalCertificate.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: mockCompanyId },
          update: expect.objectContaining({
            type: 'A1',
            certificate: 'newbase64cert',
          }),
        }),
      );
    });

    it('should update existing address', async () => {
      prisma.address.updateMany.mockResolvedValue({ count: 1 });

      await service.update(mockCompanyId, mockUpdateCompanyDto);

      expect(prisma.address.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: mockCompanyId, ownerType: 'COMPANY' },
          data: expect.objectContaining({
            street: 'Rua Nova',
            number: '789',
          }),
        }),
      );
    });

    it('should create address if none exists', async () => {
      const companyNoAddress = { ...mockCompanyRaw, address: [] };
      prisma.company.update.mockResolvedValue(companyNoAddress);
      prisma.address.create.mockResolvedValue({ id: 'new-address' });

      await service.update(mockCompanyId, mockUpdateCompanyDto);

      expect(prisma.address.create).toHaveBeenCalled();
    });

    /**
     * O gatilho do rebaixamento era `!!address`, e o formulario da empresa
     * manda o endereco inteiro em todo "Salvar". Trocar o telefone ou o logo
     * derrubava para DRAFT os ambientes de todos os emissores: a ativacao de
     * producao se perdia e o usuario tinha de refazer o assistente. Como o
     * rebaixamento nao grava historico fiscal, nada apontava para a causa.
     */
    describe('ambientes fiscais x gravacao da empresa', () => {
      const enderecoDoCadastro = {
        street: 'Rua Teste',
        number: '123',
        complement: 'Sala 1',
        neighborhood: 'Centro',
        city: 'São Paulo',
        state: 'SP',
        zipcode: '01234567',
      };

      it('nao rebaixa quando o endereco enviado e igual ao gravado', async () => {
        await service.update(mockCompanyId, {
          ...mockUpdateCompanyDto,
          address: enderecoDoCadastro,
        } as any);

        expect(
          prisma.invoicyEnvironmentConfig.updateMany,
        ).not.toHaveBeenCalled();
      });

      it('nao rebaixa por diferenca de espacos em branco', async () => {
        await service.update(mockCompanyId, {
          ...mockUpdateCompanyDto,
          address: {
            ...enderecoDoCadastro,
            street: '  Rua Teste ',
            number: '123 ',
          },
        } as any);

        expect(
          prisma.invoicyEnvironmentConfig.updateMany,
        ).not.toHaveBeenCalled();
      });

      /** O endereco compoe o XML: mudanca real exige nova validacao. */
      it('rebaixa para DRAFT quando o endereco muda de verdade', async () => {
        await service.update(mockCompanyId, mockUpdateCompanyDto);

        expect(prisma.invoicyEnvironmentConfig.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: 'DRAFT',
              lastValidationAt: null,
            }),
          }),
        );
      });

      it('rebaixa quando a empresa ainda nao tem endereco gravado', async () => {
        prisma.company.update.mockResolvedValue({
          ...mockCompanyRaw,
          address: [],
        });

        await service.update(mockCompanyId, {
          ...mockUpdateCompanyDto,
          address: enderecoDoCadastro,
        } as any);

        expect(prisma.invoicyEnvironmentConfig.updateMany).toHaveBeenCalled();
      });
    });

    it('should not delete certificate when type and file are set to null', async () => {
      const updateWithNullCert = {
        ...mockUpdateCompanyDto,
        fiscal: {
          ...mockUpdateCompanyDto.fiscal,
          certificateType: null,
          certificate: null,
        },
      };

      await service.update(mockCompanyId, updateWithNullCert);

      expect(prisma.digitalCertificate.delete).not.toHaveBeenCalled();
    });

    // Troca de CNPJ (decisão do PO, 14/10): com a nota ativada, só o
    // superadmin; as credenciais do provedor saem e nada é reenviado a ele
    describe('troca de CNPJ', () => {
      const newCnpj = {
        ...mockUpdateCompanyDto,
        general: {
          ...mockUpdateCompanyDto.general,
          cnpj: '11.222.333/0001-81',
        },
      } as any;

      it('com a nota ativada, a empresa não troca o CNPJ', async () => {
        prisma.companyEnvironmentCredential.count.mockResolvedValueOnce(1);
        await expect(
          service.update(mockCompanyId, newCnpj, {}),
        ).rejects.toThrow(
          'Esta empresa já tem a nota fiscal ativada: a troca de CNPJ é feita pela equipe Atrupe.',
        );
        expect(prisma.company.update).not.toHaveBeenCalled();
      });

      it('o superadmin troca; as credenciais saem e o provedor não é chamado', async () => {
        await service.update(mockCompanyId, newCnpj, { isSystemAdmin: true });
        expect(
          prisma.companyEnvironmentCredential.updateMany,
        ).toHaveBeenCalledWith({
          where: { companyId: mockCompanyId },
          data: { providerAccessKeyEncrypted: null },
        });
        expect(prisma.company.update).toHaveBeenCalledWith({
          where: { id: mockCompanyId },
          data: { accessKey: null },
        });
        expect(
          mockInvoicyCompanyRegistrationService.syncRegistrationData,
        ).not.toHaveBeenCalled();
      });

      it('sem a nota ativada, a empresa troca o CNPJ', async () => {
        await service.update(mockCompanyId, newCnpj, {});
        expect(
          prisma.companyEnvironmentCredential.updateMany,
        ).toHaveBeenCalled();
      });
    });
  });

  // ============================================
  // remove Tests (soft delete)
  // ============================================
  describe('remove', () => {
    it('should set isActive to false', async () => {
      prisma.company.update.mockResolvedValue({
        ...mockCompanyRaw,
        isActive: false,
      });

      await service.remove(mockCompanyId);

      expect(prisma.company.update).toHaveBeenCalledWith({
        where: { id: mockCompanyId },
        data: { isActive: false },
      });
    });
  });

  // ============================================
  // History Tests
  // ============================================
  describe('createHistory', () => {
    it('should create history entry', async () => {
      prisma.companyHistory.create.mockResolvedValue({
        id: 'history-1',
        action: 'UPDATE',
      });

      await service.createHistory(
        mockCompanyId,
        'UPDATE',
        'Empresa atualizada',
        { before: { name: 'Old' }, after: { name: 'New' } },
        { source: 'API' },
        'user-123',
        'Admin',
      );

      expect(prisma.companyHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          companyId: mockCompanyId,
          action: 'UPDATE',
          description: 'Empresa atualizada',
        }),
      });
    });
  });

  describe('listHistory', () => {
    it('should return paginated history', async () => {
      prisma.companyHistory.findMany.mockResolvedValue([
        { id: 'history-1', action: 'CREATE' },
      ]);
      prisma.companyHistory.count.mockResolvedValue(1);

      const result = await service.listHistory(mockCompanyId, 1, 10);

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('meta.total', 1);
      expect(result).toHaveProperty('meta.page', 1);
    });
  });
});
