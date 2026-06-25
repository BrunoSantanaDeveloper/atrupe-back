import { Test, TestingModule } from '@nestjs/testing';
import { FiscalEnvironment } from '@prisma/client';
import { FiscalIssuerReadinessService } from './fiscal-issuer-readiness.service';
import { PrismaService } from '../../../config/prisma/prisma.service';
import { EncryptionService } from '../../../shared/services/encryption.service';
import { FiscalCredentialResolverService } from '../shared/fiscal-credential-resolver.service';
import { InvoicyHttpService } from './invoicy-http.service';

describe('FiscalIssuerReadinessService — local checks', () => {
  let service: FiscalIssuerReadinessService;

  const prisma = {
    company: { findUnique: jest.fn() },
    invoicyConfig: { findUnique: jest.fn() },
    invoicyEnvironmentConfig: { findUnique: jest.fn() },
  };
  const encryption = { decrypt: jest.fn() };
  const resolver = { getEmissorCredentialsForValidation: jest.fn() };
  const http = {
    companyExistsInEnvironment: jest.fn(),
    authenticateForEnvironment: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FiscalIssuerReadinessService,
        { provide: PrismaService, useValue: prisma },
        { provide: EncryptionService, useValue: encryption },
        { provide: FiscalCredentialResolverService, useValue: resolver },
        { provide: InvoicyHttpService, useValue: http },
      ],
    }).compile();

    service = module.get(FiscalIssuerReadinessService);
  });

  afterEach(() => jest.clearAllMocks());

  it('aprova IE ISENTO (state_registration aceita ISENTO)', async () => {
    prisma.company.findUnique.mockResolvedValue({
      cnpj: '11222333000181',
      stateRegistration: 'ISENTO',
      address: [],
      DigitalCertificate: null,
    });
    prisma.invoicyConfig.findUnique.mockResolvedValue({ emitCmun: '4204202' });
    resolver.getEmissorCredentialsForValidation.mockResolvedValue({});
    prisma.invoicyEnvironmentConfig.findUnique.mockResolvedValue(null);

    const { checks } = await service.checkLocalReadiness(
      'c1',
      'e1',
      FiscalEnvironment.HOMOLOGACAO,
    );

    const ie = checks.find((c) => c.check === 'state_registration');
    expect(ie?.status).toBe('PASS');
    // localReady pode ser false por outros motivos (CSC, etc), não é o IE
  });

  it('reprova endereço incompleto e código IBGE ausente', async () => {
    prisma.company.findUnique.mockResolvedValue({
      cnpj: '11222333000181',
      stateRegistration: '123456789',
      address: [{ type: 'Principal', state: 'SC' }],
      DigitalCertificate: null,
    });
    prisma.invoicyConfig.findUnique.mockResolvedValue({ emitCmun: '0' });
    resolver.getEmissorCredentialsForValidation.mockResolvedValue({});
    prisma.invoicyEnvironmentConfig.findUnique.mockResolvedValue(null);

    const { checks } = await service.checkLocalReadiness(
      'c1',
      'e1',
      FiscalEnvironment.HOMOLOGACAO,
    );

    const addr = checks.find((c) => c.check === 'company_address');
    expect(addr?.status).toBe('FAIL');
    expect(addr?.message).toContain('código IBGE');
  });

  it('reprova CSC ausente para o ambiente', async () => {
    prisma.company.findUnique.mockResolvedValue({
      cnpj: '11222333000181',
      stateRegistration: '123456789',
      address: [],
      DigitalCertificate: null,
    });
    prisma.invoicyConfig.findUnique.mockResolvedValue({ emitCmun: '4204202' });
    resolver.getEmissorCredentialsForValidation.mockResolvedValue({
      cscId: null,
      cscToken: null,
    });
    prisma.invoicyEnvironmentConfig.findUnique.mockResolvedValue(null);

    const { checks } = await service.checkLocalReadiness(
      'c1',
      'e1',
      FiscalEnvironment.PRODUCAO,
    );

    const csc = checks.find((c) => c.check === 'nfce_csc');
    expect(csc?.status).toBe('FAIL');
  });

  it('checkConnection retorna true quando autenticação passa', async () => {
    prisma.company.findUnique.mockResolvedValue({ cnpj: '11222333000181' });
    http.authenticateForEnvironment.mockResolvedValue('token');

    await expect(
      service.checkConnection('c1', FiscalEnvironment.HOMOLOGACAO),
    ).resolves.toBe(true);
  });

  it('checkConnection retorna false quando autenticação falha', async () => {
    prisma.company.findUnique.mockResolvedValue({ cnpj: '11222333000181' });
    http.authenticateForEnvironment.mockRejectedValue(new Error('401'));

    await expect(
      service.checkConnection('c1', FiscalEnvironment.HOMOLOGACAO),
    ).resolves.toBe(false);
  });
});
