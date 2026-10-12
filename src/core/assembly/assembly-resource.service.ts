import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'nestjs-prisma';
import { normalizeText, UNIT_SYMBOL } from '../material/material-text';
import { EngineOption, ResourceKind } from './engine/types';

/** Teto de itens por página das listagens novas (SEG-2). */
export const RESOURCE_PAGE_LIMIT = 100;

/**
 * Um recurso que a linha pode usar (CP-3, IP-31), com custo e venda do
 * cadastro. A medida da folha e a do perfil vão em milímetros, como o
 * cadastro guarda.
 */
export type AssemblyResource = {
  resourceId: string;
  kind: ResourceKind;
  name: string;
  unit: string;
  unitCost: number;
  unitSale: number | null;
  sheet?: { width: number; height: number; wholeSheets: boolean };
  profile?: { x: number; y: number; barLength: number | null };
  weight?: number;
};

export type ResourceFilter = {
  kind?: ResourceKind;
  search?: string;
  unit?: string;
  page?: number;
  limit?: number;
};

const MATERIAL_SELECT = {
  id: true,
  name: true,
  unit: true,
  cost: true,
  price: true,
  shape: true,
  profileX: true,
  profileY: true,
  barLength: true,
  sheetWidth: true,
  sheetHeight: true,
  wholeSheets: true,
  weight: true,
  variations: {
    orderBy: [{ createdAt: 'asc' }, { brand: 'asc' }, { color: 'asc' }],
    select: { id: true, brand: true, color: true, cost: true, price: true },
  },
} satisfies Prisma.MaterialSelect;

type MaterialRow = Prisma.MaterialGetPayload<{
  select: typeof MATERIAL_SELECT;
}>;

/** Um recurso por variação, ou o material quando não há variação (MT-3). */
const materialResources = (material: MaterialRow): AssemblyResource[] => {
  const extra = {
    ...(material.shape === 'PROFILE' && material.profileX && material.profileY
      ? {
          profile: {
            x: material.profileX,
            y: material.profileY,
            barLength: material.barLength ?? null,
          },
        }
      : {}),
    ...(material.shape === 'SHEET' &&
    material.sheetWidth &&
    material.sheetHeight
      ? {
          sheet: {
            width: material.sheetWidth,
            height: material.sheetHeight,
            wholeSheets: material.wholeSheets,
          },
        }
      : {}),
    ...(material.weight ? { weight: material.weight } : {}),
  };
  const unit = UNIT_SYMBOL[material.unit];
  if (material.variations.length) {
    return material.variations.map((variation) => ({
      resourceId: `material:${material.id}:${variation.id}`,
      kind: 'MATERIAL' as const,
      name: `${material.name} · ${variation.brand} ${variation.color}`.trim(),
      unit,
      unitCost: variation.cost ?? 0,
      unitSale: variation.price ?? null,
      ...extra,
    }));
  }
  return [
    {
      resourceId: `material:${material.id}`,
      kind: 'MATERIAL',
      name: material.name,
      unit,
      unitCost: material.cost ?? 0,
      unitSale: material.price ?? null,
      ...extra,
    },
  ];
};

type SectorRow = {
  id: string;
  name: string;
  saleUnit: string;
  hourCost: number | null;
  hourSale: number | null;
};

/** A mão de obra do setor, por minuto: custo-hora ÷ 60 e hora vendida ÷ 60. */
const laborResource = (sector: SectorRow): AssemblyResource => ({
  resourceId: `labor:${sector.id}`,
  kind: 'LABOR',
  name: `Mão de obra · ${sector.name}`,
  unit: 'min',
  unitCost: (sector.hourCost ?? 0) / 60,
  unitSale: sector.hourSale === null ? null : sector.hourSale / 60,
});

