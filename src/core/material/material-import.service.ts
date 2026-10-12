import { BadRequestException, Injectable } from '@nestjs/common';
import { MaterialPriceRule, MaterialUnit, Prisma } from '@prisma/client';
import { PrismaService } from 'nestjs-prisma';
import { PricingParametersService } from '../pricing/pricing-parameters.service';
import { ImportDecidedRowDto, ImportRowDto } from './dto/import-material.dto';
import { materialNumbers } from './material-number';
import { costChange } from './material.service';
import { materialCode, normalizeText, unitFromText } from './material-text';

export type ImportStatus = 'NEW' | 'MATCH' | 'LINKED' | 'INVALID';

export type ImportPreviewRow = {
  line: number;
  name: string;
  unit: string;
  sector: string;
  cost: number | null;
  status: ImportStatus;
  /** O material conciliado: pelo nome (MATCH) ou pelo de-para (LINKED). */
  materialId: string | null;
  materialName: string | null;
  unitKey: MaterialUnit | null;
  problem?: string;
};

type KnownMaterial = { id: string; name: string; searchName: string };

/** O que a conciliação lê do cadastro da empresa. */
type Registry = {
  /** Materiais ativos pelo nome normalizado e pelo id. */
  byName: Map<string, KnownMaterial>;
  byId: Map<string, KnownMaterial>;
  /** De-para aprendido: nome de fora normalizado → id do material. */
  links: Map<string, string>;
  /** Setores da empresa pelo nome normalizado. */
  sectors: Map<string, string>;
};

/** O material novo precisa de setor: não há setor padrão para materiais. */
export const NEW_WITHOUT_SECTOR =
  'Sem setor: vincule a um material ou informe o setor na planilha';

/**
 * Concilia uma linha da planilha com o cadastro, em cascata: de-para
 * aprendido, depois o nome igual, depois material novo. Só concilia com
 * material ativo.
 */
export function classifyImportRow(
  row: ImportRowDto,
  line: number,
  registry: Registry,
): ImportPreviewRow & { sectorId: string | null } {
  const name = (row.name ?? '').trim();
  const sectorName = (row.sector ?? '').trim();
  const unitKey = unitFromText(row.unit);
  const base = {
    line,
    name: row.name ?? '',
    unit: row.unit ?? '',
    sector: row.sector ?? '',
    cost: row.cost ?? null,
    materialId: null,
    materialName: null,
    unitKey,
    sectorId: null,
  };

  if (!name) return { ...base, status: 'INVALID', problem: 'Linha sem nome' };
  if (!unitKey) {
    return {
      ...base,
      status: 'INVALID',
      problem: `Unidade "${row.unit ?? ''}" não reconhecida (use m², m, un, kg, l)`,
    };
  }
  const sectorId = sectorName
    ? (registry.sectors.get(normalizeText(sectorName)) ?? null)
    : null;
  if (sectorName && !sectorId) {
    return {
      ...base,
      status: 'INVALID',
      problem: `Setor "${sectorName}" não cadastrado`,
    };
  }

  const key = normalizeText(name);
  const linkedId = registry.links.get(key);
  const linked = linkedId ? registry.byId.get(linkedId) : undefined;
  const match = linked ?? registry.byName.get(key);
  if (match) {
    return {
      ...base,
      sectorId,
      status: linked ? 'LINKED' : 'MATCH',
      materialId: match.id,
      materialName: match.name,
    };
  }
  return {
    ...base,
    sectorId,
    status: 'NEW',
    ...(sectorId ? {} : { problem: NEW_WITHOUT_SECTOR }),
  };
}

/**
 * Importação de lista de materiais com conciliação (IMP-1): a prévia não
 * grava nada; a aplicação atualiza os vinculados, cadastra os novos e guarda
 * o de-para, tudo numa transação.
 */
