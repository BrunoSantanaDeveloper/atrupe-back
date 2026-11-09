import { PrismaClient } from '@prisma/client';
import type { UnitKind } from '@prisma/client';
import * as mysql from 'mysql2/promise';
import {
  LEGACY_COMPANY_SQL,
  LEGACY_SALE_UNIT_SQL,
  PRODUCT_CODE_SQL,
  PRODUCT_UNIT_SQL,
  text,
} from './legacy-extractors';
import { assertSameCompany } from './legacy-destination-guard';
import { importValueToCents } from '../core/import/import-number';
import {
  importedItemPrices,
  lineUnitCost,
  unitKindFromCode,
} from '../core/import/product-unit';
import { isExampleProduct } from '../core/import/example-products';

/**
 * Põe os produtos já migrados — e as linhas dos documentos migrados — na
 * unidade e na situação que têm no legado.
 *
 * Até 11/2026 a carga tirava a unidade do serviço ou do item de venda, mas o
 * legado guarda a unidade de cobrança no tipo de cálculo do produto, e o item
 * de venda diz "UN" até no produto vendido por m². Nas oito contas migradas
 * pela tela, produto por m² entrou como unidade avulsa ou sem unidade: o preço
 * por m² virou preço por peça. O status também não vinha, e o produto fora de
 * linha entrou ativo ao lado do que o substituiu — o cliente leu como
 * duplicado.
 *
 * A carga de hoje já lê os dois. Este script é para o que entrou antes. Só
 * mexe no que a carga gravou e ninguém tocou depois:
 *
 * - produto: o item precisa estar exatamente como a carga o deixou (mesma
 *   unidade, custo e preço tirados do valor do legado, sem medida). Inativa o
 *   que está inativo no legado, menos o que um documento feito no Atrupe já
 *   usa. Não reativa nada. Produto adotado (cadastro da conta vinculado ao
 *   legado) não é tocado, como na própria carga.
 * - exemplos, só na conta criada para a migração: o exemplo que a carga
 *   adotou no lugar de um produto do legado passa a ser esse produto (nome,
 *   unidade, preço, situação, setor), com o histórico que já está nele. O
 *   exemplo que não corresponde a nada sai de linha.
 * - linhas de documento migrado: a do produto por m² que tem medida passa a
 *   área, e a da O.S. de produto por unidade, que a carga gravava sem unidade,
 *   passa a unidade. A taxa é recalculada pela regra da carga, e o total da
 *   linha não muda. Linha alterada depois da carga fica como está.
 *
 * É idempotente. Sem --yes apenas relata o que mudaria.
 *
 * Uso:
 *   npm run produtos:legado:dev -- --company-id=<id> <base> [--yes]
 *   npm run produtos:legado -- --company-id=<id> <base> [--yes]   (contêiner)
 *
 * --por-codigo casa também pelo código os produtos importados sem vínculo com
 * o legado — as cargas anteriores a 28/09/2026 não gravavam o vínculo.
 * --exemplos trata os exemplos mesmo quando a migração não registrou a conta
 * como criada para ela (carga pela linha de comando).
 */

/** Um produto do legado, com o que decide unidade, situação e cadastro. */
export interface LegacyProduct {
  codigo: string;
  nome: string;
  descricao: string;
  setor: string;
  grupo: string;
  ativo: boolean;
  /** Unidade de cobrança, pela regra de hoje. */
  unidade: string;
  /** Unidade que a carga derivava antes desta correção. */
  unidadeMigrada: string;
  /** Valor por unidade de exibição (R$/m², R$/un…), em centavos. */
  valorCentavos: number | null;
}

export interface ItemSnapshot {
  id: string;
  unitKind: UnitKind | null;
  unitCost: number | null;
  salePrice: number | null;
  width: number | null;
  height: number | null;
  length: number | null;
  duration: number | null;
}

export interface ProductSnapshot {
  id: string;
  code: string;
  name: string;
  legacyId: string | null;
  isImported: boolean;
  isStandard: boolean;
  isActive: boolean;
  items: ItemSnapshot[];
  /** Linhas em documento feito no Atrupe, fora da migração. */
  ownUses: number;
  fiscalNcm: string | null;
}

export interface ItemPrices {
  unitKind: UnitKind | null;
  unitCost: number | null;
  salePrice: number | null;
}

