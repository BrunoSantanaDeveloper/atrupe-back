import { BadRequestException } from '@nestjs/common';
import {
  MaterialImportService,
  NEW_WITHOUT_SECTOR,
  classifyImportRow,
} from './material-import.service';

const known = (id: string, name: string, searchName: string) => ({
  id,
  name,
  searchName,
});

const registry = () => {
  const metalon = known('m-metalon', 'Metalon 50 × 30', 'metalon 50 × 30');
  const lona = known('m-lona', 'Lona 440', 'lona 440');
  return {
    byName: new Map([
      [metalon.searchName, metalon],
      [lona.searchName, lona],
    ]),
    byId: new Map([
      [metalon.id, metalon],
      [lona.id, lona],
    ]),
    links: new Map([['metalon 50x30', 'm-metalon']]),
    sectors: new Map([
      ['serralheria', 's-3'],
      ['impressao', 's-1'],
    ]),
  };
};

describe('conciliação da importação de materiais', () => {
  it('linha sem nome é inválida', () => {
    expect(
      classifyImportRow({ name: '  ', unit: 'm', cost: 100 }, 4, registry()),
    ).toMatchObject({ line: 4, status: 'INVALID', problem: 'Linha sem nome' });
  });

  it('unidade fora da tabela é inválida, com a unidade na mensagem', () => {
    expect(
      classifyImportRow(
        { name: 'Fita', unit: 'caixa', sector: 'Impressão' },
        2,
        registry(),
      ),
    ).toMatchObject({
      status: 'INVALID',
      unitKey: null,
      problem: 'Unidade "caixa" não reconhecida (use m², m, un, kg, l)',
    });
  });

  it('setor informado e não cadastrado é inválido', () => {
    expect(
      classifyImportRow(
        { name: 'Fita', unit: 'un', sector: 'Marcenaria' },
        2,
        registry(),
      ),
    ).toMatchObject({
      status: 'INVALID',
      problem: 'Setor "Marcenaria" não cadastrado',
    });
  });

  it('o de-para aprendido vale antes do nome', () => {
    expect(
      classifyImportRow(
        {
          name: 'METALON 50x30',
          unit: 'ml',
          sector: 'Serralheria',
          cost: 1900,
        },
        3,
        registry(),
      ),
    ).toEqual({
      line: 3,
      name: 'METALON 50x30',
      unit: 'ml',
      sector: 'Serralheria',
      cost: 1900,
      status: 'LINKED',
      materialId: 'm-metalon',
      materialName: 'Metalon 50 × 30',
      unitKey: 'M',
      sectorId: 's-3',
    });
  });

  it('o nome igual, sem caixa e sem acento, é "já cadastrado"', () => {
    expect(
      classifyImportRow({ name: ' LONÁ  440 ', unit: 'm²' }, 1, registry()),
    ).toMatchObject({
      status: 'MATCH',
      materialId: 'm-lona',
      materialName: 'Lona 440',
      unitKey: 'M2',
    });
  });

  it('o de-para para material que saiu do cadastro ativo não vale', () => {
    const base = registry();
    base.byId.delete('m-metalon');
    base.byName.delete('metalon 50 × 30');

    expect(
      classifyImportRow(
        { name: 'Metalon 50x30', unit: 'm', sector: 'Serralheria' },
        1,
        base,
      ),
    ).toMatchObject({ status: 'NEW', materialId: null });
  });

  it('o que não existe é novo; sem setor, vem o aviso', () => {
    expect(
      classifyImportRow(
        { name: 'Fita dupla face', unit: 'un', sector: 'impressao' },
        5,
        registry(),
      ),
    ).toMatchObject({ status: 'NEW', sectorId: 's-1', materialId: null });

    const semSetor = classifyImportRow(
      { name: 'Fita dupla face', unit: 'un' },
      5,
      registry(),
    );
    expect(semSetor).toMatchObject({
      status: 'NEW',
      sectorId: null,
      problem: NEW_WITHOUT_SECTOR,
    });
  });
});

