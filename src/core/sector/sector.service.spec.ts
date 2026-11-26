import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  Prisma,
  SectorAllocationCriterion,
  SectorNature,
  SectorSaleUnit,
} from '@prisma/client';
import {
  DELIVERY_SECTOR_NAME,
  SectorService,
  sectorNameTaken,
} from './sector.service';
import { CreateSectorDto } from './dto/create-sector.dto';
import { UpdateSectorDto } from './dto/update-sector.dto';

/**
 * O setor ganhou de uma vez os campos que três módulos pedem: como vende
 * (composição), a cor (agenda e produção) e a natureza com o rateio (base de
 * custos).
 */
describe('Setor: unidade de venda, cor, natureza e rateio', () => {
  describe('corpo', () => {
    // O mesmo rigor do ValidationPipe global
    const rejected = async (dto: any, body: Record<string, unknown>) =>
      (
        await validate(plainToInstance(dto, body) as object, {
          whitelist: true,
          forbidNonWhitelisted: true,
        })
      ).map((error) => error.property);

    it('a cor é gravada em maiúsculas', () => {
      expect(plainToInstance(UpdateSectorDto, { color: '#1d4ed8' }).color).toBe(
        '#1D4ED8',
      );
    });

    it.each(['azul', '#12345', '1D4ED8', '#1D4ED8FF', '#GGGGGG'])(
      'a cor %p é recusada',
      async (color) => {
        expect(await rejected(UpdateSectorDto, { color })).toEqual(['color']);
      },
    );

    it('nulo e vazio voltam ao padrão do ícone', async () => {
      expect(await rejected(UpdateSectorDto, { color: null })).toEqual([]);
      expect(await rejected(UpdateSectorDto, { color: '' })).toEqual([]);
      expect(plainToInstance(UpdateSectorDto, { color: '' }).color).toBeNull();
    });

    it('unidade de venda e natureza só aceitam os valores do contrato', async () => {
      expect(
        await rejected(UpdateSectorDto, {
          saleUnit: 'KG',
          nature: 'OPERATIONAL',
        }),
      ).toEqual(['saleUnit', 'nature']);
      expect(
        await rejected(UpdateSectorDto, {
          saleUnit: 'M2',
          nature: 'PRODUCTIVE',
        }),
      ).toEqual([]);
    });

    it('o critério do rateio não é editável pelo setor', async () => {
      expect(
        await rejected(UpdateSectorDto, { allocationCriterion: 'MANUAL' }),
      ).toEqual(['allocationCriterion']);
    });

    it('criar aceita os mesmos campos, todos opcionais', async () => {
      expect(
        await rejected(CreateSectorDto, { name: 'Impressão', icon: 'printer' }),
      ).toEqual([]);
      expect(
        await rejected(CreateSectorDto, {
          name: 'Impressão',
          icon: 'printer',
          saleUnit: 'M2',
          color: '#2563eb',
          nature: 'PRODUCTIVE',
        }),
      ).toEqual([]);
    });
  });

  describe('service', () => {
    let prisma: any;
    let service: SectorService;

    beforeEach(() => {
      prisma = {
        company: { findUnique: jest.fn().mockResolvedValue({ id: 'c-1' }) },
        companySector: {
          create: jest.fn(async ({ data }) => data),
          update: jest.fn(async ({ data }) => data),
          findMany: jest.fn().mockResolvedValue([]),
        },
        category: { updateMany: jest.fn() },
        product: { updateMany: jest.fn() },
      };
      service = new SectorService(prisma);
    });

    it('criar grava a unidade, a cor e a natureza do corpo', async () => {
      await service.create({
        name: 'Impressão',
        icon: 'printer',
        companyId: 'c-1',
        saleUnit: SectorSaleUnit.M2,
        color: '#2563EB',
        nature: SectorNature.PRODUCTIVE,
      });

      expect(prisma.companySector.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          saleUnit: 'M2',
          color: '#2563EB',
          nature: 'PRODUCTIVE',
          companyId: 'c-1',
        }),
      });
    });

    it('passar para administrativo devolve o rateio ao padrão', async () => {
      await service.update('setor-1', { nature: SectorNature.ADMINISTRATIVE });

      expect(prisma.companySector.update).toHaveBeenCalledWith({
        where: { id: 'setor-1' },
        data: {
          nature: 'ADMINISTRATIVE',
          allocationCriterion: SectorAllocationCriterion.ACQUISITION_VALUE,
          allocationPercentages: Prisma.DbNull,
          allocationPreviousCriterion: null,
          allocationOutdated: false,
          distributionPercentage: 0,
        },
      });
    });

    it('trocar a cor ou a unidade não mexe no rateio', async () => {
      await service.update('setor-1', {
        color: null,
        saleUnit: SectorSaleUnit.HOUR,
      });

      expect(prisma.companySector.update).toHaveBeenCalledWith({
        where: { id: 'setor-1' },
        data: { color: null, saleUnit: 'HOUR' },
      });
    });

    it('os setores com produto vêm com a cor', async () => {
      await service.findAllWithProducts('c-1');

      expect(prisma.companySector.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: { id: true, name: true, icon: true, color: true },
        }),
      );
    });
  });
});

