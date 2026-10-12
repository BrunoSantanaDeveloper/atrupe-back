import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MaterialService } from './material.service';
import { MaterialRow } from './material.presenter';

const variation = (over: Record<string, unknown> = {}) =>
  ({
    id: 'v-1',
    materialId: 'm-1',
    brand: 'Marca X',
    color: 'Branca',
    matchKey: 'marca x|branca',
    cost: 1250,
    price: 2800,
    desiredMargin: null,
    costUpdatedAt: null,
    createdAt: new Date('2026-10-01T12:00:00Z'),
    updatedAt: new Date('2026-10-01T12:00:00Z'),
    ...over,
  }) as MaterialRow['variations'][number];

const material = (over: Record<string, unknown> = {}) =>
  ({
    id: 'm-1',
    companyId: 'c-1',
    number: 6,
    code: 'MAT-06',
    name: 'Metalon 50 × 30',
    searchName: 'metalon 50 × 30',
    sectorId: 's-3',
    subcategory: 'Perfis',
    unit: 'M',
    directSale: false,
    productionMaterial: true,
    priceRule: 'FIXED',
    cost: 1850,
    price: null,
    desiredMargin: null,
    costUpdatedAt: null,
    active: true,
    shape: null,
    profileX: null,
    profileY: null,
    barLength: null,
    sheetWidth: null,
    sheetHeight: null,
    wholeSheets: true,
    weight: null,
    createdAt: new Date('2026-10-01T12:00:00Z'),
    updatedAt: new Date('2026-10-01T12:00:00Z'),
    sector: { name: 'Serralheria' },
    variations: [],
    ...over,
  }) as MaterialRow;

const VALUES = { values: true };
const NO_VALUES = { values: false };

