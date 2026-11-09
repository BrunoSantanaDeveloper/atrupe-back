import { ImportService } from './import.service';
import { QUOTATION_IMPORT_SCHEMA } from './schemas/quotation-import.schema';
import { ORDER_IMPORT_SCHEMA } from './schemas/order-import.schema';

describe('ImportService CSV parsing', () => {
  let service: ImportService;

  beforeEach(() => {
    service = new ImportService({} as any, {} as any, {} as any);
  });

  it('parses Excel CSV files with sep directive and semicolon delimiter', async () => {
    const content =
      '\ufeffsep=;\r\nnome;email;valor\r\nCliente Teste;cliente@example.com;40,50';

    const rows = await service.parseCsv(Buffer.from(content, 'utf-8'));

    expect(rows).toEqual([
      {
        nome: 'Cliente Teste',
        email: 'cliente@example.com',
        valor: '40,50',
      },
    ]);
  });

  it('parses legacy comma-delimited CSV files', async () => {
    const content = 'nome,email,valor\nCliente Teste,cliente@example.com,40.50';

    const rows = await service.parseCsv(Buffer.from(content, 'utf-8'));

    expect(rows).toEqual([
      {
        nome: 'Cliente Teste',
        email: 'cliente@example.com',
        valor: '40.50',
      },
    ]);
  });

  it('normalizes Brazilian decimal values when converting money to cents', () => {
    expect((service as any).toCents('1.234,56')).toBe(123456);
    expect((service as any).toCents('1234.56')).toBe(123456);
  });
});

describe('ImportService product import', () => {
  let service: ImportService;
  let createdItems: any[];
  let createdProducts: any[];

  const baseRow = {
    codigo: 'TEL',
    nome: 'TELHA T25',
    setor: 'ALMOXARIFADO',
    grupo: 'Chapas',
  };

  beforeEach(() => {
    createdItems = [];
    createdProducts = [];

    const prisma = {
      companySector: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'sector-1', name: 'ALMOXARIFADO' }),
      },
      category: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'cat-1', sectorId: 'sector-1' }),
      },
      product: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => {
          createdProducts.push(data);
          return Promise.resolve({ id: 'prod-1' });
        }),
      },
      defaultUnitOfMeasure: {
        findFirst: jest
          .fn()
          .mockImplementation(({ where }) =>
            Promise.resolve(
              where.code === 'M2'
                ? { id: 'uom-m2', kind: 'AREA' }
                : where.code === 'UN'
                  ? { id: 'uom-un', kind: 'UNITY' }
                  : null,
            ),
          ),
      },
      productItem: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => {
          createdItems.push(data);
          return Promise.resolve(data);
        }),
      },
    };

    const productFiscalService = {
      getOrCreateWithDefaults: jest.fn().mockResolvedValue({}),
    };

    service = new ImportService(
      prisma as any,
      {} as any,
      productFiscalService as any,
    );
  });

  it('não grava taxa por unidade bruta em salePrice quando falta a medida', async () => {
    await (service as any).importProduct(
      {
        ...baseRow,
        unidadeMedida: 'M2',
        valorUnitario: '450.00',
        largura: '',
        altura: '',
      },
      'company-1',
    );

    const [item] = createdItems;
    // R$ 450,00/m² = 45000 centavos/m² = 0,045 centavos/mm² (unidade bruta)
    expect(item.unitCost).toBeCloseTo(0.045, 10);
    // Sem largura e altura não existe total: gravar 0,045 aqui exibia "0,00" na listagem
    expect(item.salePrice).toBeNull();
  });

  it('calcula o total quando a unidade dimensional traz a medida', async () => {
    await (service as any).importProduct(
      {
        ...baseRow,
        unidadeMedida: 'M2',
        valorUnitario: '450.00',
        largura: '1,40',
        altura: '2,00',
      },
      'company-1',
    );

    const [item] = createdItems;
    // 1,40m × 2,00m = 2,8m² a R$ 450,00/m² = R$ 1.260,00 = 126000 centavos
    expect(item.salePrice).toBeCloseTo(126000, 6);
  });

  it('mantém o valor unitário como total para unidades sem dimensão', async () => {
    await (service as any).importProduct(
      {
        ...baseRow,
        codigo: 'C4X1F',
        nome: '1000 CARTAO DE VISITA FOTOGRAFICO',
        unidadeMedida: 'UN',
        valorUnitario: '120.00',
      },
      'company-1',
    );

    const [item] = createdItems;
    expect(item.unitCost).toBe(12000);
    expect(item.salePrice).toBe(12000);
  });

  it('tira o tipo do código quando a tabela de unidades não o tem', async () => {
    // Em produção a tabela de unidades padrão está vazia: vale o código. "HH"
    // é a hora do legado e entrava como unidade avulsa.
    await (service as any).importProduct(
      { ...baseRow, unidadeMedida: 'HH', valorUnitario: '36,00' },
      'company-1',
    );

    const [item] = createdItems;
    expect(item.unitKind).toBe('DURATION');
    expect(item.unitCost).toBe(1); // R$ 36,00/hora = 1 centavo por segundo
    expect(item.salePrice).toBeNull();
  });

  it('importa inativo o produto fora de linha', async () => {
    // As vendas antigas apontam para ele, então ele entra — mas fora da
    // listagem, como estava no legado.
    await (service as any).importProduct(
      { ...baseRow, unidadeMedida: 'UN', ativo: 'NAO' },
      'company-1',
    );

    expect(createdProducts[0].isActive).toBe(false);
  });

  it('importa ativo quando a planilha não diz a situação', async () => {
    await (service as any).importProduct(
      { ...baseRow, unidadeMedida: 'UN' },
      'company-1',
    );

    expect(createdProducts[0].isActive).toBe(true);
  });
});

