import { NotFoundException } from '@nestjs/common';
import { AssemblyResource } from './assembly-resource.service';
import { ProcessService } from './process.service';
import { BASE_RULES } from './sale-rules';

/**
 * O serviço de processos com o Prisma simulado. As consultas de verdade
 * (ordem por relação, transações, CHECK de dono) passam pela fumaça contra
 * o Postgres; aqui ficam as decisões.
 */
const option = (id: string, resourceId: string) => ({
  id,
  lineId: 'l-1',
  resourceId,
  configName: null,
  perUnit: null,
  lossPercent: null,
  minimum: null,
  position: 0,
});

const processRow = (extra: Record<string, unknown> = {}) => ({
  id: 'p-1',
  companyId: 'c-1',
  name: 'Impressão solvente',
  sectorId: 's-1',
  afterBase: 'INHERIT',
  setupMinutes: 10,
  taskType: 'Impressão',
  sellerInstructions: '',
  rules: { ...BASE_RULES },
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  sector: {
    id: 's-1',
    name: 'Impressão',
    saleUnit: 'HOUR',
    hourCost: 4500,
    hourSale: 12000,
  },
  lines: [
    {
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
      lossPercent: 20,
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
      options: [option('o-1', 'material:lona')],
    },
  ],
  fields: [],
  formulas: [],
  usualBefore: [{ from: { name: 'Arte' } }],
  ...extra,
});

const LONA: AssemblyResource = {
  resourceId: 'material:lona',
  kind: 'MATERIAL',
  name: 'Lona 440',
  unit: 'm²',
  unitCost: 1250,
  unitSale: 2500,
};