describe('SectorService: "Seus setores de produção" (área 9 §4.16)', () => {
  const tx = {
    companySector: { updateMany: jest.fn(), create: jest.fn() },
    company: { update: jest.fn() },
  };
  const prisma: any = {
    company: {
      findUnique: jest.fn().mockResolvedValue({ productionSectorsSetAt: null }),
    },
    companySector: { findMany: jest.fn() },
    $transaction: jest.fn((fn) => fn(tx)),
  };
  const production = { kind: 'PRODUCTION', isProductionStage: true };
  // Todos os setores da empresa: os de produção, um inativo, um de outro
  // tipo e a Entrega do sistema
  const sectors = [
    { id: 'imp', name: 'Impressão', ...production, isSystem: false },
    { id: 'cnc', name: 'CNC', ...production, isSystem: false },
    { id: 'serig', name: 'Serigrafia', ...production, isSystem: false },
    {
      id: 'fin',
      name: 'Financeiro',
      kind: 'FINANCIAL',
      isProductionStage: false,
      isSystem: false,
    },
    { id: 'ent', name: 'Entrega', ...production, isSystem: true },
  ];
  const service = new SectorService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.companySector.findMany.mockResolvedValue(sectors);
  });

  it('ativa os marcados, inativa os outros e cria os novos sem repetir nome', async () => {
    await service.saveProductionSetup('c-1', {
      activeIds: ['imp'],
      newSectors: [
        { name: 'Serralheria', icon: 'tool' },
        { name: ' cnc ' },
        { name: 'serralheria' },
      ],
    });
    // O nome é comparado com todos os setores da empresa
    expect(prisma.companySector.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'c-1' } }),
    );
    // " cnc " é o CNC que já existe: fica ativo, sem nascer de novo
    expect(tx.companySector.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['imp', 'cnc'] } }),
        data: { isActive: true },
      }),
    );
    expect(tx.companySector.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { notIn: ['imp', 'cnc'] } }),
        data: { isActive: false },
      }),
    );
    expect(tx.companySector.create).toHaveBeenCalledTimes(1);
    expect(tx.companySector.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: 'c-1',
        name: 'Serralheria',
        isProductionStage: true,
      }),
    });
    expect(tx.company.update).toHaveBeenCalled();
  });

  it('sem nenhum setor, recusa', async () => {
    await expect(
      service.saveProductionSetup('c-1', { activeIds: [], newSectors: [] }),
    ).rejects.toThrow('Marque ou crie pelo menos um setor de produção');
    expect(tx.company.update).not.toHaveBeenCalled();
  });

  it('o setor de outra empresa responde 404', async () => {
    await expect(
      service.saveProductionSetup('c-1', { activeIds: ['outro'] }),
    ).rejects.toThrow('Setor não encontrado.');
  });

  it('o setor fora da produção não é marcado pela etapa', async () => {
    await expect(
      service.saveProductionSetup('c-1', { activeIds: ['fin'] }),
    ).rejects.toThrow('Setor não encontrado.');
  });

  it('o nome de um setor inativo o reativa, sem acento nem maiúsculas', async () => {
    await service.saveProductionSetup('c-1', {
      activeIds: [],
      newSectors: [{ name: 'SERIGRAFÍA' }, { name: 'impressao' }],
    });
    expect(tx.companySector.create).not.toHaveBeenCalled();
    expect(tx.companySector.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['serig', 'imp'] } }),
        data: { isActive: true },
      }),
    );
    expect(tx.company.update).toHaveBeenCalled();
  });

  it.each(['Entrega', 'ENTREGA', ' cliente  retira '])(
    'o nome de entrega (%s) é recusado',
    async (name) => {
      await expect(
        service.saveProductionSetup('c-1', {
          activeIds: ['imp'],
          newSectors: [{ name }],
        }),
      ).rejects.toThrow(DELIVERY_SECTOR_NAME);
      expect(tx.companySector.create).not.toHaveBeenCalled();
      expect(tx.company.update).not.toHaveBeenCalled();
    },
  );

  it('o nome de um setor fora da produção é recusado com o nome dele', async () => {
    await expect(
      service.saveProductionSetup('c-1', {
        activeIds: ['imp'],
        newSectors: [{ name: 'financeiro' }],
      }),
    ).rejects.toThrow(sectorNameTaken('Financeiro'));
    expect(tx.companySector.create).not.toHaveBeenCalled();
    expect(tx.company.update).not.toHaveBeenCalled();
  });
});