export type UnitDecision =
  | { action: 'fix'; itemId: string; from: ItemPrices; to: ItemPrices }
  | { action: 'ok' }
  | { action: 'review'; reason: string }
  | { action: 'skip'; reason: string };

export type StatusDecision = 'deactivate' | 'in-use' | 'none';

/**
 * Tipo que a carga anterior gravava para a unidade. Ela não conhecia "HH", a
 * hora do legado, e a tratava como unidade avulsa.
 */
export function kindAsMigrated(unidade: string): UnitKind | null {
  const code = unidade.trim().toUpperCase();
  if (code === 'HH') return 'UNITY';
  return unitKindFromCode(code);
}

/** Igualdade de valor gravado: a taxa por mm² tem muitas casas decimais. */
function sameValue(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
}

/** O que fazer com a unidade do produto. */
export function decideUnit(
  legacy: LegacyProduct,
  product: ProductSnapshot,
): UnitDecision {
  if (!product.isImported) {
    return { action: 'skip', reason: 'adotado: cadastro da conta' };
  }

  if (product.items.length !== 1) {
    return {
      action: 'review',
      reason: `${product.items.length} itens, e a carga cria um`,
    };
  }

  const target = unitKindFromCode(legacy.unidade);
  if (!target) return { action: 'skip', reason: 'legado sem unidade' };

  const [item] = product.items;
  if (item.unitKind === target) return { action: 'ok' };

  const migratedKind = kindAsMigrated(legacy.unidadeMigrada);
  const migrated = importedItemPrices(legacy.valorCentavos, migratedKind);

  const untouched =
    item.unitKind === migratedKind &&
    sameValue(item.unitCost, migrated.unitCost) &&
    sameValue(item.salePrice, migrated.salePrice) &&
    item.width === null &&
    item.height === null &&
    item.length === null &&
    item.duration === null;

  if (!untouched) {
    return { action: 'review', reason: 'alterado depois da carga' };
  }

  return {
    action: 'fix',
    itemId: item.id,
    from: {
      unitKind: item.unitKind,
      unitCost: item.unitCost,
      salePrice: item.salePrice,
    },
    to: {
      unitKind: target,
      ...importedItemPrices(legacy.valorCentavos, target),
    },
  };
}

/** O que fazer com a situação do produto. */
export function decideStatus(
  legacy: LegacyProduct,
  product: ProductSnapshot,
): StatusDecision {
  if (!product.isImported || legacy.ativo || !product.isActive) return 'none';
  // O cliente já vendeu o produto no Atrupe: tirar da listagem agora o
  // surpreenderia no próximo orçamento.
  return product.ownUses > 0 ? 'in-use' : 'deactivate';
}

export type ExampleDecision =
  | { action: 'convert'; legacy: LegacyProduct; active: boolean }
  | { action: 'deactivate' }
  | { action: 'in-use' }
  | { action: 'review'; reason: string }
  | { action: 'none' };

/**
 * O que fazer com um produto de exemplo de uma conta criada para a migração.
 *
 * `legacy` é o produto do legado que a carga pendurou nele — pelo vínculo,
 * quando adotou por nome, ou pelo código, quando o exemplo ocupava o código.
 * `legacyTaken` diz que outro produto da conta já tem o vínculo com ele.
 */
export function decideExample(
  product: ProductSnapshot,
  legacy: LegacyProduct | undefined,
  legacyTaken = false,
): ExampleDecision {
  if (product.isImported || !isExampleProduct(product)) {
    return { action: 'none' };
  }

  if (legacy && !legacyTaken) {
    if (product.items.length !== 1) {
      return {
        action: 'review',
        reason: `${product.items.length} itens no exemplo`,
      };
    }
    return {
      action: 'convert',
      legacy,
      active: legacy.ativo || product.ownUses > 0,
    };
  }

  if (!product.isActive) return { action: 'none' };
  return product.ownUses > 0 ? { action: 'in-use' } : { action: 'deactivate' };
}

/** Uma linha de documento migrado. */
export interface LineSnapshot {
  id: string;
  productId: string;
  unitKind: UnitKind | null;
  unitCost: number | null;
  salePrice: number | null;
  totalValue: number | null;
  width: number | null;
  height: number | null;
  /** Quantidade da composição; a carga grava 1. */
  quantity: number;
  /** Quantidade da linha do documento. */
  lineQuantity: number;
}

