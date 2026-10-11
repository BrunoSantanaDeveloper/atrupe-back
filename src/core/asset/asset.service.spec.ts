import { NotFoundException } from '@nestjs/common';
import { AssetService } from './asset.service';

/**
 * Patrimônios de duas empresas no mesmo banco: a empresa da sessão só
 * enxerga e altera os seus.
 */
const ASSETS = [
  { id: 'a-1', name: 'Plotter', companyId: 'c1', sectorId: 's-1' },
  { id: 'a-2', name: 'Router CNC', companyId: 'c2', sectorId: 's-2' },
];
const SECTORS = [
  { id: 's-1', companyId: 'c1' },
  { id: 's-2', companyId: 'c2' },
];
const TYPES = [
  { id: 't-padrao', companyId: null },
  { id: 't-c1', companyId: 'c1' },
  { id: 't-c2', companyId: 'c2' },
];

/** Filtro de igualdade simples, com o `OR` de empresa dos tipos. */
const matches = (row: any, where: any): boolean =>
  Object.entries(where).every(([field, value]) =>
    field === 'OR'
      ? (value as any[]).some((alt) => matches(row, alt))
      : row[field] === value,
  );

function buildPrisma() {
  return {
    asset: {
      findMany: jest.fn(async ({ where }) =>
        ASSETS.filter((a) => matches(a, where)),
      ),
      findFirst: jest.fn(
        async ({ where }) => ASSETS.find((a) => matches(a, where)) ?? null,
      ),
      findUnique: jest.fn(
        async ({ where }) => ASSETS.find((a) => a.id === where.id) ?? null,
      ),
      create: jest.fn(async ({ data }) => ({ id: 'a-novo', ...data })),
      update: jest.fn(async ({ where, data }) => ({ id: where.id, ...data })),
      delete: jest.fn(async ({ where }) => ({ id: where.id })),
    },
    assetType: {
      findMany: jest.fn(async ({ where }) =>
        TYPES.filter((t) => matches(t, where)),
      ),
      findFirst: jest.fn(
        async ({ where }) => TYPES.find((t) => matches(t, where)) ?? null,
      ),
    },
    companySector: {
      findFirst: jest.fn(
        async ({ where }) => SECTORS.find((s) => matches(s, where)) ?? null,
      ),
    },
  };
}

describe('AssetService — isolamento por empresa', () => {
  let prisma: ReturnType<typeof buildPrisma>;
  let service: AssetService;

  beforeEach(() => {
    prisma = buildPrisma();
    service = new AssetService(prisma as any);
  });

  it('a listagem traz só os patrimônios da empresa da sessão', async () => {
    const list = await service.findAll('c1', 10, 1);

    expect(list.map((a) => a.id)).toEqual(['a-1']);
    expect(prisma.asset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'c1' } }),
    );
  });

  it('ler o patrimônio de outra empresa responde 404', async () => {
    await expect(service.findOne('c1', 'a-2')).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.findOne('c1', 'a-1')).resolves.toMatchObject({
      id: 'a-1',
    });
  });

  it('editar ou excluir o patrimônio de outra empresa responde 404 e não grava', async () => {
    await expect(
      service.update('c1', 'a-2', { name: 'Trocado' }),
    ).rejects.toThrow(NotFoundException);
    await expect(service.remove('c1', 'a-2')).rejects.toThrow(
      NotFoundException,
    );

    expect(prisma.asset.update).not.toHaveBeenCalled();
    expect(prisma.asset.delete).not.toHaveBeenCalled();
  });

  it('criar usa a empresa da sessão e ignora a do corpo', async () => {
    await service.create('c1', {
      name: 'Impressora UV',
      purchaseValue: 1000,
      residualValue: 100,
      usefulLife: 60,
      typeId: 't-padrao',
      sectorId: 's-1',
      companyId: 'c2',
    });

    expect(prisma.asset.create).toHaveBeenCalledWith({
      data: {
        name: 'Impressora UV',
        purchaseValue: 1000,
        residualValue: 100,
        usefulLife: 60,
        typeId: 't-padrao',
        sectorId: 's-1',
        companyId: 'c1',
      },
    });
  });

  it('editar não muda a empresa do patrimônio', async () => {
    await service.update('c1', 'a-1', { name: 'Plotter 2', companyId: 'c2' });

    expect(prisma.asset.update).toHaveBeenCalledWith({
      where: { id: 'a-1' },
      data: { name: 'Plotter 2' },
    });
  });

  it('setor ou tipo de outra empresa responde 404 e não grava', async () => {
    const base = {
      name: 'Laser',
      purchaseValue: 1000,
      residualValue: 0,
      usefulLife: 60,
    };

    await expect(
      service.create('c1', { ...base, typeId: 't-c1', sectorId: 's-2' }),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.create('c1', { ...base, typeId: 't-c2', sectorId: 's-1' }),
    ).rejects.toThrow(NotFoundException);

    expect(prisma.asset.create).not.toHaveBeenCalled();
  });

  it('os tipos listados são os padrão e os da empresa', async () => {
    const types = await service.findAllTypes('c1');

    expect(types.map((t) => t.id)).toEqual(['t-padrao', 't-c1']);
  });
});
