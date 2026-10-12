import { NotFoundException } from '@nestjs/common';
import { ProductAssemblyService } from './product-assembly.service';
import { BASE_RULES, FINISHING_RULES } from './sale-rules';

/**
 * As decisões de escrita da composição com o Prisma simulado. As consultas
 * de verdade (vínculo, cópia, partes) passam pela fumaça contra o Postgres.
 */
const product = (extra = {}) => ({
  id: 'pr-1',
  name: 'Banner',
  code: 'BAN',
  isActive: true,
  companyId: 'c-1',
  items: [
    { id: 'i-1', unitKind: 'AREA', unitCost: 0.0045, width: 900, height: 1200 },
  ],
  priceTiers: [],
  variations: [
    {
      id: 'v-1',
      name: 'Econômico',
      unitPrice: null,
      priceTiers: [],
      assemblies: [],
    },
  ],
  ...extra,
});

const processLine = {
  id: 'l-1',
  processId: 'p-1',
  blockId: null,
  sourceLineId: null,
  overridden: false,
  addedHere: false,
  name: 'Material',
  kind: 'MATERIAL',
  mode: 'CHOOSE',
  formula: 'PER_AREA',
  perUnit: 1,
  lossPercent: 0,
  minimum: null,
  optional: false,
  optionalDefault: true,
  fieldName: null,
  formulaId: null,
  people: null,
  sheetMargin: null,
  sheetGap: null,
  chargeWholeSheets: null,
  selectedOptionId: 'o-1',
  position: 0,
  createdAt: new Date(),
  options: [
    {
      id: 'o-1',
      lineId: 'l-1',
      resourceId: 'material:a',
      configName: null,
      perUnit: null,
      lossPercent: null,
      minimum: null,
      position: 0,
    },
    {
      id: 'o-2',
      lineId: 'l-1',
      resourceId: 'material:b',
      configName: null,
      perUnit: null,
      lossPercent: null,
      minimum: null,
      position: 1,
    },
  ],
};

const assembly = (blocks: unknown[] = []) => ({
  id: 'a-1',
  companyId: 'c-1',
  productId: 'pr-1',
  variationId: null,
  variationKey: '',
  status: 'DRAFT',
  dimension: 'SALE',
  allowRenameStages: false,
  blocks,
  fields: [],
  formulas: [],
});

const processBlock = (extra = {}) => ({
  id: 'b-1',
  assemblyId: 'a-1',
  type: 'PROCESS',
  processId: 'p-1',
  partProductId: null,
  name: '',
  sectorId: null,
  setupMinutes: 0,
  taskType: '',
  rules: null,
  dependsOn: [],
  baseBlockId: null,
  localName: null,
  localTaskType: null,
  localRules: null,
  removedSourceLineIds: [],
  position: 0,
  createdAt: new Date(),
  sector: null,
  process: {
    id: 'p-1',
    name: 'Impressão solvente',
    afterBase: 'INHERIT',
    setupMinutes: 0,
    taskType: 'Impressão',
    isActive: true,
    rules: { ...BASE_RULES },
    sector: {
      id: 's-1',
      name: 'Impressão',
      saleUnit: 'HOUR',
      hourCost: 0,
      hourSale: 0,
    },
    lines: [processLine],
    fields: [],
    formulas: [],
  },
  lines: [],
  ...extra,
});