export type LineDecision =
  | {
      action: 'fix';
      to: { unitKind: UnitKind; unitCost: number | null };
    }
  | { action: 'ok' }
  | { action: 'review' }
  | { action: 'skip' };

/**
 * O que fazer com a linha, dada a unidade do produto no legado.
 *
 * Só mexe na linha como a carga a gravou: composição com quantidade 1, total
 * igual ao preço, e taxa coerente com unidade avulsa ou com área. Fora disso
 * alguém abriu e salvou a linha.
 */
export function decideLine(
  target: UnitKind | null,
  line: LineSnapshot,
): LineDecision {
  if (target !== 'AREA' && target !== 'UNITY') return { action: 'skip' };
  if (line.unitKind === target) return { action: 'ok' };

  const total = line.salePrice;
  const dims = { width: line.width, height: line.height };
  const untouched =
    line.quantity === 1 &&
    total !== null &&
    sameValue(total, line.totalValue) &&
    (sameValue(
      line.unitCost,
      lineUnitCost(total, 'UNITY', dims, line.lineQuantity),
    ) ||
      sameValue(
        line.unitCost,
        lineUnitCost(total, 'AREA', dims, line.lineQuantity),
      ));

  if (!untouched) return { action: 'review' };

  if (target === 'AREA') {
    // Sem largura e altura não há área: a linha segue como foi vendida.
    if (!(line.width > 0 && line.height > 0)) return { action: 'skip' };
    return {
      action: 'fix',
      to: {
        unitKind: 'AREA',
        unitCost: lineUnitCost(total, 'AREA', dims, line.lineQuantity),
      },
    };
  }

  // Produto por unidade: só a linha de O.S., que a carga gravava sem unidade
  // e que o PDF lia como área quando tinha medida.
  if (line.unitKind !== null) return { action: 'review' };
  return {
    action: 'fix',
    to: {
      unitKind: 'UNITY',
      unitCost: lineUnitCost(total, 'UNITY', dims, line.lineQuantity),
    },
  };
}

/** Chave de casamento entre o código do legado e o vínculo do produto. */
const matchKey = (value: string) => value.trim().toLowerCase();

/** Produtos do legado pelo código que a carga grava em `legacyId`. */
export async function readLegacyProducts(
  legacy: mysql.Connection,
  base: string,
): Promise<Map<string, LegacyProduct>> {
  const [rows] = await legacy.query(`
    SELECT ${PRODUCT_CODE_SQL(base, 'p')} AS codigo,
           p.nome                         AS nome,
           p.descricao                    AS descricao,
           p.fkidstatus                   AS status,
           s.setor                        AS setor,
           cat.categoria                  AS grupo,
           ${PRODUCT_UNIT_SQL(base, 'p', 'sv')} AS unidade,
           ${LEGACY_SALE_UNIT_SQL(base, 'p', 'sv')} AS unidadeMigrada,
           sv.valor                       AS valor
      FROM ${base}.est_produto p
      LEFT JOIN ${base}.emp_setor s ON s.idsetor = p.fkidsetor
      LEFT JOIN ${base}.est_produto_categoria cat ON cat.idcategoria = p.fkidcategoria
      LEFT JOIN ${base}.ven_servico sv ON sv.idservico = p.fkidservico
  `);

  const byCode = new Map<string, LegacyProduct>();
  for (const row of rows as any[]) {
    const codigo = text(row.codigo);
    if (!codigo) continue;

    byCode.set(matchKey(codigo), {
      codigo,
      nome: text(row.nome),
      descricao: text(row.descricao),
      setor: text(row.setor),
      grupo: text(row.grupo),
      ativo: Number(row.status) === 1,
      unidade: text(row.unidade),
      unidadeMigrada: text(row.unidadeMigrada),
      valorCentavos: importValueToCents(text(row.valor)),
    });
  }

  return byCode;
}

/** O produto do legado ligado ao produto da conta. */
const legacyOf = (
  legacyByCode: Map<string, LegacyProduct>,
  product: ProductSnapshot,
) => legacyByCode.get(matchKey(product.legacyId ?? product.code));