describe('ImportService employee import', () => {
  let service: ImportService;
  let created: any[];
  let updated: any[];
  let payrollSetups: any[];
  let history: any[];
  let existingEmployee: any;

  const baseRow = {
    codigoLegado: '15',
    nome: 'ANA VENDEDORA',
    cpf: '123.456.789-09',
    setor: 'Comercial',
    cargo: 'Vendedor',
    perfilVendedor: 'Vendedor Comissionado',
    salario: '7.000,00',
    ativo: 'SIM',
  };

  const byName = (rows: any[]) => ({
    findFirst: jest.fn().mockImplementation(({ where }) => {
      const wanted = where.name?.equals ?? where.name;
      return Promise.resolve(
        rows.find(
          (r) => r.name.toLowerCase() === String(wanted).toLowerCase(),
        ) || null,
      );
    }),
    findMany: jest.fn().mockResolvedValue(rows),
  });

  beforeEach(() => {
    created = [];
    updated = [];
    payrollSetups = [];
    history = [];
    existingEmployee = null;

    const prisma = {
      companySector: byName([{ id: 'sector-1', name: 'Comercial' }]),
      role: byName([{ id: 'role-1', name: 'Vendedor' }]),
      sellerProfile: byName([
        { id: 'seller-1', name: 'Vendedor Comissionado' },
      ]),
      employee: {
        findFirst: jest
          .fn()
          .mockImplementation(() => Promise.resolve(existingEmployee)),
        create: jest.fn().mockImplementation(({ data }) => {
          created.push(data);
          return Promise.resolve({ id: 'emp-1', ...data });
        }),
        update: jest.fn().mockImplementation((args) => {
          updated.push(args);
          return Promise.resolve(args.data);
        }),
      },
      payrollTemplate: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'tpl-1',
            name: 'Salário Base',
            type: 'EARNING',
            defaultAmount: 0,
          },
        ]),
      },
      payrollSetup: {
        createMany: jest.fn().mockImplementation(({ data }) => {
          payrollSetups.push(...data);
          return Promise.resolve({ count: data.length });
        }),
      },
      employeeHistory: {
        create: jest.fn().mockImplementation(({ data }) => {
          history.push(data);
          return Promise.resolve(data);
        }),
      },
      user: {
        create: jest.fn(),
      },
    };

    service = new ImportService(prisma as any, {} as any, {} as any);
  });

  it('grava o código do legado, que é a chave usada para achar o vendedor da venda', async () => {
    await (service as any).importEmployee(baseRow, 'company-1', 'import-user');

    const [employee] = created;
    expect(employee.legacyId).toBe('15');
    expect(employee.isImported).toBe(true);
    expect(employee.companyId).toBe('company-1');
  });

  it('converte o salário para centavos', async () => {
    await (service as any).importEmployee(baseRow, 'company-1', 'import-user');

    // R$ 7.000,00 → 700000 centavos (o front divide por 100 ao exibir)
    expect(created[0].sallary).toBe(700000);
  });

  it('vincula setor, cargo e perfil de vendedor mesmo com acento e caixa diferentes', async () => {
    await (service as any).importEmployee(
      { ...baseRow, setor: 'COMERCIAL', cargo: 'vendedor' },
      'company-1',
      'import-user',
    );

    const [employee] = created;
    expect(employee.sectorId).toBe('sector-1');
    expect(employee.roleId).toBe('role-1');
    expect(employee.sellerProfileId).toBe('seller-1');
  });

  it('importa colaborador desligado como inativo, sem descartá-lo', async () => {
    // Um quarto do histórico de vendas da base piloto é de gente que já saiu:
    // se o desligado não entrar, essas vendas ficam sem vendedor.
    await (service as any).importEmployee(
      { ...baseRow, codigoLegado: '6', nome: 'BRUNO DESLIGADO', ativo: 'NAO' },
      'company-1',
      'import-user',
    );

    expect(created).toHaveLength(1);
    expect(created[0].isActive).toBe(false);
    expect(created[0].legacyId).toBe('6');
  });

  it('não cria conta de usuário para o colaborador', async () => {
    await (service as any).importEmployee(baseRow, 'company-1', 'import-user');

    const [employee] = created;
    expect(employee.userId).toBeUndefined();
    expect((service as any).prisma.user.create).not.toHaveBeenCalled();
  });

  it('cria os setups de folha, como o cadastro manual faz', async () => {
    await (service as any).importEmployee(baseRow, 'company-1', 'import-user');

    expect(payrollSetups).toHaveLength(1);
    expect(payrollSetups[0]).toMatchObject({
      employeeId: 'emp-1',
      templateId: 'tpl-1',
      companyId: 'company-1',
    });
  });

  it('registra o histórico em nome da conta de importação', async () => {
    await (service as any).importEmployee(baseRow, 'company-1', 'import-user');

    expect(history).toHaveLength(1);
    expect(history[0].createdBy).toBe('import-user');
    expect(history[0].action).toBe('CREATE');
  });

  it('não sobrescreve o colaborador que a conta já tinha', async () => {
    // Cadastro adotado numa carga anterior: o vínculo com o legado está lá,
    // mas os dados são os que o cliente mantém desde que entrou no sistema.
    existingEmployee = {
      id: 'emp-do-cliente',
      legacyId: '15',
      isImported: false,
    };

    await (service as any).importEmployee(baseRow, 'company-1', 'import-user');

    expect(created).toHaveLength(0);
    expect(updated).toHaveLength(0);
  });

  it('adota o colaborador de mesmo CPF em vez de criar outro', async () => {
    // Conta que já estava em uso: a pessoa pode já ter cadastro e acesso.
    const adoption = new Map([['12345678901', 'emp-do-cliente']]);

    await (service as any).importEmployee(
      { ...baseRow, cpf: '123.456.789-01' },
      'company-1',
      'import-user',
      adoption,
    );

    expect(created).toHaveLength(0);
    expect(updated).toHaveLength(1);
    expect(updated[0].where).toEqual({ id: 'emp-do-cliente' });
    expect(updated[0].data).toEqual({ legacyId: '15' });
  });

  it('atualiza em vez de duplicar quando o mesmo arquivo é reprocessado', async () => {
    existingEmployee = {
      id: 'emp-existente',
      legacyId: '15',
      isImported: true,
    };

    await (service as any).importEmployee(baseRow, 'company-1', 'import-user');

    expect(created).toHaveLength(0);
    expect(updated).toHaveLength(1);
    expect(updated[0].where).toEqual({ id: 'emp-existente' });
    // Reprocessar não pode duplicar folha nem histórico
    expect(payrollSetups).toHaveLength(0);
    expect(history).toHaveLength(0);
  });

  it('rejeita a linha sem código do legado', async () => {
    await expect(
      (service as any).importEmployee(
        { ...baseRow, codigoLegado: '' },
        'company-1',
        'import-user',
      ),
    ).rejects.toThrow("Campo 'codigoLegado' é obrigatório");
  });
});