describe('ProcessService', () => {
  let prisma: any;
  let tx: any;
  let resources: { resolve: jest.Mock };
  let service: ProcessService;

  beforeEach(() => {
    tx = {
      assemblyLine: {
        aggregate: jest.fn().mockResolvedValue({ _max: { position: 2 } }),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
      },
      assemblyField: {
        create: jest.fn(),
        update: jest.fn(async ({ data }) => ({
          id: 'f-1',
          name: 'Distância',
          defaultValue: 0.5,
          allowsFraction: true,
          ...data,
        })),
      },
      assemblyLineOption: { update: jest.fn() },
    };
    prisma = {
      process: {
        findFirst: jest.fn().mockResolvedValue(processRow()),
        create: jest.fn().mockResolvedValue({ id: 'p-1' }),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(2),
      },
      companySector: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 's-1', name: 'Impressão' }),
      },
      assemblyBlock: { findMany: jest.fn().mockResolvedValue([]) },
      assemblyLine: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      assemblyFormula: { findMany: jest.fn().mockResolvedValue([]) },
      processUsualNext: { upsert: jest.fn(), deleteMany: jest.fn() },
      $transaction: jest.fn(async (fn) => fn(tx)),
    };
    resources = {
      resolve: jest.fn().mockResolvedValue(new Map([[LONA.resourceId, LONA]])),
    };
    service = new ProcessService(
      prisma,
      resources as any,
      {
        referenceMarkupOf: jest.fn().mockResolvedValue(1),
      } as any,
    );
  });

  describe('detalhe com simulação', () => {
    it('calcula na medida padrão (1 × 1 m) e diz de quem o processo vem depois', async () => {
      const detail: any = await service.detail(
        'c-1',
        'p-1',
        {},
        { values: true },
      );

      expect(prisma.process.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'p-1', companyId: 'c-1' } }),
      );
      expect(detail.measure).toEqual({
        quantity: 1,
        width: 1000,
        height: 1000,
      });
      expect(detail.category).toBe('Depois de Arte');
      expect(detail.block.measure).toEqual({
        quantity: 1,
        width: 1000,
        height: 1000,
      });
      expect(detail.block.lines[0]).toMatchObject({
        quantity: 1.2,
        cost: 1500,
        sale: 3000,
        selectedId: 'o-1',
      });
      // Preparo: 10 min da hora de R$ 45,00 e da hora vendida de R$ 120,00
      expect(detail.block.setupCost).toBe(750);
      expect(detail.block.setupSale).toBe(2000);
      expect(detail.cost).toBe(2250);
      expect(detail.resourceSummary.map((item) => item.resourceId)).toEqual([
        'labor:s-1',
        'material:lona',
      ]);
    });

    it('sem a permissão de valores, custo e venda saem', async () => {
      const detail: any = await service.detail(
        'c-1',
        'p-1',
        {},
        { values: false },
      );
      const text = JSON.stringify(detail);
      expect(text).not.toMatch(
        /"(cost|sale|unitCost|unitSale|setupCost|setupSale)"/,
      );
      expect(detail.block.lines[0].quantity).toBe(1.2);
    });

    it('depois de uma base simulada, herda a medida dela (§9.1)', async () => {
      const detail: any = await service.detail(
        'c-1',
        'p-1',
        {
          width: 500,
          height: 500,
          baseWidth: 2000,
          baseHeight: 1000,
          baseQuantity: 3,
        },
        { values: true },
      );
      expect(detail.block.id).toBe('p-1');
      expect(detail.block.rules.dimension).toBe('SAME_AS_PARENT');
      expect(detail.block.measure).toEqual({
        quantity: 3,
        width: 2000,
        height: 1000,
      });
    });

    it('processo de outra empresa não é encontrado', async () => {
      prisma.process.findFirst.mockResolvedValue(null);
      await expect(
        service.detail('c-2', 'p-1', {}, { values: true }),
      ).rejects.toThrow(new NotFoundException('Processo não encontrado'));
    });
  });

  describe('cadastro', () => {
    it('nasce com as regras de base e o tipo de tarefa do setor (MS-1, MS-5)', async () => {
      await service.create(
        'c-1',
        { name: ' Ilhós ', sectorId: 's-1' },
        { values: true },
      );

      expect(prisma.companySector.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 's-1', companyId: 'c-1', isActive: true },
        }),
      );
      expect(prisma.process.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            companyId: 'c-1',
            name: 'Ilhós',
            afterBase: 'INHERIT',
            setupMinutes: 0,
            taskType: 'Impressão',
            rules: BASE_RULES,
            isActive: true,
          }),
        }),
      );
    });

    it('recusa nome vazio e setor inativo ou de outra empresa', async () => {
      await expect(
        service.create('c-1', { name: ' ', sectorId: 's-1' }, { values: true }),
      ).rejects.toThrow('Informe o nome do processo');
      prisma.companySector.findFirst.mockResolvedValue(null);
      await expect(
        service.create(
          'c-1',
          { name: 'Ilhós', sectorId: 's-9' },
          { values: true },
        ),
      ).rejects.toThrow('Escolha um setor ativo');
      expect(prisma.process.create).not.toHaveBeenCalled();
    });

    it('a edição mescla as regras e conta os produtos alcançados (CP-21)', async () => {
      prisma.assemblyBlock.findMany.mockResolvedValue([
        {
          processId: 'p-1',
          assembly: { productId: 'pr-1', product: { name: 'Banner' } },
        },
        {
          processId: 'p-1',
          assembly: { productId: 'pr-1', product: { name: 'Banner' } },
        },
        {
          processId: 'p-1',
          assembly: { productId: 'pr-2', product: { name: 'Faixa' } },
        },
      ]);

      const result = await service.update('c-1', 'p-1', {
        rules: { quantityMode: 'AREA_RATIO' },
        taskType: '  ',
      });

      expect(result).toEqual({ id: 'p-1', affectedProducts: 2 });
      expect(prisma.process.update).toHaveBeenCalledWith({
        where: { id: 'p-1' },
        data: { rules: { ...BASE_RULES, quantityMode: 'AREA_RATIO' } },
      });
      await expect(service.update('c-1', 'p-1', { name: '' })).rejects.toThrow(
        'Informe o nome da etapa',
      );
    });
  });

  describe('"costuma vir depois de" (FL-7)', () => {
    const pair = { fromProcessId: 'p-1', toProcessId: 'p-2' };

    it('um processo não vem depois dele mesmo', async () => {
      await expect(
        service.setUsualNext('c-1', {
          fromProcessId: 'p-1',
          toProcessId: 'p-1',
          usual: true,
        }),
      ).rejects.toThrow('Um processo não vem depois dele mesmo');
    });

    it('os dois processos precisam ser da empresa', async () => {
      prisma.process.count.mockResolvedValue(1);
      await expect(
        service.setUsualNext('c-1', { ...pair, usual: true }),
      ).rejects.toThrow(new NotFoundException('Processo não encontrado'));
      expect(prisma.process.count).toHaveBeenCalledWith({
        where: { companyId: 'c-1', id: { in: ['p-1', 'p-2'] } },
      });
    });

    it('o inativo só aparece quando já está marcado, para dar para desmarcar', async () => {
      const other = (id: string, isActive: boolean) => ({
        id,
        name: `Processo ${id}`,
        afterBase: 'INHERIT',
        isActive,
        sector: { name: 'Acabamento' },
      });
      prisma.process.findMany = jest
        .fn()
        .mockResolvedValue([
          other('ativo', true),
          other('inativo-marcado', false),
          other('inativo-solto', false),
        ]);
      prisma.processUsualNext.findMany = jest
        .fn()
        .mockResolvedValue([
          { fromProcessId: 'p-1', toProcessId: 'inativo-marcado' },
        ]);

      const { before, after } = await service.usualNext('c-1', 'p-1');

      expect(after.map((item) => [item.id, item.active, item.usual])).toEqual([
        ['inativo-marcado', false, true],
        ['ativo', true, false],
      ]);
      expect(before.map((item) => item.id)).toEqual(['ativo']);
    });

    it('o par é guardado uma vez e sai quando desmarcado', async () => {
      await service.setUsualNext('c-1', { ...pair, usual: true });
      await service.setUsualNext('c-1', { ...pair, usual: false });
      expect(prisma.processUsualNext.upsert).toHaveBeenCalledWith({
        where: { fromProcessId_toProcessId: pair },
        create: pair,
        update: {},
      });
      expect(prisma.processUsualNext.deleteMany).toHaveBeenCalledWith({
        where: pair,
      });
    });
  });

  describe('linhas e campos', () => {
    it('a linha nova entra no fim e cria o campo que ela lê (IP-4)', async () => {
      prisma.process.findFirst.mockResolvedValue({
        id: 'p-1',
        name: 'Ilhós',
        sector: { saleUnit: 'HOUR' },
        fields: [],
        formulas: [],
      });

      const result = await service.addLine('c-1', 'p-1', {
        name: 'Ilhós',
        kind: 'MATERIAL',
        mode: 'SINGLE',
        resourceIds: ['material:lona'],
        fieldName: 'Distância entre ilhoses (m)',
        fieldDefault: 0.5,
      });

      expect(resources.resolve).toHaveBeenCalledWith('c-1', ['material:lona']);
      expect(tx.assemblyField.create).toHaveBeenCalledWith({
        data: {
          processId: 'p-1',
          name: 'Distância entre ilhoses (m)',
          defaultValue: 0.5,
          allowsFraction: true,
        },
      });
      const created = tx.assemblyLine.create.mock.calls[0][0].data;
      expect(created).toMatchObject({
        id: result.id,
        processId: 'p-1',
        position: 3,
        fieldName: 'Distância entre ilhoses (m)',
      });
      expect(created.options.create).toHaveLength(1);
      expect(result.affectedProducts).toBe(0);
    });

    it('o campo que já existe, com outra grafia, é o mesmo', async () => {
      prisma.process.findFirst.mockResolvedValue({
        id: 'p-1',
        name: 'Ilhós',
        sector: { saleUnit: 'HOUR' },
        fields: [{ id: 'f-1', name: 'Distância entre ilhoses (m)' }],
        formulas: [],
      });
      await service.addLine('c-1', 'p-1', {
        name: 'Ilhós',
        kind: 'MATERIAL',
        mode: 'SINGLE',
        resourceIds: ['material:lona'],
        fieldName: 'DISTANCIA entre ilhoses (m)',
      });
      expect(tx.assemblyField.create).not.toHaveBeenCalled();
      expect(tx.assemblyLine.create.mock.calls[0][0].data.fieldName).toBe(
        'Distância entre ilhoses (m)',
      );
    });

    it('linha de outro processo não é encontrada', async () => {
      prisma.process.findFirst.mockResolvedValue({
        id: 'p-1',
        name: 'Ilhós',
        sector: { saleUnit: 'HOUR' },
        fields: [],
        formulas: [],
      });
      prisma.assemblyLine.findFirst.mockResolvedValue(null);
      await expect(
        service.updateLine('c-1', 'p-1', 'l-9', { perUnit: 2 }),
      ).rejects.toThrow(new NotFoundException('Linha não encontrada'));
      expect(prisma.assemblyLine.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'l-9', processId: 'p-1' } }),
      );
    });

    it('renomear o campo leva junto as linhas que o leem', async () => {
      prisma.process.findFirst.mockResolvedValue({
        id: 'p-1',
        name: 'Ilhós',
        sector: { saleUnit: 'HOUR' },
        fields: [
          {
            id: 'f-1',
            name: 'Distância',
            defaultValue: 0.5,
            allowsFraction: true,
          },
        ],
        formulas: [],
      });
      tx.assemblyLine.findMany.mockResolvedValue([
        { id: 'l-1', fieldName: 'distancia' },
        { id: 'l-2', fieldName: 'Outro' },
      ]);

      const field = await service.updateField('c-1', 'p-1', 'f-1', {
        name: 'Espaço',
        allowsFraction: false,
      });

      expect(tx.assemblyLine.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['l-1'] } },
        data: { fieldName: 'Espaço' },
      });
      expect(tx.assemblyField.update).toHaveBeenCalledWith({
        where: { id: 'f-1' },
        data: { allowsFraction: false, defaultValue: 1, name: 'Espaço' },
      });
      expect(field).toMatchObject({ name: 'Espaço', defaultValue: 1 });
    });
  });
});