describe('MaterialImportService', () => {
  let prisma: any;
  let service: MaterialImportService;

  const target = (over: Record<string, unknown> = {}) => ({
    id: 'm-metalon',
    searchName: 'metalon 50 × 30',
    priceRule: 'FIXED',
    cost: 1850,
    price: null,
    desiredMargin: null,
    _count: { variations: 0 },
    ...over,
  });

  beforeEach(() => {
    let created = 0;
    prisma = {
      material: {
        findMany: jest.fn(async ({ where }: any) =>
          where.id
            ? [target()]
            : [known('m-metalon', 'Metalon 50 × 30', 'metalon 50 × 30')],
        ),
        aggregate: jest.fn().mockResolvedValue({ _max: { number: 7 } }),
        create: jest.fn(async () => ({ id: `novo-${++created}` })),
        update: jest.fn().mockResolvedValue({}),
      },
      materialImportLink: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
      },
      companySector: {
        findMany: jest.fn().mockResolvedValue([
          { id: 's-3', name: 'Serralheria' },
          { id: 's-2', name: 'Produção' },
        ]),
      },
    };
    prisma.$executeRaw = jest.fn().mockResolvedValue(1);
    prisma.$transaction = jest.fn(async (run: any) => run(prisma));
    service = new MaterialImportService(prisma, {
      chargesOf: jest.fn(async () => ({
        taxation: 0,
        financialCost: 0,
        commission: 0,
      })),
    } as any);
  });

  it('a prévia concilia sem gravar e não expõe o id do setor', async () => {
    const { data } = await service.preview('c-1', [
      { name: 'Metalon 50 × 30', unit: 'm', sector: 'Serralheria', cost: 1900 },
      { name: '', unit: 'm' },
    ]);

    expect(data).toEqual([
      {
        line: 1,
        name: 'Metalon 50 × 30',
        unit: 'm',
        sector: 'Serralheria',
        cost: 1900,
        status: 'MATCH',
        materialId: 'm-metalon',
        materialName: 'Metalon 50 × 30',
        unitKey: 'M',
      },
      {
        line: 2,
        name: '',
        unit: 'm',
        sector: '',
        cost: null,
        status: 'INVALID',
        materialId: null,
        materialName: null,
        unitKey: 'M',
        problem: 'Linha sem nome',
      },
    ]);
    expect(prisma.material.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'c-1', active: true } }),
    );
    expect(prisma.material.create).not.toHaveBeenCalled();
    expect(prisma.material.update).not.toHaveBeenCalled();
    expect(prisma.materialImportLink.upsert).not.toHaveBeenCalled();
  });

  it('atualiza o vinculado, guarda o de-para e cadastra o novo', async () => {
    const result = await service.apply('c-1', [
      {
        name: 'Metalon 50x30',
        unit: 'ml',
        sector: 'Serralheria',
        cost: 1900,
        materialId: 'm-metalon',
      },
      {
        name: 'Fita dupla face',
        unit: 'un',
        sector: 'Produção',
        cost: 450,
        materialId: null,
      },
    ]);

    expect(result).toEqual({ created: 1, updated: 1, ignored: 0 });
    // O nome de fora difere do cadastro: da próxima vez o sistema já sabe
    expect(prisma.materialImportLink.upsert).toHaveBeenCalledWith({
      where: {
        companyId_externalName: {
          companyId: 'c-1',
          externalName: 'metalon 50x30',
        },
      },
      create: {
        companyId: 'c-1',
        externalName: 'metalon 50x30',
        materialId: 'm-metalon',
      },
      update: { materialId: 'm-metalon' },
    });
    expect(prisma.material.update).toHaveBeenCalledWith({
      where: { id: 'm-metalon' },
      data: { cost: 1900, costUpdatedAt: expect.any(Date) },
    });
    expect(prisma.material.create.mock.calls[0][0].data).toMatchObject({
      companyId: 'c-1',
      number: 8,
      code: 'MAT-08',
      name: 'Fita dupla face',
      searchName: 'fita dupla face',
      sectorId: 's-2',
      subcategory: 'Importados',
      unit: 'UN',
      directSale: false,
      productionMaterial: true,
      priceRule: 'VARIABLE',
      cost: 450,
    });
  });

  it('o nome igual ao do cadastro não vira de-para', async () => {
    await service.apply('c-1', [
      {
        name: 'METALON 50 × 30',
        unit: 'm',
        cost: 1850,
        materialId: 'm-metalon',
      },
    ]);

    expect(prisma.materialImportLink.upsert).not.toHaveBeenCalled();
    // O custo é o mesmo: nada a gravar
    expect(prisma.material.update).not.toHaveBeenCalled();
  });

  it('material com variação não recebe custo pela planilha', async () => {
    prisma.material.findMany.mockImplementation(async ({ where }: any) =>
      where.id
        ? [target({ cost: null, _count: { variations: 2 } })]
        : [known('m-metalon', 'Metalon 50 × 30', 'metalon 50 × 30')],
    );

    const result = await service.apply('c-1', [
      {
        name: 'Metalon 50 × 30',
        unit: 'm',
        cost: 1900,
        materialId: 'm-metalon',
      },
    ]);

    expect(result).toEqual({ created: 0, updated: 1, ignored: 0 });
    expect(prisma.material.update).not.toHaveBeenCalled();
  });

  it('no preço variável, o custo da planilha refaz o preço', async () => {
    prisma.material.findMany.mockImplementation(async ({ where }: any) =>
      where.id
        ? [
            target({
              priceRule: 'VARIABLE',
              cost: 1250,
              price: 1786,
              desiredMargin: 300,
            }),
          ]
        : [known('m-metalon', 'Metalon 50 × 30', 'metalon 50 × 30')],
    );

    await service.apply('c-1', [
      {
        name: 'Metalon 50 × 30',
        unit: 'm',
        cost: 1400,
        materialId: 'm-metalon',
      },
    ]);

    expect(prisma.material.update).toHaveBeenCalledWith({
      where: { id: 'm-metalon' },
      data: { cost: 1400, costUpdatedAt: expect.any(Date), price: 2000 },
    });
  });

  it('linha inválida e material novo sem setor contam como ignorados', async () => {
    const result = await service.apply('c-1', [
      { name: '', unit: 'un', cost: 10, materialId: null },
      { name: 'Cola', unit: 'tubo', sector: 'Produção', materialId: null },
      { name: 'Cola branca', unit: 'un', materialId: null },
      { name: 'Verniz', unit: 'l', sector: 'Produção', materialId: null },
    ]);

    expect(result).toEqual({ created: 1, updated: 0, ignored: 3 });
    expect(prisma.material.create).toHaveBeenCalledTimes(1);
  });

  it('os novos recebem códigos em sequência, e o nome repetido não duplica', async () => {
    const result = await service.apply('c-1', [
      { name: 'Verniz', unit: 'l', sector: 'Produção', cost: 3000 },
      { name: 'Cola branca', unit: 'un', sector: 'Produção', cost: 800 },
      { name: 'VERNIZ', unit: 'l', sector: 'Produção', cost: 3200 },
    ]);

    expect(result).toEqual({ created: 2, updated: 1, ignored: 0 });
    expect(
      prisma.material.create.mock.calls.map(([{ data }]: any) => data.code),
    ).toEqual(['MAT-08', 'MAT-09']);
    expect(prisma.material.update).toHaveBeenCalledWith({
      where: { id: 'novo-1' },
      data: { cost: 3200, costUpdatedAt: expect.any(Date) },
    });
  });

  it('material de outra empresa ou inativo recusa a importação inteira', async () => {
    prisma.material.findMany.mockImplementation(async ({ where }: any) =>
      where.id ? [] : [],
    );

    await expect(
      service.apply('c-1', [
        { name: 'Metalon', unit: 'm', cost: 1900, materialId: 'm-de-fora' },
        { name: 'Verniz', unit: 'l', sector: 'Produção', cost: 3000 },
      ]),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.material.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['m-de-fora'] }, companyId: 'c-1', active: true },
      }),
    );
    expect(prisma.material.create).not.toHaveBeenCalled();
  });
});