describe('ImportService seller lookup', () => {
  let service: ImportService;
  let queries: any[];

  const employees = [
    {
      id: 'emp-ativo',
      companyId: 'company-1',
      legacyId: '15',
      isActive: true,
      user: { email: 'ana@exemplo.com' },
    },
    {
      id: 'emp-desligado',
      companyId: 'company-1',
      legacyId: '6',
      isActive: false,
      user: { email: 'bruno@exemplo.com' },
    },
    {
      id: 'emp-fallback',
      companyId: 'company-1',
      legacyId: null,
      isActive: true,
      sellerProfileId: 'seller-1',
      user: null,
    },
  ];

  const matches = (where: any) => (e: any) => {
    if (where.companyId && e.companyId !== where.companyId) return false;
    if (where.legacyId !== undefined && e.legacyId !== where.legacyId)
      return false;
    if (where.isActive !== undefined && e.isActive !== where.isActive)
      return false;
    if (where.user?.email && e.user?.email !== where.user.email) return false;
    if (where.sellerProfileId && !e.sellerProfileId) return false;
    return true;
  };

  beforeEach(() => {
    queries = [];
    const prisma = {
      employee: {
        findFirst: jest.fn().mockImplementation(({ where }) => {
          queries.push(where);
          return Promise.resolve(employees.find(matches(where)) || null);
        }),
      },
    };
    service = new ImportService(prisma as any, {} as any, {} as any);
  });

  it('acha o vendedor pelo código do legado, sem passar por usuário', async () => {
    const seller = await (service as any).findSeller('company-1', null, '15');

    expect(seller.id).toBe('emp-ativo');
    // A consulta não pode depender de user.email: na migração não há usuários.
    expect(queries[0].user).toBeUndefined();
  });

  it('acha vendedor desligado pelo código do legado', async () => {
    // 540 das 2.176 vendas da base piloto são de gente que já saiu da empresa.
    const seller = await (service as any).findSeller('company-1', null, '6');

    expect(seller.id).toBe('emp-desligado');
    expect(queries[0].isActive).toBeUndefined();
  });

  it('não cai no vendedor padrão quando o código do legado não existe', async () => {
    // Preferimos recusar a linha a atribuir a venda para a pessoa errada.
    const seller = await (service as any).findSeller('company-1', null, '999');

    expect(seller).toBeNull();
  });

  it('dá precedência ao código do legado sobre o email', async () => {
    const seller = await (service as any).findSeller(
      'company-1',
      'ana@exemplo.com',
      '6',
    );

    expect(seller.id).toBe('emp-desligado');
  });

  it('mantém a preferência pelo vendedor ativo na busca por email', async () => {
    const seller = await (service as any).findSeller(
      'company-1',
      'ana@exemplo.com',
    );

    expect(seller.id).toBe('emp-ativo');
    expect(queries[0].isActive).toBe(true);
  });

  it('aceita vendedor desligado por email em vez de falhar', async () => {
    const seller = await (service as any).findSeller(
      'company-1',
      'bruno@exemplo.com',
    );

    expect(seller.id).toBe('emp-desligado');
    // Primeiro tenta o ativo, depois relaxa o filtro
    expect(queries[0].isActive).toBe(true);
    expect(queries[1].isActive).toBeUndefined();
  });

  it('usa o primeiro vendedor ativo quando a linha não informa vendedor', async () => {
    const seller = await (service as any).findSeller('company-1');

    expect(seller.id).toBe('emp-fallback');
  });

  it('aponta o identificador certo na mensagem de erro', () => {
    const msg = (row: any) => (service as any).sellerNotFoundMessage(row);

    expect(msg({ VendedorCodigoLegado: '99' })).toContain("código legado '99'");
    expect(msg({ VendedorEmail: 'x@y.com' })).toContain("email 'x@y.com'");
    expect(msg({})).toContain('Nenhum vendedor ativo');
  });
});