describe('MaterialService', () => {
  let prisma: any;
  let charges: { taxation: number; financialCost: number; commission: number };
  let service: MaterialService;

  beforeEach(() => {
    prisma = {
      material: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn(),
        create: jest.fn(async ({ data }) => material(data)),
        update: jest.fn(async ({ data }) => material(data)),
        aggregate: jest.fn().mockResolvedValue({ _max: { number: 7 } }),
      },
      materialVariation: {
        create: jest.fn(async ({ data }) =>
          variation({ id: 'v-new', ...data }),
        ),
        update: jest.fn(async ({ data }) => variation(data)),
      },
      companySector: {
        findFirst: jest.fn().mockResolvedValue({ id: 's-3' }),
      },
    };
    prisma.$executeRaw = jest.fn().mockResolvedValue(1);
    prisma.$transaction = jest.fn(async (arg: any) =>
      typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
    );
    charges = { taxation: 0, financialCost: 0, commission: 0 };
    service = new MaterialService(prisma, {
      chargesOf: jest.fn(async () => charges),
    } as any);
  });

  describe('lista', () => {
    it('filtra pela empresa da sessão e traz só os ativos por padrão', async () => {
      await service.findAll('c-1', {}, VALUES);

      expect(prisma.material.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: 'c-1', active: true },
          orderBy: [
            { sector: { name: 'asc' } },
            { subcategory: 'asc' },
            { name: 'asc' },
          ],
          skip: 0,
          take: 10,
        }),
      );
    });

    it('a busca é pelo nome sem acento e sem caixa, ou pelo código', async () => {
      await service.findAll('c-1', { search: '  LONÃ 440 ' }, VALUES);

      expect(prisma.material.findMany.mock.calls[0][0].where).toMatchObject({
        OR: [
          { searchName: { contains: 'lona 440' } },
          { code: { contains: 'lona 440', mode: 'insensitive' } },
        ],
      });
    });

    it('os filtros da tela entram no where', async () => {
      await service.findAll(
        'c-1',
        {
          active: false,
          sectorId: 's-3',
          directSale: true,
          productionMaterial: false,
        },
        VALUES,
      );

      expect(prisma.material.findMany.mock.calls[0][0].where).toEqual({
        companyId: 'c-1',
        active: false,
        sectorId: 's-3',
        directSale: true,
        productionMaterial: false,
      });
    });

    it('acima de 100 por página, vale 100', async () => {
      prisma.material.count.mockResolvedValue(250);

      const result = await service.findAll(
        'c-1',
        { page: 2, limit: 5000 },
        VALUES,
      );

      expect(prisma.material.findMany.mock.calls[0][0]).toMatchObject({
        skip: 100,
        take: 100,
      });
      expect(result).toMatchObject({ page: 2, lastPage: 3, total: 250 });
    });

    it('sem resultado, a última página é a primeira', async () => {
      expect(await service.findAll('c-1', {}, VALUES)).toEqual({
        data: [],
        page: 1,
        lastPage: 1,
        total: 0,
      });
    });
  });

  describe('cadastro', () => {
    const dto = {
      name: 'Metalon 50 × 30',
      sectorId: 's-3',
      subcategory: 'Perfis',
      unit: 'M' as const,
      cost: 1850,
      advanced: { shape: 'PROFILE' as const, x: 50, y: 30, barLength: 6000 },
    };

    it('gera o código seguinte da empresa e grava o nome de busca', async () => {
      const created = await service.create('c-1', dto, VALUES);

      expect(prisma.material.aggregate).toHaveBeenCalledWith({
        where: { companyId: 'c-1' },
        _max: { number: true },
      });
      expect(prisma.material.create.mock.calls[0][0].data).toMatchObject({
        companyId: 'c-1',
        number: 8,
        code: 'MAT-08',
        name: 'Metalon 50 × 30',
        searchName: 'metalon 50 × 30',
        sectorId: 's-3',
        unit: 'M',
        directSale: false,
        productionMaterial: true,
        cost: 1850,
        shape: 'PROFILE',
        profileX: 50,
        profileY: 30,
        barLength: 6000,
        wholeSheets: true,
      });
      expect(created).toMatchObject({ code: 'MAT-08', cost: 1850 });
    });

    it('a primeira empresa começa em MAT-01', async () => {
      prisma.material.aggregate.mockResolvedValue({ _max: { number: null } });

      await service.create('c-1', dto, VALUES);

      expect(prisma.material.create.mock.calls[0][0].data.code).toBe('MAT-01');
    });

    it('sem a permissão de valores, o custo enviado não é gravado', async () => {
      await service.create('c-1', dto, NO_VALUES);

      expect(prisma.material.create.mock.calls[0][0].data).toMatchObject({
        cost: null,
        costUpdatedAt: null,
      });
    });

    it('setor de outra empresa responde 404, sem criar', async () => {
      prisma.companySector.findFirst.mockResolvedValue(null);

      await expect(service.create('c-1', dto, VALUES)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.companySector.findFirst).toHaveBeenCalledWith({
        where: { id: 's-3', companyId: 'c-1' },
        select: { id: true },
      });
      expect(prisma.material.create).not.toHaveBeenCalled();
    });

    it('trava as criações da empresa antes de ler o último número', async () => {
      await service.create('c-1', dto, VALUES);

      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      // A chave da trava é a empresa
      expect(prisma.$executeRaw.mock.calls[0]).toContain('material:c-1');
      expect(prisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.material.aggregate.mock.invocationCallOrder[0],
      );
    });

    it('a folha inteira só é escolha da chapa', async () => {
      await service.create(
        'c-1',
        {
          ...dto,
          advanced: {
            shape: 'SHEET',
            width: 1220,
            height: 2440,
            wholeSheets: false,
          },
        },
        VALUES,
      );
      await service.create(
        'c-1',
        { ...dto, advanced: { shape: 'PROFILE', wholeSheets: false } },
        VALUES,
      );

      expect(prisma.material.create.mock.calls[0][0].data).toMatchObject({
        shape: 'SHEET',
        sheetWidth: 1220,
        sheetHeight: 2440,
        wholeSheets: false,
      });
      expect(prisma.material.create.mock.calls[1][0].data.wholeSheets).toBe(
        true,
      );
    });
  });

  describe('edição', () => {
    it('material de outra empresa responde 404', async () => {
      prisma.material.findFirst.mockResolvedValue(null);

      await expect(
        service.update('c-1', 'm-9', { name: 'Outro' }, VALUES),
      ).rejects.toThrow('Material não encontrado');
      expect(prisma.material.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'm-9', companyId: 'c-1' } }),
      );
      expect(prisma.material.update).not.toHaveBeenCalled();
    });

    it('o nome novo atualiza o nome de busca', async () => {
      prisma.material.findFirst.mockResolvedValue(material());

      await service.update('c-1', 'm-1', { name: 'Metalon CHAPÃO' }, VALUES);

      expect(prisma.material.update.mock.calls[0][0].data).toEqual({
        name: 'Metalon CHAPÃO',
        searchName: 'metalon chapao',
      });
    });

    it('a configuração avançada substitui o bloco inteiro', async () => {
      prisma.material.findFirst.mockResolvedValue(
        material({ shape: 'PROFILE', profileX: 50, profileY: 30 }),
      );

      await service.update(
        'c-1',
        'm-1',
        { advanced: { shape: 'SHEET', width: 1220, height: 2440 } },
        VALUES,
      );

      expect(prisma.material.update.mock.calls[0][0].data).toEqual({
        shape: 'SHEET',
        profileX: null,
        profileY: null,
        barLength: null,
        sheetWidth: 1220,
        sheetHeight: 2440,
        wholeSheets: true,
        weight: null,
      });
    });

    it('com variação, o custo enviado é ignorado', async () => {
      prisma.material.findFirst.mockResolvedValue(
        material({ cost: null, variations: [variation()] }),
      );

      await service.update('c-1', 'm-1', { cost: 999 }, VALUES);

      expect(prisma.material.update.mock.calls[0][0].data).toEqual({});
    });

    it('sem a permissão de valores, o custo enviado é ignorado', async () => {
      prisma.material.findFirst.mockResolvedValue(material());

      await service.update('c-1', 'm-1', { cost: 999 }, NO_VALUES);

      expect(prisma.material.update.mock.calls[0][0].data).toEqual({});
    });

    it('no preço fixo, o custo novo não mexe no preço', async () => {
      prisma.material.findFirst.mockResolvedValue(material({ price: 2600 }));

      await service.update('c-1', 'm-1', { cost: 2000 }, VALUES);

      expect(prisma.material.update.mock.calls[0][0].data).toEqual({
        cost: 2000,
        costUpdatedAt: expect.any(Date),
      });
    });

    it('no preço variável, o preço acompanha o custo pelo lucro guardado', async () => {
      prisma.material.findFirst.mockResolvedValue(
        material({
          priceRule: 'VARIABLE',
          cost: 1250,
          price: 1786,
          desiredMargin: 300,
        }),
      );

      await service.update('c-1', 'm-1', { cost: 1400 }, VALUES);

      // 1400 ÷ 0,7 = 2000
      expect(prisma.material.update.mock.calls[0][0].data).toEqual({
        cost: 1400,
        costUpdatedAt: expect.any(Date),
        price: 2000,
      });
    });

    it('o mesmo custo não muda nada', async () => {
      prisma.material.findFirst.mockResolvedValue(material());

      await service.update('c-1', 'm-1', { cost: 1850 }, VALUES);

      expect(prisma.material.update.mock.calls[0][0].data).toEqual({});
    });
  });

  describe('variações', () => {
    it('cria as combinações que faltam, sem caixa e sem acento', async () => {
      prisma.material.findFirst.mockResolvedValue(
        material({ cost: null, variations: [variation()] }),
      );

      const result = await service.createVariations(
        'c-1',
        'm-1',
        {
          brands: ['MARCA X', 'Marca Y'],
          colors: ['Brancá', 'Preta'],
          cost: 1250,
          price: null,
        },
        VALUES,
      );

      // Marca X × Branca já existia
      expect(result.created).toBe(3);
      expect(
        prisma.materialVariation.create.mock.calls.map(
          ([{ data }]: any) => data.matchKey,
        ),
      ).toEqual(['marca x|preta', 'marca y|branca', 'marca y|preta']);
      expect(
        prisma.materialVariation.create.mock.calls[0][0].data,
      ).toMatchObject({
        materialId: 'm-1',
        brand: 'MARCA X',
        color: 'Preta',
        cost: 1250,
      });
      // Já havia variação: o material não é zerado de novo
      expect(prisma.material.update).not.toHaveBeenCalled();
    });

    it('na primeira variação, custo e preço saem do material', async () => {
      prisma.material.findFirst.mockResolvedValue(material({ price: 2600 }));

      await service.createVariations(
        'c-1',
        'm-1',
        { brands: ['Marca X'], colors: ['Branca'], cost: 1250 },
        VALUES,
      );

      expect(prisma.material.update).toHaveBeenCalledWith({
        where: { id: 'm-1' },
        data: {
          cost: null,
          price: null,
          desiredMargin: null,
          costUpdatedAt: null,
        },
      });
    });

    it('sem combinação nova, não cria nem zera nada', async () => {
      prisma.material.findFirst.mockResolvedValue(
        material({ variations: [variation()] }),
      );

      const result = await service.createVariations(
        'c-1',
        'm-1',
        { brands: ['marca x'], colors: ['branca'] },
        VALUES,
      );

      expect(result).toEqual({ created: 0, variations: [] });
      expect(prisma.materialVariation.create).not.toHaveBeenCalled();
    });

    it('sem a permissão de valores, as combinações nascem sem custo', async () => {
      prisma.material.findFirst.mockResolvedValue(material());

      const result = await service.createVariations(
        'c-1',
        'm-1',
        { brands: ['Marca X'], colors: ['Branca'], cost: 1250, price: 2800 },
        NO_VALUES,
      );

      expect(
        prisma.materialVariation.create.mock.calls[0][0].data,
      ).toMatchObject({ cost: null, price: null });
      expect(result.variations[0]).toEqual({
        id: 'v-new',
        brand: 'Marca X',
        color: 'Branca',
      });
    });

    it('variação de outro material responde 404', async () => {
      prisma.material.findFirst.mockResolvedValue(
        material({ variations: [variation()] }),
      );

      await expect(
        service.updateVariation('c-1', 'm-1', 'v-9', { cost: 10 }),
      ).rejects.toThrow('Variação não encontrada');
    });

    it('a tabela de custos manda o preço que já estava: só o custo muda', async () => {
      prisma.material.findFirst.mockResolvedValue(
        material({ variations: [variation()] }),
      );

      await service.updateVariation('c-1', 'm-1', 'v-1', {
        cost: 1420,
        price: 2800,
      });

      expect(prisma.materialVariation.update).toHaveBeenCalledWith({
        where: { id: 'v-1' },
        data: { cost: 1420, costUpdatedAt: expect.any(Date) },
      });
    });

    it('no preço variável, o custo novo recalcula o preço da variação', async () => {
      prisma.material.findFirst.mockResolvedValue(
        material({
          priceRule: 'VARIABLE',
          variations: [variation({ price: 1786, desiredMargin: 300 })],
        }),
      );

      const updated = await service.updateVariation('c-1', 'm-1', 'v-1', {
        cost: 1400,
        price: 1786,
      });

      expect(prisma.materialVariation.update.mock.calls[0][0].data).toEqual({
        cost: 1400,
        costUpdatedAt: expect.any(Date),
        price: 2000,
      });
      expect(updated).toMatchObject({ cost: 1400, price: 2000, margin: 30 });
    });

    it('o preço informado diferente vale, e nulo tira a definição', async () => {
      prisma.material.findFirst.mockResolvedValue(
        material({ variations: [variation()] }),
      );

      await service.updateVariation('c-1', 'm-1', 'v-1', { price: 3100 });
      await service.updateVariation('c-1', 'm-1', 'v-1', { cost: null });

      expect(prisma.materialVariation.update.mock.calls[0][0].data).toEqual({
        price: 3100,
      });
      expect(prisma.materialVariation.update.mock.calls[1][0].data).toEqual({
        cost: null,
        costUpdatedAt: null,
      });
    });
  });

  describe('preço', () => {
    it('material com variação exige a variação', async () => {
      prisma.material.findFirst.mockResolvedValue(
        material({ variations: [variation()] }),
      );

      await expect(
        service.updatePrice('c-1', 'm-1', { rule: 'FIXED', price: 2800 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('material sem variação recusa a variação', async () => {
      prisma.material.findFirst.mockResolvedValue(material());

      await expect(
        service.updatePrice('c-1', 'm-1', {
          rule: 'FIXED',
          price: 2800,
          variationId: 'v-1',
        }),
      ).rejects.toThrow('Este material não tem variações.');
    });

    it('material ou variação de fora responde "Item não encontrado"', async () => {
      prisma.material.findFirst.mockResolvedValue(null);
      await expect(
        service.updatePrice('c-1', 'm-9', { rule: 'FIXED', price: 2800 }),
      ).rejects.toThrow('Item não encontrado');

      prisma.material.findFirst.mockResolvedValue(
        material({ variations: [variation()] }),
      );
      await expect(
        service.updatePrice('c-1', 'm-1', {
          rule: 'FIXED',
          price: 2800,
          variationId: 'v-9',
        }),
      ).rejects.toThrow('Item não encontrado');
    });

    it('sem custo não há preço', async () => {
      prisma.material.findFirst.mockResolvedValue(material({ cost: null }));

      await expect(
        service.updatePrice('c-1', 'm-1', { rule: 'FIXED', price: 2800 }),
      ).rejects.toThrow('Este item ainda não tem custo.');
    });

    it('preço fixo grava o preço informado e apaga o lucro guardado', async () => {
      prisma.material.findFirst.mockResolvedValue(
        material({ priceRule: 'VARIABLE', desiredMargin: 300 }),
      );

      const item = await service.updatePrice('c-1', 'm-1', {
        rule: 'FIXED',
        price: 2600,
      });

      expect(prisma.material.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'm-1' },
          data: { priceRule: 'FIXED', price: 2600, desiredMargin: null },
        }),
      );
      expect(item).toMatchObject({
        id: 'mat:m-1',
        rule: 'FIXED',
        price: 2600,
        margin: 28.8,
        status: 'PRICED',
      });
    });

    it('preço variável: o servidor refaz a conta e guarda o lucro', async () => {
      prisma.material.findFirst.mockResolvedValue(material({ cost: 1250 }));

      // 1250 ÷ 0,7 = 1785,71: a tela manda 1785, o servidor grava 1786
      await service.updatePrice('c-1', 'm-1', {
        rule: 'VARIABLE',
        price: 1785,
        desiredMargin: 300,
      });

      expect(prisma.material.update.mock.calls[0][0].data).toEqual({
        priceRule: 'VARIABLE',
        price: 1786,
        desiredMargin: 300,
      });
    });

    it('preço variável usa os encargos da Precificação', async () => {
      charges = { taxation: 60, financialCost: 15, commission: 30 };
      prisma.material.findFirst.mockResolvedValue(material({ cost: 1250 }));

      await service.updatePrice('c-1', 'm-1', {
        rule: 'VARIABLE',
        price: 2101,
        desiredMargin: 300,
      });

      expect(prisma.material.update.mock.calls[0][0].data.price).toBe(2101);
    });

    it('preço variável que não confere com a conta é recusado', async () => {
      prisma.material.findFirst.mockResolvedValue(material({ cost: 1250 }));

      await expect(
        service.updatePrice('c-1', 'm-1', {
          rule: 'VARIABLE',
          price: 1900,
          desiredMargin: 300,
        }),
      ).rejects.toThrow('O preço não confere');
      expect(prisma.material.update).not.toHaveBeenCalled();
    });

    it('preço variável pede o lucro; o fixo o recusa', async () => {
      prisma.material.findFirst.mockResolvedValue(material());

      await expect(
        service.updatePrice('c-1', 'm-1', { rule: 'VARIABLE', price: 2643 }),
      ).rejects.toThrow('Informe o lucro do preço variável.');
      await expect(
        service.updatePrice('c-1', 'm-1', {
          rule: 'FIXED',
          price: 2600,
          desiredMargin: 300,
        }),
      ).rejects.toThrow('O lucro só vale para o preço variável.');
    });

    it('lucro de 100 % não tem preço que pague', async () => {
      prisma.material.findFirst.mockResolvedValue(material());

      await expect(
        service.updatePrice('c-1', 'm-1', {
          rule: 'VARIABLE',
          price: 999999,
          desiredMargin: 1000,
        }),
      ).rejects.toThrow('somam 100 %');
    });

    it('na variação, o preço fica nela e a regra no material', async () => {
      const item = variation();
      prisma.material.findFirst.mockResolvedValue(
        material({ cost: null, variations: [item] }),
      );
      prisma.material.update.mockResolvedValue(
        material({
          cost: null,
          priceRule: 'FIXED',
          variations: [variation({ price: 3000 })],
        }),
      );

      const result = await service.updatePrice('c-1', 'm-1', {
        rule: 'FIXED',
        price: 3000,
        variationId: 'v-1',
      });

      expect(prisma.materialVariation.update).toHaveBeenCalledWith({
        where: { id: 'v-1' },
        data: { price: 3000, desiredMargin: null },
      });
      expect(prisma.material.update.mock.calls[0][0].data).toEqual({
        priceRule: 'FIXED',
      });
      expect(result).toMatchObject({ id: 'mat:m-1:v-1', price: 3000 });
    });
  });

  describe('situação', () => {
    it('inativa e reativa; nenhuma composição é tocada ainda', async () => {
      prisma.material.findFirst.mockResolvedValue(material());

      const result = await service.toggleStatus('c-1', 'm-1', false, VALUES);

      expect(prisma.material.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'm-1' },
          data: { active: false },
        }),
      );
      expect(result).toMatchObject({ active: false, removedFrom: 0 });
    });

    it('recusa a situação que já é a atual', async () => {
      prisma.material.findFirst.mockResolvedValue(material());

      await expect(
        service.toggleStatus('c-1', 'm-1', true, VALUES),
      ).rejects.toThrow('O material já está ativo.');
    });

    it('"onde é usado" confere a empresa', async () => {
      prisma.material.findFirst.mockResolvedValue(null);
      await expect(service.usage('c-1', 'm-9')).rejects.toThrow(
        NotFoundException,
      );

      prisma.material.findFirst.mockResolvedValue(material());
      expect(await service.usage('c-1', 'm-1')).toEqual({ data: [] });
    });
  });
});