export interface FixPlan {
  unitFixes: {
    product: ProductSnapshot;
    legacy: LegacyProduct;
    decision: Extract<UnitDecision, { action: 'fix' }>;
  }[];
  unitOk: number;
  unitReview: {
    product: ProductSnapshot;
    legacy: LegacyProduct;
    reason: string;
  }[];
  unitSkipped: number;
  deactivate: { product: ProductSnapshot; legacy: LegacyProduct }[];
  inUse: { product: ProductSnapshot; legacy: LegacyProduct }[];
  unmatched: number;
}

/** Decide, sem gravar, o que muda em cada produto da conta. */
export function planFixes(
  legacyByCode: Map<string, LegacyProduct>,
  products: ProductSnapshot[],
): FixPlan {
  const plan: FixPlan = {
    unitFixes: [],
    unitOk: 0,
    unitReview: [],
    unitSkipped: 0,
    deactivate: [],
    inUse: [],
    unmatched: 0,
  };

  for (const product of products) {
    const legacy = legacyOf(legacyByCode, product);
    if (!legacy) {
      plan.unmatched++;
      continue;
    }

    const unit = decideUnit(legacy, product);
    if (unit.action === 'fix') {
      plan.unitFixes.push({ product, legacy, decision: unit });
    } else if (unit.action === 'ok') {
      plan.unitOk++;
    } else if (unit.action === 'review') {
      plan.unitReview.push({ product, legacy, reason: unit.reason });
    } else {
      plan.unitSkipped++;
    }

    const status = decideStatus(legacy, product);
    if (status === 'deactivate') plan.deactivate.push({ product, legacy });
    if (status === 'in-use') plan.inUse.push({ product, legacy });
  }

  return plan;
}

export interface ExamplePlan {
  convert: {
    product: ProductSnapshot;
    legacy: LegacyProduct;
    active: boolean;
  }[];
  deactivate: ProductSnapshot[];
  inUse: ProductSnapshot[];
  review: { product: ProductSnapshot; reason: string }[];
}

/** Decide o destino de cada exemplo da conta criada para a migração. */
export function planExamples(
  legacyByCode: Map<string, LegacyProduct>,
  examples: ProductSnapshot[],
  /** Todos os produtos da conta, para não repetir um vínculo. */
  products: ProductSnapshot[],
): ExamplePlan {
  const plan: ExamplePlan = {
    convert: [],
    deactivate: [],
    inUse: [],
    review: [],
  };

  for (const example of examples) {
    const legacy = legacyOf(legacyByCode, example);
    const taken =
      !!legacy &&
      products.some(
        (other) =>
          other.id !== example.id &&
          other.legacyId !== null &&
          matchKey(other.legacyId) === matchKey(legacy.codigo),
      );

    const decision = decideExample(example, legacy, taken);
    if (decision.action === 'convert') {
      plan.convert.push({
        product: example,
        legacy: decision.legacy,
        active: decision.active,
      });
    } else if (decision.action === 'deactivate') {
      plan.deactivate.push(example);
    } else if (decision.action === 'in-use') {
      plan.inUse.push(example);
    } else if (decision.action === 'review') {
      plan.review.push({ product: example, reason: decision.reason });
    }
  }

  return plan;
}

const productSelect = {
  id: true,
  code: true,
  name: true,
  legacyId: true,
  isImported: true,
  isStandard: true,
  isActive: true,
  fiscalData: { select: { ncm: true } },
  items: {
    select: {
      id: true,
      unitKind: true,
      unitCost: true,
      salePrice: true,
      width: true,
      height: true,
      length: true,
      duration: true,
    },
  },
} as const;

/** Linhas em documento feito no Atrupe, por produto. */
async function loadOwnUses(prisma: PrismaClient, companyId: string) {
  const uses = await prisma.quotationProduct.groupBy({
    by: ['productId'],
    where: {
      product: { companyId },
      quotation: { isImported: false },
    },
    _count: { _all: true },
  });
  return new Map(uses.map((u) => [u.productId, u._count._all]));
}

const toSnapshot = (product: any, ownUses: Map<string, number>) => {
  const { fiscalData, ...rest } = product;
  return {
    ...rest,
    fiscalNcm: fiscalData?.ncm ?? null,
    ownUses: ownUses.get(product.id) ?? 0,
  } as ProductSnapshot;
};

