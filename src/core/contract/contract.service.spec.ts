import { ContractService } from './contract.service';

const V1 = {
  id: 'contract-1',
  name: 'Contrato de Licença de Uso de Software e Suporte Técnico',
  contentUrl: '<p>versão 1</p>',
  version: 1,
  createdAt: new Date('2025-10-08T00:00:00Z'),
};
const V2 = {
  id: 'contract-2',
  name: 'Contrato de Licença de Uso e Assinatura — versão 1.1',
  contentUrl: '<p>versão 1.1</p>',
  version: 2,
  createdAt: new Date('2026-09-26T10:00:00Z'),
};

function makePrisma() {
  return {
    contract: { findFirst: jest.fn() },
    contractAcceptance: { findFirst: jest.fn() },
    userContract: { findFirst: jest.fn(), create: jest.fn() },
    user: { findUnique: jest.fn() },
    employee: { findFirst: jest.fn() },
    subscription: { findFirst: jest.fn() },
  };
}

describe('ContractService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: ContractService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new ContractService(prisma as any);
  });

  it('os termos vigentes vêm com o nome da versão', async () => {
    prisma.contract.findFirst.mockResolvedValue(V2);

    await expect(service.getCurrentTerms()).resolves.toEqual({
      id: 'contract-2',
      name: V2.name,
      version: 2,
      html: '<p>versão 1.1</p>',
    });
  });

  it('o contrato da assinatura é o aceite mais recente da empresa, com as partes', async () => {
    prisma.contractAcceptance.findFirst.mockResolvedValue({
      contractId: 'contract-2',
      contractVersion: 2,
      contract: V2,
      createdAt: new Date('2026-09-26T12:00:00Z'),
      ipAddress: '200.1.2.3',
      acceptedByName: 'Débora',
      acceptedByEmail: 'debora@empresa.com',
      contractorType: 'PJ',
      contractorDocument: '12345678000190',
      contractorName: 'Empresa Ltda',
      contractorTradeName: 'Empresa',
      contractorEmail: 'financeiro@empresa.com',
      representativeName: 'Fulano de Tal',
      representativeCpf: '12348778701',
      representativeVerified: true,
    });

    const result: any = await service.getAcceptedContract('user-2', {
      user: { companyId: 'company-1' },
    });

    expect(prisma.contractAcceptance.findFirst).toHaveBeenCalledWith({
      where: { companyId: 'company-1' },
      orderBy: { createdAt: 'desc' },
      include: { contract: true },
    });
    expect(result).toMatchObject({
      html: '<p>versão 1.1</p>',
      name: V2.name,
      version: 2,
      acceptedBy: { name: 'Débora', email: 'debora@empresa.com' },
      contractor: { type: 'PJ', name: 'Empresa Ltda' },
      // CPF de terceiro sai mascarado.
      representative: {
        name: 'Fulano de Tal',
        cpf: '***.487.787-**',
        verified: true,
      },
    });
    // Quem abre não precisa ser quem aceitou.
    expect(prisma.userContract.findFirst).not.toHaveBeenCalled();
  });

  it('sem aceite da empresa, a assinatura antiga recebe a versão vigente na época, não a de hoje', async () => {
    prisma.contractAcceptance.findFirst.mockResolvedValue(null);
    prisma.userContract.findFirst.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      userRole: [{ isSystemAdmin: false, role: { name: 'Admin' } }],
    });
    prisma.employee.findFirst.mockResolvedValue({ companyId: 'company-1' });
    prisma.subscription.findFirst.mockResolvedValue({
      createdAt: new Date('2026-03-01T00:00:00Z'),
    });
    prisma.contract.findFirst.mockResolvedValueOnce(V1);
    prisma.userContract.create.mockImplementation(async ({ data }) => ({
      ...data,
      contract: data.contractId === V1.id ? V1 : V2,
    }));

    const result: any = await service.getAcceptedContract('user-1', {
      user: { companyId: 'company-1' },
      headers: {},
    });

    expect(prisma.contract.findFirst).toHaveBeenCalledWith({
      where: { createdAt: { lte: new Date('2026-03-01T00:00:00Z') } },
      orderBy: { version: 'desc' },
    });
    expect(result).toMatchObject({ contractId: 'contract-1', version: 1 });
  });
});