describe('ProductAssemblyService', () => {
  let prisma: any;
  let tx: any;
  let service: ProductAssemblyService;

  beforeEach(() => {
    tx = {
      assemblyBlock: { create: jest.fn(), update: jest.fn() },
      assemblyLine: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    };
    prisma = {
      product: { findFirst: jest.fn().mockResolvedValue(product()) },
      productAssembly: {
        findUnique: jest.fn().mockResolvedValue(assembly()),
        update: jest.fn(async ({ data }) => ({
          status: 'DRAFT',
          dimension: 'SALE',
          allowRenameStages: false,
          ...data,
        })),
        upsert: jest.fn(),
      },
      process: { findFirst: jest.fn() },
      companySector: { findFirst: jest.fn() },
      assemblyBlock: { update: jest.fn() },
      assemblyLine: { create: jest.fn(), update: jest.fn() },
      productItem: { count: jest.fn().mockResolvedValue(1) },
      $transaction: jest.fn(async (fn) => fn(tx)),
    };
    service = new ProductAssemblyService(
      prisma,
      { resolve: jest.fn().mockResolvedValue(new Map()) } as any,
      { referenceMarkupOf: jest.fn().mockResolvedValue(1) } as any,
    );
  });

  const ctx = { companyId: 'c-1', productId: 'pr-1' };

  it('produto de outra empresa não é encontrado', async () => {
    prisma.product.findFirst.mockResolvedValue(null);
    await expect(service.read(ctx, {}, { values: true })).rejects.toThrow(
      new NotFoundException('Produto não encontrado'),
    );
    expect(prisma.product.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'pr-1', companyId: 'c-1' } }),
    );
  });

  it('a variação sem composição própria não recebe escrita', async () => {
    await expect(
      service.addBlock(
        { ...ctx, variationId: 'v-1' },
        { type: 'OWN', name: 'X' },
      ),
    ).rejects.toThrow('crie a composição própria dela primeiro');
    await expect(
      service.addBlock(
        { ...ctx, variationId: 'v-9' },
        { type: 'OWN', name: 'X' },
      ),
    ).rejects.toThrow(new NotFoundException('Variação não encontrada'));
  });

  it('liberar pede etapas e opção padrão nas escolhas (IP-14)', async () => {
    await expect(
      service.updateHeader(ctx, { status: 'RELEASED' }),
    ).rejects.toThrow(
      'Monte a composição antes de liberar o produto para venda',
    );
    prisma.productAssembly.findUnique.mockResolvedValue(
      assembly([
        processBlock({
          process: {
            ...processBlock().process,
            lines: [{ ...processLine, selectedOptionId: null }],
          },
        }),
      ]),
    );
    await expect(
      service.updateHeader(ctx, { status: 'RELEASED' }),
    ).rejects.toThrow(
      'Há linhas de escolha sem opção padrão. Escolha antes de liberar',
    );
  });

  it('etapa própria nasce com as regras pela posição e o tipo de tarefa do setor', async () => {
    prisma.productAssembly.findUnique.mockResolvedValue(
      assembly([processBlock()]),
    );
    prisma.companySector.findFirst.mockResolvedValue({
      id: 's-1',
      name: 'Acabamento',
    });

    await service.addBlock(ctx, {
      type: 'OWN',
      name: ' Corte ',
      sectorId: 's-1',
      dependsOn: ['b-1'],
    });

    expect(tx.assemblyBlock.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'OWN',
        name: 'Corte',
        sectorId: 's-1',
        taskType: 'Acabamento',
        dependsOn: ['b-1'],
        baseBlockId: 'b-1',
        rules: FINISHING_RULES,
      }),
    });
    await expect(
      service.addBlock(ctx, { type: 'OWN', name: ' ' }),
    ).rejects.toThrow('Informe o nome da etapa');
  });

  it('processo inativo ou de outra empresa não entra', async () => {
    prisma.process.findFirst.mockResolvedValue(null);
    await expect(
      service.addBlock(ctx, { type: 'PROCESS', processId: 'p-9' }),
    ).rejects.toThrow(new NotFoundException('Processo não encontrado'));
    expect(prisma.process.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p-9', companyId: 'c-1', isActive: true },
      }),
    );
  });

  it('inserir no meio religa a etapa seguinte à nova (FL-5)', async () => {
    prisma.productAssembly.findUnique.mockResolvedValue(
      assembly([
        processBlock(),
        processBlock({ id: 'b-2', dependsOn: ['b-1'], baseBlockId: 'b-1' }),
      ]),
    );
    prisma.process.findFirst.mockResolvedValue({ id: 'p-1' });

    const { id } = await service.addBlock(ctx, {
      type: 'PROCESS',
      processId: 'p-1',
      dependsOn: ['b-1'],
      insertBefore: 'b-2',
    });

    expect(tx.assemblyBlock.update).toHaveBeenCalledWith({
      where: { id: 'b-2' },
      data: { dependsOn: [id], baseBlockId: id },
    });
  });

  it('trocar só a opção da linha do processo não a ajusta (CP-21)', async () => {
    prisma.productAssembly.findUnique.mockResolvedValue(
      assembly([processBlock()]),
    );

    const result = await service.updateLine(ctx, 'b-1', 'l-1', {
      selectedId: 'o-2',
      variationId: null,
    });

    expect(result).toEqual({ id: 'l-1', overridden: false });
    expect(prisma.assemblyLine.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        blockId: 'b-1',
        sourceLineId: 'l-1',
        overridden: false,
        selectedOptionId: 'o-2',
      }),
    });
  });

  it('linha que não é da etapa não é encontrada', async () => {
    prisma.productAssembly.findUnique.mockResolvedValue(
      assembly([processBlock()]),
    );
    await expect(
      service.updateLine(ctx, 'b-1', 'l-9', { perUnit: 2 }),
    ).rejects.toThrow(new NotFoundException('Linha não encontrada'));
    await expect(
      service.updateLine(ctx, 'b-9', 'l-1', { perUnit: 2 }),
    ).rejects.toThrow(new NotFoundException('Etapa não encontrada'));
  });

  it('a linha tirada do processo entra nas removidas deste produto', async () => {
    prisma.productAssembly.findUnique.mockResolvedValue(
      assembly([processBlock()]),
    );
    await service.removeLine(ctx, 'b-1', 'l-1');
    expect(tx.assemblyBlock.update).toHaveBeenCalledWith({
      where: { id: 'b-1' },
      data: { removedSourceLineIds: ['l-1'] },
    });
  });

  it('a variação com composição: nome, repetida e kit', async () => {
    await expect(service.createVariation(ctx, { name: ' ' })).rejects.toThrow(
      'Dê um nome à variação (P, M, G…)',
    );
    await expect(
      service.createVariation(ctx, { name: 'ECONOMICO' }),
    ).rejects.toThrow('Já existe uma variação com esse nome');
    prisma.productItem.count.mockResolvedValue(2);
    await expect(service.createVariation(ctx, { name: 'G' })).rejects.toThrow(
      'kit não tem variação',
    );
  });
});