describe('ImportService client resolution', () => {
  let service: ImportService;

  const clients = [
    { id: 'cli-doc', cpf: '123.456.789-09', cnpj: null, legacyId: '100' },
    { id: 'cli-sem-doc', cpf: null, cnpj: null, legacyId: '482' },
    { id: 'cli-cnpj', cpf: null, cnpj: '11.222.333/0001-81', legacyId: null },
  ];

  let findManyCalls: number;

  beforeEach(() => {
    findManyCalls = 0;
    const prisma = {
      client: {
        findMany: jest.fn().mockImplementation(() => {
          findManyCalls++;
          return Promise.resolve(clients);
        }),
      },
    };
    service = new ImportService(prisma as any, {} as any, {} as any);
  });

  it('acha cliente sem documento pelo código do legado', async () => {
    // 283 dos 956 clientes da base piloto não têm CPF nem CNPJ; sem esta chave,
    // 408 vendas ficariam sem vínculo possível.
    const index = await (service as any).buildClientIndex('company-1');
    const client = (service as any).resolveClient(index, {
      ClienteCodigoLegado: '482',
    });

    expect(client.id).toBe('cli-sem-doc');
  });

  it('acha cliente por documento com ou sem pontuação', async () => {
    const index = await (service as any).buildClientIndex('company-1');

    expect(
      (service as any).resolveClient(index, {
        ClienteCpfCnpj: '123.456.789-09',
      }).id,
    ).toBe('cli-doc');

    expect(
      (service as any).resolveClient(index, { ClienteCpfCnpj: '12345678909' })
        .id,
    ).toBe('cli-doc');

    expect(
      (service as any).resolveClient(index, {
        ClienteCpfCnpj: '11222333000181',
      }).id,
    ).toBe('cli-cnpj');
  });

  it('dá precedência ao código do legado sobre o documento', async () => {
    const index = await (service as any).buildClientIndex('company-1');
    const client = (service as any).resolveClient(index, {
      ClienteCodigoLegado: '482',
      ClienteCpfCnpj: '123.456.789-09',
    });

    expect(client.id).toBe('cli-sem-doc');
  });

  it('não casa documento parcial', async () => {
    // A busca anterior usava `contains`, que podia trazer o cliente errado
    // quando um documento era substring de outro.
    const index = await (service as any).buildClientIndex('company-1');

    expect(
      (service as any).resolveClient(index, { ClienteCpfCnpj: '1234567' }),
    ).toBeNull();
  });

  it('lê a base de clientes uma vez só, não a cada linha', async () => {
    const index = await (service as any).buildClientIndex('company-1');

    for (let i = 0; i < 50; i++) {
      (service as any).resolveClient(index, { ClienteCodigoLegado: '482' });
    }

    expect(findManyCalls).toBe(1);
  });

  it('aponta o identificador certo na mensagem de erro', () => {
    const msg = (row: any) => (service as any).clientNotFoundMessage(row);

    expect(msg({ ClienteCodigoLegado: '999' })).toContain(
      "código legado '999'",
    );
    expect(msg({ ClienteCpfCnpj: '123' })).toContain("CPF/CNPJ '123'");
  });
});

describe('ImportService CSV schema rules', () => {
  it('reduz o documento a dígitos no validador — o regex antigo zerava o valor', () => {
    // /[^\d]/g significa "nem barra invertida, nem a letra d": devolvia string
    // vazia, e a consulta com `contains: ''` casava com qualquer cliente.
    const field = QUOTATION_IMPORT_SCHEMA.fields.find(
      (f: any) => f.name === 'ClienteCpfCnpj',
    );

    expect(field.required).toBe(false);
    expect(field.validate.length).toBeGreaterThanOrEqual(4);
  });

  it('exige ao menos um identificador de cliente por linha', async () => {
    for (const schema of [QUOTATION_IMPORT_SCHEMA, ORDER_IMPORT_SCHEMA]) {
      expect(await schema.validateRow({})).toContain('ClienteCodigoLegado');
      expect(await schema.validateRow({ ClienteCpfCnpj: '123' })).toBeNull();
      expect(
        await schema.validateRow({ ClienteCodigoLegado: '482' }),
      ).toBeNull();
    }
  });
});