/** Produtos da conta que vieram do legado, com o que a decisão precisa. */
export async function loadProducts(
  prisma: PrismaClient,
  companyId: string,
  options: { byCode?: boolean } = {},
): Promise<ProductSnapshot[]> {
  const products = await prisma.product.findMany({
    where: {
      companyId,
      OR: [
        { legacyId: { not: null } },
        ...(options.byCode ? [{ isImported: true, legacyId: null }] : []),
      ],
    },
    select: productSelect,
  });

  const ownUses = await loadOwnUses(prisma, companyId);
  return products.map((product) => toSnapshot(product, ownUses));
}

/** Exemplos da conta: o que a migração não criou e veio do cadastro inicial. */
export async function loadExamples(
  prisma: PrismaClient,
  companyId: string,
): Promise<ProductSnapshot[]> {
  const products = await prisma.product.findMany({
    where: { companyId, isImported: false },
    select: productSelect,
  });

  const ownUses = await loadOwnUses(prisma, companyId);
  return products
    .map((product) => toSnapshot(product, ownUses))
    .filter(isExampleProduct);
}

export interface LinePlan {
  fixes: {
    line: LineSnapshot;
    to: { unitKind: UnitKind; unitCost: number | null };
  }[];
  ok: number;
  review: number;
  skipped: number;
}

/** Tamanho da página de linhas: o contêiner da API tem 512 MiB. */
const LINE_PAGE = 2000;

