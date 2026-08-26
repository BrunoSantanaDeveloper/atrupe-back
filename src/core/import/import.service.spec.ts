import { ImportService } from './import.service';

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

  const baseRow = {
    codigo: 'TEL',
    nome: 'TELHA T25',
    setor: 'ALMOXARIFADO',
    grupo: 'Chapas',
  };

  beforeEach(() => {
    createdItems = [];

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
        create: jest.fn().mockResolvedValue({ id: 'prod-1' }),
      },
      defaultUnitOfMeasure: {
        findFirst: jest
          .fn()
          .mockImplementation(({ where }) =>
            Promise.resolve(
              where.code === 'M2'
                ? { id: 'uom-m2', kind: 'AREA' }
                : { id: 'uom-un', kind: 'UNITY' },
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
});