describe('ImportService payment condition resolution', () => {
  let service: ImportService;

  // Espelha o cadastro real da base piloto: "À prazo" existe duas vezes, com
  // custos financeiros diferentes.
  const conditions = [
    { id: 'pc-1', name: 'à vista', legacyId: '1', costParc: 0 },
    { id: 'pc-2', name: 'À prazo', legacyId: '2', costParc: 5.0 },
    { id: 'pc-3', name: 'À prazo', legacyId: '3', costParc: 3.9 },
    { id: 'pc-4', name: 'à Combinar', legacyId: '4', costParc: 0 },
  ];

  beforeEach(() => {
    const prisma = {
      paymentCondition: {
        findMany: jest.fn().mockResolvedValue(conditions),
      },
    };
    service = new ImportService(prisma as any, {} as any, {} as any);
  });

  const index = async () =>
    (service as any).buildPaymentConditionIndex('company-1');

  it('recusa nome ambíguo em vez de escolher em silêncio', async () => {
    const idx = await index();

    expect(() =>
      (service as any).resolvePaymentCondition(idx, {
        CondicaoPagamento: 'À prazo',
      }),
    ).toThrow(/ambígua \(2 cadastradas/);
  });

  it('resolve pelo código do legado quando o nome é ambíguo', async () => {
    const idx = await index();

    const condition = (service as any).resolvePaymentCondition(idx, {
      CondicaoPagamento: 'À prazo',
      CondicaoPagamentoCodigoLegado: '3',
    });

    expect(condition.id).toBe('pc-3');
    expect(condition.costParc).toBe(3.9);
  });

  it('resolve por nome único, ignorando caixa', async () => {
    const idx = await index();

    expect(
      (service as any).resolvePaymentCondition(idx, {
        CondicaoPagamento: 'À VISTA',
      }).id,
    ).toBe('pc-1');
  });

  it('falha quando o código do legado não existe', async () => {
    const idx = await index();

    expect(() =>
      (service as any).resolvePaymentCondition(idx, {
        CondicaoPagamentoCodigoLegado: '99',
      }),
    ).toThrow(/código legado '99' não encontrada/);
  });

  it('usa a primeira condição ativa quando a linha não informa nada', async () => {
    const idx = await index();

    expect((service as any).resolvePaymentCondition(idx, {}).id).toBe('pc-1');
  });

  it('lê as condições uma vez só', async () => {
    const idx = await index();

    for (let i = 0; i < 30; i++) {
      (service as any).resolvePaymentCondition(idx, {
        CondicaoPagamentoCodigoLegado: '2',
      });
    }

    expect(
      (service as any).prisma.paymentCondition.findMany,
    ).toHaveBeenCalledTimes(1);
  });
});

describe('ImportService commission payable', () => {
  let service: ImportService;
  let payables: any[];

  const quotation = {
    id: 'quo-1',
    quotationNumber: 2154,
    createdAt: new Date('2026-08-01T12:00:00Z'),
  };
  const series = { code: 'T1' };

  beforeEach(() => {
    payables = [];
    const prisma = {
      employee: {
        findFirst: jest
          .fn()
          .mockImplementation(({ where }) =>
            Promise.resolve(where.legacyId === '15' ? { id: 'emp-ana' } : null),
          ),
      },
      supplier: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      nature: { findFirst: jest.fn().mockResolvedValue({ id: 'nat-1' }) },
      subCategory: { findFirst: jest.fn().mockResolvedValue({ id: 'sub-1' }) },
      bankAccount: { findFirst: jest.fn().mockResolvedValue({ id: 'bank-1' }) },
      payable: {
        create: jest.fn().mockImplementation(({ data }) => {
          payables.push(data);
          return Promise.resolve({ id: 'pay-1', ...data });
        }),
      },
      payableInstallment: { create: jest.fn().mockResolvedValue({}) },
    };
    service = new ImportService(prisma as any, {} as any, {} as any);
  });

  it('lança a comissão no colaborador, sem exigir cadastro de fornecedor', async () => {
    // Os 1.840 registros de comissão do legado apontam para colaborador
    // interno: cadastrá-los como fornecedor criaria pessoas falsas na base.
    await (service as any).createOrderCommissionPayable(
      quotation,
      { ComissaoVendedorCodigoLegado: '15' },
      'company-1',
      series,
      50000,
    );

    const [payable] = payables;
    expect(payable.employeeId).toBe('emp-ana');
    expect(payable.supplierId).toBeNull();
    expect(payable.expenseSource).toBe('EMPLOYEE');
    expect(payable.financialType).toBe('COMMISSION');
  });

  it('falha quando o comissionado não é encontrado, em vez de descartar o valor', async () => {
    await expect(
      (service as any).createOrderCommissionPayable(
        quotation,
        { ComissaoVendedorCodigoLegado: '999' },
        'company-1',
        series,
        50000,
      ),
    ).rejects.toThrow(/código legado '999' não encontrado/);

    expect(payables).toHaveLength(0);
  });

  it('mantém o caminho de fornecedor externo', async () => {
    (service as any).prisma.supplier.findFirst = jest
      .fn()
      .mockResolvedValue({ id: 'sup-1' });

    await (service as any).createOrderCommissionPayable(
      quotation,
      { ComissaoFornecedorCpfCnpj: '11.222.333/0001-81' },
      'company-1',
      series,
      50000,
    );

    const [payable] = payables;
    expect(payable.supplierId).toBe('sup-1');
    expect(payable.employeeId).toBeNull();
    expect(payable.expenseSource).toBe('SUPPLIER');
  });
});

describe('ImportService item measurements', () => {
  const service = new ImportService({} as any, {} as any, {} as any);
  const toMm = (v: any) => (service as any).toMillimeters(v);

  it('converte metros do legado para milímetros do banco', () => {
    // A coluna do legado está em metros, com três casas decimais. O PDF do
    // sistema antigo comprova: imprime "( 0.100 x 0.100 - 0.01m² )", e só em
    // metros 0,1 × 0,1 dá 0,01 m² — em milímetros seria praticamente zero.
    // O extrator emite com vírgula para o ponto decimal não ser confundido
    // com separador de milhar.
    expect(toMm('3,500')).toBeCloseTo(3500, 6);
    expect(toMm('0,100')).toBeCloseTo(100, 6);
    expect(toMm('10,710')).toBeCloseTo(10710, 6);
  });

  it('devolve nulo quando a linha não informa medida', () => {
    // Assim o chamador cai na dimensão cadastrada no produto.
    expect(toMm('')).toBeNull();
    expect(toMm(null)).toBeNull();
    expect(toMm('0')).toBeNull();
    expect(toMm('abc')).toBeNull();
  });
});

describe('ImportService unit cost per line', () => {
  const service = new ImportService({} as any, {} as any, {} as any);
  const unitCost = (...args: any[]) =>
    (service as any).unitCostForLine(...args);

  it('em unidade avulsa, a taxa é o próprio valor da linha', () => {
    // A tela recalcula unitCost = salePrice / medida ao abrir o item. Se o
    // gravado divergir, abrir a linha troca o valor da venda pelo do catálogo.
    expect(unitCost(419000, 'UNITY', {}, 1)).toBe(419000);
    // 250 unidades a R$ 0,40 somam R$ 100,00 na linha
    expect(unitCost(10000, 'UNITY', {}, 250)).toBe(40);
  });

  it('em área, a quantidade entra uma vez só na medida total', () => {
    // A tela multiplica a medida unitária pela quantidade da linha. Gravar a
    // quantidade também na composição elevava a medida ao quadrado: 250
    // unidades viravam 62.500.
    const taxa = unitCost(10000, 'AREA', { width: 100, height: 100 }, 250);

    expect(taxa! * 100 * 100 * 250).toBeCloseTo(10000, 6);
  });

  it('em área, a taxa é o valor dividido pela medida', () => {
    // 10,71 m × 1,90 m = 20.349.000 mm²
    const taxa = unitCost(193315, 'AREA', { width: 10710, height: 1900 }, 1);

    expect(taxa! * 10710 * 1900).toBeCloseTo(193315, 6);
  });

  it('cai no valor da linha quando não há medida', () => {
    expect(unitCost(50000, 'AREA', { width: 0, height: 0 }, 1)).toBe(50000);
  });

  it('preserva nulo', () => {
    expect(unitCost(null, 'UNITY', {}, 1)).toBeNull();
  });
});

/**
 * Data que veio do legado ou da planilha: o documento migrado tem que aparecer
 * no dia em que a venda aconteceu, não no dia da migração — e o mesmo dia na
 * lista, na tela do documento e no PDF.
 */
describe('ImportService legacy dates', () => {
  const service = new ImportService({} as any, {} as any, {} as any);
  const toDayDate = (value: string) => (service as any).toDayDate(value);

  it('grava a data de um dia só ao meio-dia UTC', () => {
    // Meia-noite UTC é o dia anterior às 21h no fuso do Brasil: a tela do
    // documento e o PDF mostravam um dia a menos que a lista, que lê em UTC.
    expect(toDayDate('2024-05-10').toISOString()).toBe(
      '2024-05-10T12:00:00.000Z',
    );
  });

  it('não mexe no valor que já traz horário', () => {
    expect(toDayDate('2024-05-10T08:30:00.000Z').toISOString()).toBe(
      '2024-05-10T08:30:00.000Z',
    );
  });
});

/**
 * Produto na migração: o vínculo com o legado é o que identifica o registro
 * criado pela carga. Procurar só pelo código quebrava quando o cliente mudava
 * o código depois — a carga tentava criar de novo e batia na chave do legado.
 */
describe('ImportService product legacy link', () => {
  let prisma: any;
  let service: ImportService;

  const row = { codigo: 'TEL', nome: 'TELHA T25', setor: 'ALMOXARIFADO' };

  const buildService = (produtos: any[]) => {
    prisma = {
      companySector: {
        findFirst: jest.fn().mockResolvedValue({ id: 'sector-1' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      category: {
        findFirst: jest.fn().mockResolvedValue({ id: 'cat-1' }),
      },
      product: {
        findFirst: jest.fn().mockImplementation(({ where }) => {
          if (where.legacyId) {
            return Promise.resolve(
              produtos.find((p) => p.legacyId === where.legacyId) ?? null,
            );
          }
          const code = where.code?.equals ?? where.code;
          return Promise.resolve(
            produtos.find(
              (p) => p.code.toLowerCase() === String(code).toLowerCase(),
            ) ?? null,
          );
        }),
        // Candidatos à adoção por nome: só os que ainda não têm vínculo com
        // o legado, como faz findProductToAdoptByName.
        findMany: jest
          .fn()
          .mockResolvedValue(produtos.filter((p: any) => !p.legacyId)),
        create: jest.fn().mockResolvedValue({ id: 'prod-novo' }),
        update: jest.fn().mockResolvedValue({ id: 'prod-1' }),
      },
      defaultUnitOfMeasure: {
        findFirst: jest.fn().mockResolvedValue({ id: 'uom-un', kind: 'UNITY' }),
      },
      productItem: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
    };

    service = new ImportService(
      prisma as any,
      {} as any,
      { getOrCreateWithDefaults: jest.fn().mockResolvedValue({}) } as any,
    );
  };

  const importar = (extra: Record<string, string> = {}) =>
    (service as any).importProduct({ ...row, ...extra }, 'company-1', {
      legacy: true,
    });

  it('acha o produto da migração pelo código do legado, mesmo com o código trocado', async () => {
    // O cliente renomeou o código depois da carga anterior. Sem o vínculo, a
    // carga criava de novo e estourava a chave (companyId, legacyId).
    buildService([
      { id: 'prod-1', code: 'TEL-NOVO', legacyId: 'TEL', isImported: true },
    ]);

    await importar();

    expect(prisma.product.create).not.toHaveBeenCalled();
    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'prod-1' } }),
    );
  });

  it('a recarga não sobrescreve o produto que uma carga anterior adotou', async () => {
    // Na Terabyte, o "Banner" de exemplo da conta foi adotado para o "Banner"
    // do legado. A adoção só grava o vínculo; a recarga também não pode trocar
    // nome, setor, unidade e preço pelos do legado.
    buildService([
      { id: 'prod-conta', code: 'BANNER', legacyId: 'TEL', isImported: false },
    ]);

    await importar({ ativo: 'NAO' });

    expect(prisma.product.create).not.toHaveBeenCalled();
    expect(prisma.product.update).not.toHaveBeenCalled();
    expect(prisma.productItem.create).not.toHaveBeenCalled();
  });

  it('a recarga leva a situação do legado ao produto que a migração criou', async () => {
    buildService([
      { id: 'prod-1', code: 'TEL', legacyId: 'TEL', isImported: true },
    ]);

    await importar({ ativo: 'NAO' });

    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isActive: false }),
      }),
    );
  });

  it('sem a coluna de situação, a recarga não mexe nela', async () => {
    buildService([
      { id: 'prod-1', code: 'TEL', legacyId: 'TEL', isImported: true },
    ]);

    await importar();

    const [[{ data }]] = prisma.product.update.mock.calls;
    expect(data).not.toHaveProperty('isActive');
  });

  it('adota o produto do cliente que tem o mesmo código, sem tocar nele', async () => {
    buildService([{ id: 'prod-cliente', code: 'tel', legacyId: null }]);

    await importar();

    expect(prisma.product.create).not.toHaveBeenCalled();
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('cria com o código do legado quando a conta não tem o produto', async () => {
    buildService([]);

    await importar();

    expect(prisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ code: 'TEL', legacyId: 'TEL' }),
      }),
    );
  });
});

