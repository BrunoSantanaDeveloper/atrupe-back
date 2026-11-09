import { CompanyService } from './company.service';

/**
 * Toda conta nasce com um período de titularidade aberto: sem ele, a primeira
 * transferência não teria o que fechar, e o histórico começaria pelo segundo
 * titular.
 */
describe('CompanyService.createFirstAccess — titularidade', () => {
  let tx: any;
  let service: CompanyService;

  beforeEach(() => {
    tx = {
      user: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'user-1',
          name: 'Ana',
          email: 'ana@horizonte.com.br',
        }),
      },
      company: {
        updateMany: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({
          name: 'Horizonte',
          legalName: null,
          cnpj: null,
          ownerUserId: 'user-1',
        }),
      },
      ownershipPeriod: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      companySector: { findFirst: jest.fn().mockResolvedValue({ id: 'adm' }) },
      role: { create: jest.fn().mockResolvedValue({ id: 'role-admin' }) },
      sellerProfile: { create: jest.fn().mockResolvedValue({ id: 'seller' }) },
      employee: { create: jest.fn().mockResolvedValue({ id: 'emp-1' }) },
      payrollTemplate: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const prisma: any = { $transaction: jest.fn(async (fn) => fn(tx)) };
    const stub: any = {};
    service = new CompanyService(
      prisma,
      stub,
      stub,
      stub,
      stub,
      stub,
      stub,
      stub,
      stub,
    );
  });

  it('abre o período de quem criou a conta', async () => {
    await service.createFirstAccess('ana@horizonte.com.br', 'company-1');

    expect(tx.ownershipPeriod.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: 'company-1',
        userId: 'user-1',
        holderName: 'Horizonte',
        email: 'ana@horizonte.com.br',
      }),
    });
  });

  it('não abre um segundo período se já houver um aberto', async () => {
    tx.ownershipPeriod.findFirst.mockResolvedValue({ id: 'periodo' });

    await service.createFirstAccess('ana@horizonte.com.br', 'company-1');

    expect(tx.ownershipPeriod.create).not.toHaveBeenCalled();
  });

  it('não abre período para quem não ficou titular', async () => {
    tx.company.findUnique.mockResolvedValue({
      name: 'Horizonte',
      legalName: null,
      cnpj: null,
      ownerUserId: 'outra-pessoa',
    });

    await service.createFirstAccess('ana@horizonte.com.br', 'company-1');

    expect(tx.ownershipPeriod.create).not.toHaveBeenCalled();
  });
});