/** Decide as linhas dos documentos migrados, página a página. */
export async function planLines(
  prisma: PrismaClient,
  companyId: string,
  targetByProduct: Map<string, UnitKind | null>,
): Promise<LinePlan> {
  const plan: LinePlan = { fixes: [], ok: 0, review: 0, skipped: 0 };
  let cursor: string | undefined;

  for (;;) {
    const page = await prisma.quotationProductItem.findMany({
      where: {
        quotationProduct: { quotation: { companyId, isImported: true } },
      },
      select: {
        id: true,
        productId: true,
        unitKind: true,
        unitCost: true,
        salePrice: true,
        totalValue: true,
        width: true,
        height: true,
        quantity: true,
        quotationProduct: { select: { quantity: true } },
      },
      orderBy: { id: 'asc' },
      take: LINE_PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    for (const row of page) {
      if (!targetByProduct.has(row.productId)) {
        plan.skipped++;
        continue;
      }

      const line: LineSnapshot = {
        id: row.id,
        productId: row.productId,
        unitKind: row.unitKind,
        unitCost: row.unitCost,
        salePrice: row.salePrice,
        totalValue: row.totalValue,
        width: row.width,
        height: row.height,
        quantity: row.quantity,
        lineQuantity: row.quotationProduct.quantity,
      };

      const decision = decideLine(targetByProduct.get(row.productId), line);
      if (decision.action === 'fix') {
        plan.fixes.push({ line, to: decision.to });
      } else if (decision.action === 'ok') {
        plan.ok++;
      } else if (decision.action === 'review') {
        plan.review++;
      } else {
        plan.skipped++;
      }
    }

    if (page.length < LINE_PAGE) break;
    cursor = page[page.length - 1].id;
  }

  return plan;
}

/**
 * A conta foi criada só para a migração? A tela registra isso na nota do
 * financeiro, que entra inteiro em vez de cortado na data de uso.
 */
export async function createdForMigration(
  prisma: PrismaClient,
  companyId: string,
  base: string,
): Promise<boolean> {
  const runs = await prisma.migrationRun.findMany({
    where: { companyId, legacyBase: base, dryRun: false, status: 'COMPLETED' },
    select: { summary: true },
  });

  return runs.some((run) =>
    ((run.summary as any[]) ?? []).some((step: any) =>
      (step?.notes ?? []).some((note: string) =>
        String(note).startsWith('Corte por data desligado'),
      ),
    ),
  );
}

/** NCM padrão da empresa, pela mesma regra do cadastro fiscal automático. */
async function companyDefaultNcm(prisma: PrismaClient, companyId: string) {
  const config =
    (await prisma.invoicyConfig.findFirst({
      where: { companyId, isDefault: true },
      select: { defaultNcm: true },
    })) ??
    (await prisma.invoicyConfig.findFirst({
      where: { companyId },
      orderBy: { createdAt: 'asc' },
      select: { defaultNcm: true },
    }));
  return config?.defaultNcm || '49119900';
}

/** NCM do cadastro de exemplo, que nenhuma nota aceita. */
const PLACEHOLDER_NCM = '00000000';

const collator = new Intl.Collator('pt-BR', {
  sensitivity: 'base',
  usage: 'search',
});
const sameName = (a: string, b: string) =>
  collator.compare(a.trim(), b.trim()) === 0;

/** Grava a conversão dos exemplos no produto do legado e inativa o resto. */
async function applyExamples(
  prisma: PrismaClient,
  companyId: string,
  plan: ExamplePlan,
): Promise<void> {
  if (plan.convert.length === 0 && plan.deactivate.length === 0) return;

  const [sectors, categories, codes, ncm] = await Promise.all([
    prisma.companySector.findMany({
      where: { companyId },
      select: { id: true, name: true },
    }),
    prisma.category.findMany({
      where: { companyId, kind: 'PRODUCT' },
      select: { id: true, name: true },
    }),
    prisma.product.findMany({ where: { companyId }, select: { code: true } }),
    companyDefaultNcm(prisma, companyId),
  ]);
  const taken = new Set(codes.map((c) => matchKey(c.code)));

  for (const { product, legacy, active } of plan.convert) {
    const sector = sectors.find(
      (s) => legacy.setor && sameName(s.name, legacy.setor),
    );
    const category = categories.find(
      (c) => legacy.grupo && sameName(c.name, legacy.grupo),
    );
    // O código do legado, como a carga grava, quando está livre.
    const code =
      matchKey(product.code) === matchKey(legacy.codigo) ||
      !taken.has(matchKey(legacy.codigo))
        ? legacy.codigo
        : product.code;
    taken.add(matchKey(code));

    const kind = unitKindFromCode(legacy.unidade);
    await prisma.product.update({
      where: { id: product.id },
      data: {
        code,
        name: legacy.nome,
        technicalDescription: legacy.descricao || null,
        imageUrl: null,
        isStandard: false,
        isImported: true,
        legacyId: legacy.codigo,
        isActive: active,
        ...(sector && { sectorId: sector.id }),
        ...(category && { categoryId: category.id }),
      },
    });
    await prisma.productItem.update({
      where: { id: product.items[0].id },
      data: {
        name: legacy.nome,
        unitKind: kind,
        ...importedItemPrices(legacy.valorCentavos, kind),
        width: null,
        height: null,
        length: null,
        duration: null,
      },
    });
    if (product.fiscalNcm === PLACEHOLDER_NCM) {
      await prisma.productFiscalData.update({
        where: { productId: product.id },
        data: { ncm },
      });
    }
  }

  for (const product of plan.deactivate) {
    await prisma.product.update({
      where: { id: product.id },
      data: { isActive: false },
    });
  }
}

/** Quantas linhas gravar por transação. */
const LINE_BATCH = 200;

export async function applyFixes(
  prisma: PrismaClient,
  companyId: string,
  plan: FixPlan,
  examples: ExamplePlan,
  lines: LinePlan,
): Promise<void> {
  for (const { decision } of plan.unitFixes) {
    await prisma.productItem.update({
      where: { id: decision.itemId },
      data: decision.to,
    });
  }

  for (const { product } of plan.deactivate) {
    await prisma.product.update({
      where: { id: product.id },
      data: { isActive: false },
    });
  }

  await applyExamples(prisma, companyId, examples);

  for (let i = 0; i < lines.fixes.length; i += LINE_BATCH) {
    const batch = lines.fixes.slice(i, i + LINE_BATCH);
    await prisma.$transaction(
      batch.map(({ line, to }) =>
        prisma.quotationProductItem.update({
          where: { id: line.id },
          data: to,
        }),
      ),
    );
  }
}

const describeItem = (item: ItemPrices) =>
  `${item.unitKind ?? 'sem unidade'} custo=${item.unitCost ?? '-'} total=${item.salePrice ?? '-'}`;

const describeProduct = (product: ProductSnapshot) =>
  `${product.id} ${product.code} "${product.name}"`;

/** Unidades que vão mudar, como "M2 → AREA 51 · UN → UNITY 130". */
function changeBreakdown(plan: FixPlan): string {
  const counts = new Map<string, number>();
  for (const { legacy, decision } of plan.unitFixes) {
    const key = `${legacy.unidade.toUpperCase()} → ${decision.to.unitKind}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, total]) => `${key} ${total}`)
    .join(' · ');
}

/** Linhas que vão mudar, como "UNITY → AREA 1773 · sem unidade → UNITY 900". */
function lineBreakdown(lines: LinePlan): string {
  const counts = new Map<string, number>();
  for (const { line, to } of lines.fixes) {
    const key = `${line.unitKind ?? 'sem unidade'} → ${to.unitKind}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, total]) => `${key} ${total}`)
    .join(' · ');
}