/**
 * Desconto do item no documento migrado: o legado guarda o valor cheio e o
 * desconto em colunas separadas. O orçamento ignorava o desconto e a ordem o
 * lia em reais, tirando R$ 1,00 de um desconto de R$ 100,00.
 */
describe('ImportService line discount', () => {
  const service = new ImportService({} as any, {} as any, {} as any);
  const lineValues = (item: any) => (service as any).lineValues(item);

  it('desconta o valor do item, em centavos', () => {
    expect(lineValues({ ValorTotal: '500,00', Desconto: '100,00' })).toEqual({
      totalValue: 50000,
      discount: 10000,
      finalValue: 40000,
    });
  });

  it('mantém o valor cheio quando não há desconto', () => {
    expect(lineValues({ ValorTotal: '500,00', Desconto: '' })).toEqual({
      totalValue: 50000,
      discount: 0,
      finalValue: 50000,
    });
  });

  it('aceita o decimal com ponto que vem do legado', () => {
    expect(lineValues({ ValorTotal: '1690.50', Desconto: '250.50' })).toEqual({
      totalValue: 169050,
      discount: 25050,
      finalValue: 144000,
    });
  });
});

/**
 * O cliente segue trabalhando no legado entre a primeira carga e a virada: o
 * orçamento vira ordem de serviço, o valor muda. A recarga pulava o documento
 * por já existir, e a conta nova ficava congelada no estado da primeira carga.
 */