@Injectable()
export class MaterialImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricingParameters: PricingParametersService,
  ) {}

  async preview(companyId: string, rows: ImportRowDto[]) {
    const registry = await this.registryOf(this.prisma, companyId);
    return {
      data: rows.map((row, index) => {
        const { sectorId: _sectorId, ...preview } = classifyImportRow(
          row,
          index + 1,
          registry,
        );
        return preview;
      }),
    };
  }

  async apply(companyId: string, rows: ImportDecidedRowDto[]) {
    const charges = await this.pricingParameters.chargesOf(companyId);

    return this.prisma.$transaction(
      async (tx) => {
        const registry = await this.registryOf(tx, companyId);
        const targets = await this.targetsOf(tx, companyId, rows);
        const nextNumber = await materialNumbers(tx, companyId);
        // O material que esta importação já cadastrou, pelo nome: a linha
        // repetida atualiza o mesmo material em vez de duplicá-lo
        const createdHere = new Map<string, string>();
        const count = { created: 0, updated: 0, ignored: 0 };

        for (const [index, row] of rows.entries()) {
          const line = classifyImportRow(row, index + 1, registry);
          if (line.status === 'INVALID') {
            count.ignored += 1;
            continue;
          }
          const key = normalizeText(line.name);
          const cost = row.cost ?? null;

          if (row.materialId) {
            const target = targets.get(row.materialId);
            // A decisão fica guardada: da próxima vez o sistema já sabe
            if (target.searchName !== key) {
              await tx.materialImportLink.upsert({
                where: {
                  companyId_externalName: { companyId, externalName: key },
                },
                create: {
                  companyId,
                  externalName: key,
                  materialId: target.id,
                },
                update: { materialId: target.id },
              });
            }
            // O custo é atualizado só onde ele vive: sem variação, no
            // material (MT-3)
            if (cost !== null && !target.hasVariations) {
              const change = costChange(
                target.priceRule,
                target,
                cost,
                charges,
              );
              if (Object.keys(change).length) {
                await tx.material.update({
                  where: { id: target.id },
                  data: change,
                });
                Object.assign(target, change);
              }
            }
            count.updated += 1;
            continue;
          }

          const repeated = createdHere.get(key);
          if (repeated) {
            if (cost !== null) {
              await tx.material.update({
                where: { id: repeated },
                data: { cost, costUpdatedAt: new Date() },
              });
            }
            count.updated += 1;
            continue;
          }

          if (!line.sectorId) {
            count.ignored += 1;
            continue;
          }
          const number = nextNumber();
          const created = await tx.material.create({
            data: {
              companyId,
              number,
              code: materialCode(number),
              name: line.name.trim(),
              searchName: key,
              sectorId: line.sectorId,
              subcategory: 'Importados',
              unit: line.unitKey as MaterialUnit,
              directSale: false,
              productionMaterial: true,
              priceRule: MaterialPriceRule.VARIABLE,
              cost,
              costUpdatedAt: cost === null ? null : new Date(),
            },
            select: { id: true },
          });
          createdHere.set(key, created.id);
          count.created += 1;
        }

        return count;
      },
      { timeout: 60_000 },
    );
  }

  private async registryOf(
    db: Prisma.TransactionClient,
    companyId: string,
  ): Promise<Registry> {
    const [materials, links, sectors] = await Promise.all([
      db.material.findMany({
        where: { companyId, active: true },
        select: { id: true, name: true, searchName: true },
        orderBy: { number: 'asc' },
      }),
      db.materialImportLink.findMany({
        where: { companyId },
        select: { externalName: true, materialId: true },
      }),
      db.companySector.findMany({
        where: { companyId, isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    const byName = new Map<string, KnownMaterial>();
    for (const material of materials) {
      // Nome repetido no cadastro: vale o mais antigo
      if (!byName.has(material.searchName)) {
        byName.set(material.searchName, material);
      }
    }
    const sectorIds = new Map<string, string>();
    for (const sector of sectors) {
      const key = normalizeText(sector.name);
      if (!sectorIds.has(key)) sectorIds.set(key, sector.id);
    }

    return {
      byName,
      byId: new Map(materials.map((material) => [material.id, material])),
      links: new Map(links.map((link) => [link.externalName, link.materialId])),
      sectors: sectorIds,
    };
  }

  /**
   * Os materiais que a pessoa escolheu atualizar. Precisam ser ativos e da
   * empresa: um id de fora recusa a importação inteira, sem gravar nada.
   */
  private async targetsOf(
    db: Prisma.TransactionClient,
    companyId: string,
    rows: ImportDecidedRowDto[],
  ) {
    const ids = [
      ...new Set(rows.map((row) => row.materialId).filter(Boolean)),
    ] as string[];
    const found = ids.length
      ? await db.material.findMany({
          where: { id: { in: ids }, companyId, active: true },
          select: {
            id: true,
            searchName: true,
            priceRule: true,
            cost: true,
            price: true,
            desiredMargin: true,
            _count: { select: { variations: true } },
          },
        })
      : [];
    if (found.length !== ids.length) {
      throw new BadRequestException(
        'Um dos materiais escolhidos não está mais ativo. Refaça a conciliação.',
      );
    }
    return new Map(
      found.map(({ _count, ...material }) => [
        material.id,
        { ...material, hasVariations: _count.variations > 0 },
      ]),
    );
  }
}