export function printPlan(
  plan: FixPlan,
  examples: ExamplePlan | null,
  lines: LinePlan,
  apply: boolean,
): void {
  const linha = (label: string, total: number, extra = '') =>
    console.log(
      `  ${label.padEnd(40)} ${String(total).padStart(6)}${extra ? `   ${extra}` : ''}`,
    );

  console.log('Unidade do produto');
  linha('corrigir', plan.unitFixes.length, changeBreakdown(plan));
  linha('já na unidade do legado', plan.unitOk);
  linha('alterados depois da carga (conferir)', plan.unitReview.length);
  linha('adotados ou sem unidade no legado', plan.unitSkipped);
  console.log('Situação do produto');
  linha('inativar (inativo no legado)', plan.deactivate.length);
  linha('inativo no legado, mas usado no Atrupe', plan.inUse.length);
  if (examples) {
    console.log('Exemplos da conta (criada para a migração)');
    linha('viram o produto do legado', examples.convert.length);
    linha('inativar', examples.deactivate.length);
    linha('usados no Atrupe (mantidos)', examples.inUse.length);
    linha('conferir', examples.review.length);
  }
  console.log('Linhas de documento migrado');
  linha('corrigir', lines.fixes.length, lineBreakdown(lines));
  linha('já na unidade do legado', lines.ok);
  linha('alteradas depois da carga (mantidas)', lines.review);
  linha('sem medida ou fora do legado', lines.skipped);
  if (plan.unmatched > 0) {
    console.log(
      `\n${plan.unmatched} produto(s) sem par no legado: ficam como estão.`,
    );
  }

  if (plan.unitFixes.length > 0) {
    console.log('\nUnidades corrigidas (antes → depois, para desfazer):');
    for (const { product, legacy, decision } of plan.unitFixes) {
      console.log(
        `  ${describeProduct(product)} [legado ${legacy.unidade}] ` +
          `${describeItem(decision.from)} → ${describeItem(decision.to)}`,
      );
    }
  }

  if (plan.deactivate.length > 0) {
    console.log('\nInativados (para desfazer, isActive = true nestes ids):');
    for (const { product } of plan.deactivate) {
      console.log(`  ${describeProduct(product)}`);
    }
  }

  if (examples && examples.convert.length > 0) {
    console.log('\nExemplos que viram o produto do legado (antes → depois):');
    for (const { product, legacy, active } of examples.convert) {
      const item = product.items[0];
      console.log(
        `  ${describeProduct(product)} ${describeItem(item)} → ` +
          `${legacy.codigo} "${legacy.nome}" [legado ${legacy.unidade || '-'} ` +
          `a ${legacy.valorCentavos ?? '-'} centavos] ${active ? 'ativo' : 'inativo'}` +
          `${product.fiscalNcm === PLACEHOLDER_NCM ? ' + NCM padrão' : ''}`,
      );
    }
  }

  if (examples && examples.deactivate.length > 0) {
    console.log('\nExemplos inativados (para desfazer, isActive = true):');
    for (const product of examples.deactivate) {
      console.log(`  ${describeProduct(product)}`);
    }
  }

  if (plan.unitReview.length > 0) {
    console.log('\nPara conferir com o cliente (unidade não mexida):');
    for (const { product, legacy, reason } of plan.unitReview) {
      const item = product.items[0];
      console.log(
        `  ${describeProduct(product)} — ${reason}; legado ${legacy.unidade || '-'} ` +
          `a ${legacy.valorCentavos ?? '-'} centavos; hoje ${item ? describeItem(item) : 'sem item'}`,
      );
    }
  }

  if (plan.inUse.length > 0) {
    console.log(
      '\nInativos no legado e usados em documento do Atrupe (mantidos ativos):',
    );
    for (const { product } of plan.inUse) {
      console.log(`  ${describeProduct(product)} — ${product.ownUses} uso(s)`);
    }
  }

  // Milhares de linhas: só na gravação, para desfazer.
  if (apply && lines.fixes.length > 0) {
    console.log('\nLinhas corrigidas (id, unidade e custo anteriores):');
    for (const { line } of lines.fixes) {
      console.log(
        `  LINHA ${line.id} ${line.unitKind ?? 'null'} ${line.unitCost}`,
      );
    }
  }
}