describe('ImportService refresh of migrated sales', () => {
  let prisma: any;
  let service: ImportService;

  const build = (quotation: any) => {
    prisma = {
      quotation: {
        findUnique: jest.fn().mockResolvedValue(quotation),
        deleteMany: jest.fn().mockResolvedValue({}),
      },
      quotationPayment: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({}),
      },
      receivable: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({}),
      },
      payable: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({}),
      },
      order: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({}),
      },
      receivableHistory: { deleteMany: jest.fn().mockResolvedValue({}) },
      receivableInstallment: { deleteMany: jest.fn().mockResolvedValue({}) },
      payableHistory: { deleteMany: jest.fn().mockResolvedValue({}) },
      payableInstallment: { deleteMany: jest.fn().mockResolvedValue({}) },
      commission: { deleteMany: jest.fn().mockResolvedValue({}) },
      orderHistory: { deleteMany: jest.fn().mockResolvedValue({}) },
      quotationInstallment: { deleteMany: jest.fn().mockResolvedValue({}) },
      quotationProductItem: { deleteMany: jest.fn().mockResolvedValue({}) },
      quotationProduct: { deleteMany: jest.fn().mockResolvedValue({}) },
      deliveryInfo: { deleteMany: jest.fn().mockResolvedValue({}) },
      deliverySchedule: { deleteMany: jest.fn().mockResolvedValue({}) },
      quotationHistory: { deleteMany: jest.fn().mockResolvedValue({}) },
    };

    service = new ImportService(prisma as any, {} as any, {} as any);
  };

  const semNotas = { nfes: 0, nfces: 0, nfses: 0 };

  const refresh = (expected: any) =>
    (service as any).refreshImportedSale('quotation-1', expected);

  it('pula o documento que não mudou', async () => {
    build({ totalValue: 40000, order: null, _count: semNotas });

    await expect(
      refresh({ hasOrder: false, totalValue: 40000 }),
    ).resolves.toMatchObject({ estado: 'unchanged' });
    expect(prisma.quotation.deleteMany).not.toHaveBeenCalled();
  });

  it('atualiza o orçamento que virou ordem de serviço no legado', async () => {
    build({ totalValue: 40000, order: null, _count: semNotas });

    await expect(
      refresh({ hasOrder: true, totalValue: 40000 }),
    ).resolves.toMatchObject({
      estado: 'refreshed',
      // O documento é recriado com o mesmo id: quem está com a tela aberta
      // continua olhando para o mesmo documento.
      reuse: { quotationId: 'quotation-1', orderId: null },
    });
    expect(prisma.quotation.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['quotation-1'] } },
    });
  });

  it('atualiza o documento cujo valor mudou', async () => {
    // É o caso do desconto: a carga antiga gravou o valor cheio.
    build({ totalValue: 50000, order: null, _count: semNotas });

    await expect(
      refresh({ hasOrder: false, totalValue: 40000 }),
    ).resolves.toMatchObject({ estado: 'refreshed' });
  });

  it('recusa quando já há nota fiscal no documento', async () => {
    // Apagar para reimportar levaria a nota junto.
    build({
      totalValue: 50000,
      order: null,
      _count: { nfes: 1, nfces: 0, nfses: 0 },
    });

    await expect(
      refresh({ hasOrder: false, totalValue: 40000 }),
    ).resolves.toMatchObject({ estado: 'blocked' });
    expect(prisma.quotation.deleteMany).not.toHaveBeenCalled();
  });

  it('recusa quando a nota está na ordem de serviço', async () => {
    build({
      totalValue: 50000,
      order: { id: 'order-1', _count: { nfes: 0, nfces: 2, nfses: 0 } },
      _count: semNotas,
    });

    await expect(
      refresh({ hasOrder: true, totalValue: 40000 }),
    ).resolves.toMatchObject({ estado: 'blocked' });
  });

  it('reaproveita o id da ordem de serviço', () => {
    // A lista e o link da O.S. apontam para o id da ordem; trocá-lo deixaria a
    // tela aberta do usuário apontando para um documento que não existe mais.
    build({
      totalValue: 50000,
      order: { id: 'order-1', _count: { nfes: 0, nfces: 0, nfses: 0 } },
      _count: semNotas,
    });

    return expect(
      refresh({ hasOrder: true, totalValue: 40000 }),
    ).resolves.toMatchObject({
      estado: 'refreshed',
      reuse: { quotationId: 'quotation-1', orderId: 'order-1' },
    });
  });

  it('soma o valor esperado do documento com o desconto das linhas', () => {
    const total = (service as any).expectedSaleTotal([
      { ValorTotal: '500,00', Desconto: '100,00' },
      { ValorTotal: '250,00', Desconto: '' },
    ]);

    expect(total).toBe(65000);
  });
});

