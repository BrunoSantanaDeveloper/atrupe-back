import { Test, TestingModule } from '@nestjs/testing';
import { ClientService } from './client.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { PlugService } from '../../svc/plug/plug.service';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeClient(overrides: Record<string, any> = {}) {
  return {
    id: 'client-1',
    name: 'Empresa Teste',
    email: 'teste@empresa.com',
    phone: '11999999999',
    mobile: '11988888888',
    cpf: null,
    cnpj: '12345678000195',
    companyId: 'company-A',
    status: 'ACTIVE',
    isBranch: false,
    type: 'COMPANY',
    categoryId: null,
    rg: null,
    corporateName: 'Empresa Teste LTDA',
    activity: null,
    notes: null,
    birthdate: null,
    minValue: 0,
    maxValue: 0,
    blockClient: false,
    stateRegistration: null,
    indicadorIE: 9,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeAddress(overrides: Record<string, any> = {}) {
  return {
    type: 'BILLING',
    zipcode: '01310100',
    state: 'SP',
    city: 'São Paulo',
    neighborhood: 'Centro',
    street: 'Av. Paulista',
    number: '1000',
    complement: null,
    ...overrides,
  };
}

// ─── Mocks ──────────────────────────────────────────────────────────────────

const prismaMock = {
  client: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
  },
  address: {
    createMany: jest.fn(),
    deleteMany: jest.fn(),
    findMany: jest.fn(),
  },
  contact: {
    createMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  clientPaymentCondition: {
    createMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  paymentCondition: {
    findMany: jest.fn(),
  },
  employee: {
    count: jest.fn(),
  },
  $transaction: jest.fn(),
};

const plugServiceMock = {};

// ─── Suite ──────────────────────────────────────────────────────────────────

describe('ClientService', () => {
  let service: ClientService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: PlugService, useValue: plugServiceMock },
      ],
    }).compile();

    service = module.get<ClientService>(ClientService);
    jest.clearAllMocks();
  });

  it('deve estar definido', () => {
    expect(service).toBeDefined();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // normalizeDocument (método privado — testado indiretamente via create)
  // ──────────────────────────────────────────────────────────────────────────

  describe('normalizeDocument (via create)', () => {
    it('deve remover pontuação do CNPJ antes de salvar', async () => {
      prismaMock.client.findFirst.mockResolvedValue(null); // sem duplicata
      const createdClient = makeClient({ id: 'new-1' });

      prismaMock.$transaction.mockImplementation(async (fn) => {
        prismaMock.client.create.mockResolvedValue(createdClient);
        prismaMock.address.createMany.mockResolvedValue({ count: 0 });
        prismaMock.contact.createMany.mockResolvedValue({ count: 0 });
        return fn(prismaMock);
      });
      // findOne após criação
      prismaMock.client.findUnique.mockResolvedValue({
        ...createdClient,
        contacts: [],
        address: [],
        paymentConditions: [],
      });
      prismaMock.paymentCondition.findMany.mockResolvedValue([]);

      const dto: any = {
        type: 'COMPANY',
        companyId: 'company-A',
        general: {
          name: 'Empresa Teste',
          cnpj: '12.345.678/0001-95', // com pontuação
          isBranch: false,
        },
      };

      await service.create(dto);

      const createCall = prismaMock.client.create.mock.calls[0][0];
      expect(createCall.data.cnpj).toBe('12345678000195'); // sem pontuação
    });

    it('deve remover pontuação do CPF antes de salvar', async () => {
      prismaMock.client.findFirst.mockResolvedValue(null);
      const createdClient = makeClient({
        cnpj: null,
        cpf: '12345678901',
        type: 'PERSON',
      });

      prismaMock.$transaction.mockImplementation(async (fn) => {
        prismaMock.client.create.mockResolvedValue(createdClient);
        prismaMock.address.createMany.mockResolvedValue({ count: 0 });
        return fn(prismaMock);
      });
      prismaMock.client.findUnique.mockResolvedValue({
        ...createdClient,
        contacts: [],
        address: [],
        paymentConditions: [],
      });
      prismaMock.paymentCondition.findMany.mockResolvedValue([]);

      const dto: any = {
        type: 'PERSON',
        companyId: 'company-A',
        general: {
          name: 'João Silva',
          cpf: '123.456.789-01', // com pontuação
          isBranch: false,
        },
      };

      await service.create(dto);

      const createCall = prismaMock.client.create.mock.calls[0][0];
      expect(createCall.data.cpf).toBe('12345678901');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // determineClientStatus (método privado — testado via create)
  // ──────────────────────────────────────────────────────────────────────────

  describe('determineClientStatus (via create)', () => {
    const setupTransaction = (overrides: Record<string, any> = {}) => {
      const client = makeClient(overrides);
      prismaMock.$transaction.mockImplementation(async (fn) => {
        prismaMock.client.create.mockResolvedValue(client);
        prismaMock.address.createMany.mockResolvedValue({ count: 0 });
        return fn(prismaMock);
      });
      prismaMock.client.findUnique.mockResolvedValue({
        ...client,
        contacts: [],
        address: [],
        paymentConditions: [],
      });
      prismaMock.paymentCondition.findMany.mockResolvedValue([]);
    };

    it('deve definir status ACTIVE quando cliente tem CNPJ, endereço e telefone', async () => {
      prismaMock.client.findFirst.mockResolvedValue(null);
      setupTransaction({ status: 'ACTIVE' });

      const dto: any = {
        type: 'COMPANY',
        companyId: 'company-A',
        general: {
          name: 'Empresa Completa',
          cnpj: '12345678000195',
          phone: '11999999999',
          isBranch: false,
        },
        addresses: [makeAddress()],
      };

      await service.create(dto);

      const createCall = prismaMock.client.create.mock.calls[0][0];
      expect(createCall.data.status).toBe('ACTIVE');
    });

    it('deve definir status PROSPECT quando falta CNPJ/CPF', async () => {
      prismaMock.client.findFirst.mockResolvedValue(null);
      setupTransaction({ status: 'PROSPECT' });

      const dto: any = {
        type: 'COMPANY',
        companyId: 'company-A',
        general: {
          name: 'Empresa Incompleta',
          isBranch: false,
        },
        addresses: [makeAddress()],
      };

      await service.create(dto);

      const createCall = prismaMock.client.create.mock.calls[0][0];
      expect(createCall.data.status).toBe('PROSPECT');
    });

    it('deve definir status PROSPECT quando falta endereço', async () => {
      prismaMock.client.findFirst.mockResolvedValue(null);
      setupTransaction({ status: 'PROSPECT' });

      const dto: any = {
        type: 'COMPANY',
        companyId: 'company-A',
        general: {
          name: 'Empresa Sem Endereço',
          cnpj: '12345678000195',
          phone: '11999999999',
          isBranch: false,
        },
        addresses: [], // sem endereço
      };

      await service.create(dto);

      const createCall = prismaMock.client.create.mock.calls[0][0];
      expect(createCall.data.status).toBe('PROSPECT');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // create — duplicidade de documento
  // ──────────────────────────────────────────────────────────────────────────

  describe('create — duplicidade de documento', () => {
    it('deve rejeitar cliente com CNPJ duplicado na mesma empresa', async () => {
      prismaMock.client.findFirst.mockResolvedValue(makeClient()); // duplicata encontrada

      const dto: any = {
        type: 'COMPANY',
        companyId: 'company-A',
        general: {
          name: 'Empresa Duplicada',
          cnpj: '12345678000195',
          isBranch: false,
        },
      };

      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
      await expect(service.create(dto)).rejects.toThrow(/CNPJ/);
    });

    it('deve rejeitar cliente com CPF duplicado na mesma empresa', async () => {
      prismaMock.client.findFirst.mockResolvedValue(
        makeClient({ cpf: '12345678901', cnpj: null }),
      );

      const dto: any = {
        type: 'PERSON',
        companyId: 'company-A',
        general: {
          name: 'João Duplicado',
          cpf: '12345678901',
          isBranch: false,
        },
      };

      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
      await expect(service.create(dto)).rejects.toThrow(/CPF/);
    });

    it('deve permitir CNPJ duplicado quando o cliente é filial (isBranch: true)', async () => {
      // isBranch = true → pula validação de duplicata
      prismaMock.client.findFirst.mockResolvedValue(null);
      const branchClient = makeClient({ isBranch: true });

      prismaMock.$transaction.mockImplementation(async (fn) => {
        prismaMock.client.create.mockResolvedValue(branchClient);
        prismaMock.address.createMany.mockResolvedValue({ count: 0 });
        return fn(prismaMock);
      });
      prismaMock.client.findUnique.mockResolvedValue({
        ...branchClient,
        contacts: [],
        address: [],
        paymentConditions: [],
      });
      prismaMock.paymentCondition.findMany.mockResolvedValue([]);

      const dto: any = {
        type: 'COMPANY',
        companyId: 'company-A',
        general: {
          name: 'Filial SP',
          cnpj: '12345678000195',
          isBranch: true,
        },
      };

      await expect(service.create(dto)).resolves.not.toThrow();
      // findFirst NÃO deve ser chamado para validar duplicata de filial
      expect(prismaMock.client.findFirst).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // findAll — isolamento multi-tenant e filtros
  // ──────────────────────────────────────────────────────────────────────────

  describe('findAll — isolamento multi-tenant e filtros', () => {
    const makeFilter = (overrides: Record<string, any> = {}) => ({
      companyId: 'company-A',
      page: '1',
      limit: '10',
      ...overrides,
    });

    it('deve filtrar clientes apenas da empresa correta (multi-tenant)', async () => {
      prismaMock.client.count.mockResolvedValue(1);
      prismaMock.client.findMany.mockResolvedValue([makeClient()]);

      await service.findAll(makeFilter() as any);

      const findManyCall = prismaMock.client.findMany.mock.calls[0][0];
      expect(findManyCall.where).toMatchObject({ companyId: 'company-A' });
    });

    it('filtro por nome deve ser passado como busca insensível a maiúsculas', async () => {
      prismaMock.client.count.mockResolvedValue(1);
      prismaMock.client.findMany.mockResolvedValue([makeClient()]);

      await service.findAll(makeFilter({ search: 'empresa' }) as any);

      const findManyCall = prismaMock.client.findMany.mock.calls[0][0];
      const orClause = findManyCall.where.OR;
      expect(orClause).toBeDefined();
      const nameClause = orClause.find((c: any) => c.name);
      expect(nameClause.name.mode).toBe('insensitive');
    });

    it('filtro por CNPJ deve normalizar a busca (remover pontuação)', async () => {
      prismaMock.client.count.mockResolvedValue(1);
      prismaMock.client.findMany.mockResolvedValue([makeClient()]);

      await service.findAll(
        makeFilter({ search: '12.345.678/0001-95' }) as any,
      );

      const findManyCall = prismaMock.client.findMany.mock.calls[0][0];
      const orClause = findManyCall.where.OR;
      const cnpjClause = orClause.find((c: any) => c.cnpj);
      expect(cnpjClause.cnpj.contains).toBe('12345678000195');
    });

    it('deve retornar paginação correta (total, lastPage, data)', async () => {
      prismaMock.client.count.mockResolvedValue(25);
      prismaMock.client.findMany.mockResolvedValue([
        makeClient(),
        makeClient({ id: 'client-2' }),
      ]);

      const result = await service.findAll(
        makeFilter({ limit: '10', page: '1' }) as any,
      );

      expect(result.total).toBe(25);
      expect(result.lastPage).toBe(3);
      expect(Array.isArray(result.data)).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // findOne
  // ──────────────────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('deve lançar NotFoundException para cliente inexistente', async () => {
      prismaMock.client.findUnique.mockResolvedValue(null);
      await expect(service.findOne('nao-existe')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deve retornar dados completos do cliente com endereços e contatos', async () => {
      const fullClient = {
        ...makeClient(),
        contacts: [
          {
            id: 'c-1',
            name: 'Contato',
            email: 'c@t.com',
            phone: null,
            mobile: null,
            notes: null,
          },
        ],
        address: [
          {
            ...makeAddress(),
            id: 'a-1',
            ownerId: 'client-1',
            ownerType: 'CLIENT' as const,
          },
        ],
        paymentConditions: [],
      };

      prismaMock.client.findUnique.mockResolvedValue(fullClient);
      prismaMock.paymentCondition.findMany.mockResolvedValue([]);

      const result = await service.findOne('client-1');

      expect(result).toHaveProperty('general');
      expect(result).toHaveProperty('addresses');
      expect(result).toHaveProperty('contacts');
      expect(result).toHaveProperty('creditLimit');
      expect(result.addresses).toHaveLength(1);
      expect(result.contacts).toHaveLength(1);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // update — validações de duplicata e status
  // ──────────────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('deve lançar NotFoundException ao tentar atualizar cliente inexistente', async () => {
      prismaMock.client.findUnique.mockResolvedValue(null);
      await expect(service.update('nao-existe', {} as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deve rejeitar atualização com CNPJ duplicado em outro cliente da mesma empresa', async () => {
      prismaMock.client.findUnique.mockResolvedValue(
        makeClient({ isBranch: false }),
      );
      // Encontra outro cliente com mesmo CNPJ (não a própria filial)
      prismaMock.client.findFirst.mockResolvedValue(
        makeClient({ id: 'outro-cliente' }),
      );

      const dto: any = {
        general: { cnpj: '12345678000195', isBranch: false },
      };

      await expect(service.update('client-1', dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('grupo de outra empresa no corpo é recusado antes de gravar', async () => {
      prismaMock.client.findUnique.mockResolvedValueOnce({
        companyId: 'company-1',
      });
      (prismaMock as any).category = {
        ...((prismaMock as any).category ?? {}),
        count: jest.fn().mockResolvedValue(0),
      };

      await expect(
        service.update('client-1', {
          general: { name: 'X', categoryId: 'grupo-de-outra' },
        } as any),
      ).rejects.toThrow('Grupo não encontrado.');
      expect((prismaMock as any).category.count).toHaveBeenCalledWith({
        where: {
          id: { in: ['grupo-de-outra'] },
          OR: [{ companyId: 'company-1' }, { isStandard: true }],
        },
      });
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('deve manter status INACTIVE ao atualizar cliente inativo', async () => {
      const inactiveClient = makeClient({ status: 'INACTIVE' });
      prismaMock.client.findUnique
        // a empresa do cliente, para conferir os ids do corpo
        .mockResolvedValueOnce({ companyId: inactiveClient.companyId })
        .mockResolvedValueOnce(inactiveClient) // primeiro findUnique (busca para update)
        .mockResolvedValueOnce({
          // segundo findUnique (findOne no final)
          ...inactiveClient,
          contacts: [],
          address: [],
          paymentConditions: [],
        });
      prismaMock.client.findFirst.mockResolvedValue(null);
      prismaMock.$transaction.mockImplementation(async (fn) => {
        prismaMock.client.update.mockResolvedValue(inactiveClient);
        prismaMock.address.deleteMany.mockResolvedValue({ count: 0 });
        prismaMock.address.createMany.mockResolvedValue({ count: 0 });
        return fn(prismaMock);
      });
      prismaMock.paymentCondition.findMany.mockResolvedValue([]);

      const dto: any = {
        general: { name: 'Novo Nome', isBranch: false },
      };

      await service.update('client-1', dto);

      const updateCall = prismaMock.client.update.mock.calls[0][0];
      // finalStatus deve ser undefined (não alterar status INACTIVE)
      expect(updateCall.data.status).toBeUndefined();
    });

    // O PATCH não levava o responsável: nem trocava nem limpava (revisão de
    // 23/10/2026). Ausente mantém; null ou "" é "Sem responsável"
    it.each([
      ['troca', 'emp-2', 'emp-2'],
      ['limpa com null', null, null],
      ['limpa com ""', '', null],
      ['mantém quando não vem', undefined, undefined],
    ])('responsável: %s', async (_case, responsibleId, expected) => {
      const client = makeClient({ responsibleId: 'emp-1' });
      prismaMock.client.findUnique
        .mockResolvedValueOnce({ companyId: client.companyId })
        .mockResolvedValueOnce(client)
        .mockResolvedValueOnce({
          ...client,
          contacts: [],
          address: [],
          paymentConditions: [],
        });
      prismaMock.client.findFirst.mockResolvedValue(null);
      prismaMock.employee.count.mockResolvedValue(1);
      prismaMock.client.update.mockClear();
      prismaMock.$transaction.mockImplementation(async (fn) => {
        prismaMock.client.update.mockResolvedValue(client);
        return fn(prismaMock);
      });
      prismaMock.paymentCondition.findMany.mockResolvedValue([]);

      await service.update('client-1', {
        general: { name: 'Empresa Teste', isBranch: false },
        responsibleId,
      } as any);

      const updateCall = prismaMock.client.update.mock.calls[0][0];
      expect(updateCall.data.responsibleId).toBe(expected);
    });
  });
});
