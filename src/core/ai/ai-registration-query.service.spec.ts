import {
  AiRegistrationQueryDeniedError,
  AiRegistrationQueryService,
} from './ai-registration-query.service';

describe('AiRegistrationQueryService', () => {
  const user = {
    userId: 'user-1',
    companyId: 'company-1',
    role: 'role-1',
    isAdmin: false,
    isSystemAdmin: false,
  };

  function makeService(hasPermission = jest.fn().mockResolvedValue(true)) {
    const prisma = {
      client: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      supplier: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      product: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    // Como no AbacService: hasAnyPermission pergunta a hasPermission
    const abacService = {
      hasPermission,
      hasAnyPermission: jest.fn(async (user, permissions) => {
        for (const { action, resource } of permissions) {
          if (await hasPermission(user, action, resource)) return true;
        }
        return false;
      }),
    };

    return {
      service: new AiRegistrationQueryService(
        prisma as any,
        abacService as any,
      ),
      prisma,
      hasPermission,
    };
  }

  it('conta produtos ativos com pendencias fiscais e ignora companyId externo', async () => {
    const { service, prisma, hasPermission } = makeService();
    prisma.product.findMany.mockResolvedValue([
      {
        id: 'product-1',
        name: 'Produto sem NCM',
        code: 'P1',
        isActive: true,
        isService: false,
        fiscalData: {
          ncm: '00000000',
          cfopInState: '5102',
          cfopOutState: '6102',
          codigoServico: null,
        },
      },
      {
        id: 'product-2',
        name: 'Produto configurado',
        code: 'P2',
        isActive: true,
        isService: false,
        fiscalData: {
          ncm: '49119900',
          cfopInState: '5102',
          cfopOutState: '6102',
          codigoServico: null,
        },
      },
    ]);

    const result = await service.query(
      {
        entity: 'products',
        metric: 'count',
        filters: {
          companyId: 'evil-company',
          fiscalReadiness: 'INCOMPLETE',
        },
      },
      user,
    );

    expect(result).toEqual(
      expect.objectContaining({
        entity: 'products',
        total: 1,
        readiness: { ready: 0, incomplete: 1 },
      }),
    );
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 'company-1', isActive: true },
      }),
    );
    expect(hasPermission).toHaveBeenCalledWith(
      user,
      'view',
      'product_settings:products',
    );
  });

  it('produtos: basta poder orçar, sem ver o cadastro de produtos', async () => {
    const hasPermission = jest.fn(
      async (_user, action, resource) =>
        action === 'create' && resource === 'sale:quotation',
    );
    const { service, prisma } = makeService(hasPermission);

    await service.search({ entity: 'products', filters: {} }, user);

    expect(prisma.product.findMany).toHaveBeenCalled();
  });

  it('produtos: sem o cadastro de produtos e sem orçar, nega', async () => {
    const { service, prisma } = makeService(jest.fn().mockResolvedValue(false));

    await expect(
      service.search({ entity: 'products', filters: {} }, user),
    ).rejects.toThrow(
      'Seu perfil nao possui permissao para realizar essa consulta.',
    );
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it('busca clientes incompletos sem revelar documento ou endereco bruto', async () => {
    const { service, prisma } = makeService();
    prisma.client.findMany.mockResolvedValue([
      {
        id: 'client-1',
        name: 'Cliente teste',
        status: 'ACTIVE',
        type: 'COMPANY',
        cpf: null,
        cnpj: '12345678000190',
        stateRegistration: null,
        indicadorIE: 1,
        address: [
          {
            street: 'Rua teste',
            number: '',
            neighborhood: 'Centro',
            city: 'Sao Paulo',
            state: 'SP',
            zipcode: '01001000',
          },
        ],
      },
    ]);

    const result = await service.search(
      {
        entity: 'clients',
        filters: {
          companyId: 'evil-company',
          fiscalReadiness: 'INCOMPLETE',
        },
      },
      user,
    );

    expect(result.records).toEqual([
      {
        id: 'client-1',
        name: 'Cliente teste',
        status: 'ACTIVE',
        type: 'COMPANY',
        hasDocument: true,
        hasAddress: true,
        fiscalReadiness: 'INCOMPLETE',
        missingFields: ['Numero', 'Inscricao Estadual (IE)'],
      },
    ]);
    expect(result.records[0]).not.toHaveProperty('cnpj');
    expect(result.records[0]).not.toHaveProperty('address');
    expect(prisma.client.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 'company-1' },
      }),
    );
  });

  it('nega fornecedores quando perfil nao possui permissao cadastral', async () => {
    const { service, prisma } = makeService(jest.fn().mockResolvedValue(false));

    await expect(
      service.search({ entity: 'suppliers' }, user),
    ).rejects.toBeInstanceOf(AiRegistrationQueryDeniedError);
    expect(prisma.supplier.findMany).not.toHaveBeenCalled();
  });

  it('identifica servico sem codigo fiscal como incompleto', async () => {
    const { service, prisma } = makeService();
    prisma.product.findFirst.mockResolvedValue({
      id: 'service-1',
      name: 'Instalacao',
      code: 'S1',
      isActive: true,
      isService: true,
      fiscalData: {
        ncm: null,
        cfopInState: null,
        cfopOutState: null,
        codigoServico: null,
      },
    });

    const result = await service.details(
      { entity: 'products', id: 'service-1' },
      user,
    );

    expect(result.record).toEqual(
      expect.objectContaining({
        id: 'service-1',
        fiscalReadiness: 'INCOMPLETE',
        missingFields: ['Codigo do servico'],
      }),
    );
    expect(prisma.product.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId: 'company-1',
          isActive: true,
          id: 'service-1',
        },
      }),
    );
  });

  it('rejeita status cadastral fora do catalogo', async () => {
    const { service, prisma } = makeService();

    await expect(
      service.query(
        {
          entity: 'clients',
          metric: 'count',
          filters: { status: 'DELETED' },
        },
        user,
      ),
    ).rejects.toThrow('Status cadastral nao permitido.');
    expect(prisma.client.findMany).not.toHaveBeenCalled();
  });
});