/**
 * Linha da O.S. migrada. A carga de orçamento sempre gravou a unidade do
 * produto na linha; a de O.S. não gravava. Com o produto por m², a taxa sai
 * por mm² e a tela lia a linha como unidade avulsa: mostrava a taxa por mm²
 * como preço da peça.
 */
describe('ImportService migrated order lines', () => {
  it('grava na linha da O.S. a unidade do produto, como no orçamento', async () => {
    const linhas: any[] = [];

    // Banco de mentira: qualquer leitura volta vazia e qualquer gravação
    // devolve um registro. Só o produto e as linhas importam aqui.
    const model = (name: string) =>
      new Proxy(
        {},
        {
          get: (_target, method: string) => {
            if (name === 'product' && method === 'findUnique') {
              return jest.fn().mockResolvedValue({
                id: 'prod-1',
                name: 'BANNER',
                technicalDescription: null,
                items: [
                  {
                    id: 'item-1',
                    name: 'BANNER',
                    unitKind: 'AREA',
                    width: null,
                    height: null,
                    length: null,
                    weight: null,
                    volume: null,
                    distance: null,
                    duration: null,
                  },
                ],
              });
            }
            if (name === 'quotationProductItem' && method === 'create') {
              return jest.fn().mockImplementation(({ data }) => {
                linhas.push(data);
                return Promise.resolve({ id: 'linha-1' });
              });
            }
            if (method === 'findMany' || method === 'groupBy') {
              return jest.fn().mockResolvedValue([]);
            }
            if (method === 'count') return jest.fn().mockResolvedValue(0);
            if (method.startsWith('find')) {
              return jest.fn().mockResolvedValue(null);
            }
            return jest.fn().mockResolvedValue({ id: `${name}-1` });
          },
        },
      );

    const prisma: any = new Proxy(
      {},
      {
        get: (_target, name: string) =>
          name === '$transaction'
            ? (arg: any) =>
                Array.isArray(arg) ? Promise.all(arg) : arg(prisma)
            : model(name),
      },
    );

    const service = new ImportService(prisma, {} as any, {} as any);
    const internals = service as any;
    jest.spyOn(internals, 'buildClientIndex').mockResolvedValue({});
    jest.spyOn(internals, 'buildPaymentConditionIndex').mockResolvedValue({});
    jest
      .spyOn(internals, 'resolveImportSeries')
      .mockResolvedValue({ id: 'serie-1', code: '1' });
    jest
      .spyOn(internals, 'resolveClient')
      .mockReturnValue({ id: 'cliente-1', name: 'Cliente' });
    jest
      .spyOn(internals, 'findSeller')
      .mockResolvedValue({ id: 'vendedor-1', name: 'Vendedor' });
    jest.spyOn(internals, 'resolvePaymentCondition').mockReturnValue(null);

    // 2 peças de 1,00 × 0,50 m por R$ 60,00 (R$ 60,00/m²).
    await internals.importOrders(
      [
        {
          NumeroVenda: '10',
          Serie: '1',
          DataVenda: '2026-01-10',
          ClienteCodigoLegado: '5',
          VendedorCodigoLegado: '2',
          ProdutoCodigo: 'BAN06',
          ProdutoNome: 'BANNER',
          ItemLargura: '1,000',
          ItemComprimento: '0,500',
          Quantidade: '2',
          ValorUnitario: '30,00',
          ValorTotal: '60,00',
          Desconto: '',
          StatusOrdem: 'FINISHED',
        },
      ],
      'company-1',
      { skipReceivable: true },
    );

    expect(linhas).toHaveLength(1);
    expect(linhas[0].unitKind).toBe('AREA');
    // A tela multiplica a taxa pela área e pela quantidade da linha.
    expect(linhas[0].unitCost * 1000 * 500 * 2).toBeCloseTo(6000, 6);
  });
});