function flagValue(args: string[], name: string): string | undefined {
  const prefixo = `--${name}=`;
  return args.find((a) => a.startsWith(prefixo))?.slice(prefixo.length);
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--yes');
  const byCode = args.includes('--por-codigo');
  const forceExamples = args.includes('--exemplos');
  const companyId = flagValue(args, 'company-id');
  const [base] = args.filter((a) => !a.startsWith('--'));

  if (!companyId || !base) {
    console.error(
      'Uso: fix-legacy-products --company-id=<id> <base> [--por-codigo] [--exemplos] [--yes]',
    );
    process.exit(1);
  }

  if (!/^acn_\d+$/.test(base)) {
    console.error(`Nome de base inválido: '${base}'. Esperado acn_000000.`);
    process.exit(1);
  }

  const prisma = new PrismaClient();
  let legacy: mysql.Connection | undefined;

  try {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true, cnpj: true },
    });
    if (!company) throw new Error(`Empresa ${companyId} não encontrada`);

    legacy = await mysql.createConnection({
      host: process.env.LEGACY_DB_HOST || '127.0.0.1',
      port: Number(process.env.LEGACY_DB_PORT || 13306),
      user: process.env.LEGACY_DB_USER,
      password: process.env.LEGACY_DB_PASSWORD,
      connectTimeout: 20000,
    });

    // A base errada aplicaria unidade e situação de outro cliente.
    const [companyRows] = await legacy.query(LEGACY_COMPANY_SQL(base));
    const legacyCompany = (companyRows as any[])[0];
    if (!legacyCompany) throw new Error(`Base '${base}' não tem empresa`);
    assertSameCompany(legacyCompany, company);

    const forMigration =
      forceExamples || (await createdForMigration(prisma, company.id, base));

    console.log(`Empresa: ${company.name} (${company.id})`);
    console.log(
      `Base:    ${base} — ${legacyCompany.razao_social || legacyCompany.nome}`,
    );
    console.log(
      `Conta criada para a migração: ${forMigration ? 'sim' : 'não'}`,
    );
    console.log(
      apply
        ? 'Modo:    corrigindo\n'
        : 'Modo:    simulação (use --yes para gravar)\n',
    );

    const legacyByCode = await readLegacyProducts(legacy, base);
    const products = await loadProducts(prisma, company.id, { byCode });
    const plan = planFixes(legacyByCode, products);

    const examples = forMigration
      ? planExamples(
          legacyByCode,
          await loadExamples(prisma, company.id),
          products,
        )
      : null;

    // Unidade de cada produto no legado, para as linhas. O exemplo que vira
    // produto do legado entra pela mesma chave.
    const targetByProduct = new Map<string, UnitKind | null>();
    for (const product of [
      ...products,
      ...(examples?.convert.map((c) => c.product) ?? []),
    ]) {
      const match = legacyOf(legacyByCode, product);
      if (match)
        targetByProduct.set(product.id, unitKindFromCode(match.unidade));
    }
    const lines = await planLines(prisma, company.id, targetByProduct);

    printPlan(plan, examples, lines, apply);

    if (apply) {
      await applyFixes(
        prisma,
        company.id,
        plan,
        examples ?? {
          convert: [],
          deactivate: [],
          inUse: [],
          review: [],
        },
        lines,
      );
      console.log('\nProdutos e linhas corrigidos.');
    } else {
      console.log('\nNada foi gravado.');
    }
  } catch (error: any) {
    console.error(`\nFalhou: ${error.message}`);
    process.exit(1);
  } finally {
    await legacy?.end().catch(() => undefined);
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main();
}