/** O recurso como opção do motor: a folha passa para metros. */
export const toEngineOption = (
  resource: AssemblyResource,
  option: {
    id: string;
    configName?: string | null;
    perUnit?: number | null;
    lossPercent?: number | null;
    minimum?: number | null;
  },
): EngineOption => ({
  id: option.id,
  resourceId: resource.resourceId,
  ...(option.configName ? { configName: option.configName } : {}),
  name: option.configName
    ? `${resource.name} · ${option.configName}`
    : resource.name,
  unit: resource.unit,
  unitCost: resource.unitCost,
  unitSale: resource.unitSale,
  ...(resource.sheet
    ? {
        sheet: {
          width: resource.sheet.width / 1000,
          height: resource.sheet.height / 1000,
          wholeSheets: resource.sheet.wholeSheets,
        },
      }
    : {}),
  ...(resource.profile ? { profile: resource.profile } : {}),
  ...(resource.weight ? { weight: resource.weight } : {}),
  // Nulo volta ao valor da linha (IP-26)
  ...(option.perUnit != null ? { perUnit: option.perUnit } : {}),
  ...(option.lossPercent != null ? { lossPercent: option.lossPercent } : {}),
  ...(option.minimum != null ? { minimum: option.minimum } : {}),
});

/**
 * Os recursos da composição, montados dos cadastros da empresa:
 * - material: o material de produção ativo, ou cada variação dele;
 * - mão de obra: o setor ativo que vende por hora (o que vende por
 *   equipamento não oferece mão de obra, AB-19), pelo custo-hora e pela hora
 *   vendida do setor.
 *
 * Máquina (configuração produtiva do patrimônio) e terceirizado entram com a
 * base de custos (módulo 4) e o orçamento (módulo 2).
 */
@Injectable()
export class AssemblyResourceService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: string, filter: ResourceFilter) {
    const page = filter.page ?? 1;
    const limit = Math.min(filter.limit ?? 50, RESOURCE_PAGE_LIMIT);
    const search = normalizeText(filter.search);

    const all = [
      ...(!filter.kind || filter.kind === 'LABOR'
        ? await this.laborOf(companyId)
        : []),
      ...(!filter.kind || filter.kind === 'MATERIAL'
        ? await this.materialsOf(companyId)
        : []),
    ]
      .filter((item) => !search || normalizeText(item.name).includes(search))
      .filter((item) => !filter.unit || item.unit === filter.unit);

    return {
      data: all.slice((page - 1) * limit, page * limit),
      page,
      lastPage: Math.max(1, Math.ceil(all.length / limit)),
      total: all.length,
    };
  }

  /**
   * Os recursos pelos ids, como o motor precisa. O que não está mais no
   * cadastro (material inativo, setor inativo) fica de fora: a linha mostra
   * a opção sem recurso.
   */
  async resolve(
    companyId: string,
    resourceIds: string[],
  ): Promise<Map<string, AssemblyResource>> {
    const result = new Map<string, AssemblyResource>();
    const materialIds = new Set<string>();
    const sectorIds = new Set<string>();
    for (const id of resourceIds) {
      const [kind, key] = id.split(':');
      if (kind === 'material' && key) materialIds.add(key);
      if (kind === 'labor' && key) sectorIds.add(key);
    }

    if (materialIds.size) {
      const materials = await this.prisma.material.findMany({
        where: { companyId, id: { in: [...materialIds] }, active: true },
        select: MATERIAL_SELECT,
      });
      materials
        .flatMap(materialResources)
        .forEach((resource) => result.set(resource.resourceId, resource));
    }
    if (sectorIds.size) {
      const sectors = await this.prisma.companySector.findMany({
        // A mão de obra do setor que vende pelo equipamento não é oferecida
        where: {
          companyId,
          id: { in: [...sectorIds] },
          isActive: true,
          saleUnit: 'HOUR',
        },
        select: {
          id: true,
          name: true,
          saleUnit: true,
          hourCost: true,
          hourSale: true,
        },
      });
      sectors
        .map(laborResource)
        .forEach((resource) => result.set(resource.resourceId, resource));
    }
    return result;
  }

  private async materialsOf(companyId: string) {
    const materials = await this.prisma.material.findMany({
      where: { companyId, active: true, productionMaterial: true },
      orderBy: [{ name: 'asc' }],
      select: MATERIAL_SELECT,
    });
    return materials.flatMap(materialResources);
  }

  private async laborOf(companyId: string) {
    const sectors = await this.prisma.companySector.findMany({
      where: { companyId, isActive: true, saleUnit: 'HOUR' },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        saleUnit: true,
        hourCost: true,
        hourSale: true,
      },
    });
    return sectors.map(laborResource);
  }
}
