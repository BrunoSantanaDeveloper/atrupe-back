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
  unitKindFromCode,
} from '../core/import/product-unit';

/**
 * Põe os produtos já migrados na unidade e na situação que têm no legado.
 *
 * Até 11/2026 a carga tirava a unidade do serviço ou do item de venda, mas o
 * legado guarda a unidade de cobrança no tipo de cálculo do produto, e o item
 * de venda diz "UN" até no produto vendido por m². Nas oito contas migradas
 * pela tela, produto por m² entrou como unidade avulsa ou sem unidade: o preço
 * por m² virou preço por peça. O status também não vinha, e o produto fora de
 * linha entrou ativo ao lado do que o substituiu — o cliente leu como
 * duplicado.
 *
 * A carga de hoje já lê os dois. Este script é para o que entrou antes.
 *
 * Só mexe no que a carga gravou e ninguém tocou depois:
 * - unidade: o item precisa estar exatamente como a carga o deixou — mesma
 *   unidade, custo e preço tirados do valor do legado, sem medida. O que o
 *   cliente já corrigiu ou alterou fica como está e sai listado para conferir.
 * - situação: inativa o produto que está inativo no legado, menos o que algum
 *   documento feito no Atrupe já usa. Não reativa nada.
 * - produto adotado (cadastro da conta que a carga vinculou ao legado) não é
 *   tocado, como na própria carga.
 *
 * As linhas dos documentos migrados guardam a própria unidade e não mudam: o
 * total delas veio do legado e continua certo.
 *
 * É idempotente. Sem --yes apenas relata o que mudaria.
 *
 * Uso:
 *   npm run produtos:legado:dev -- --company-id=<id> <base> [--yes]
 *   npm run produtos:legado -- --company-id=<id> <base> [--yes]   (contêiner)
 *
 * --por-codigo casa também pelo código os produtos importados sem vínculo com
 * o legado — as cargas anteriores a 28/09/2026 não gravavam o vínculo.
 */

/** Um produto do legado, com o que decide a unidade e a situação. */
export interface LegacyProduct {
  codigo: string;
  nome: string;
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
  isActive: boolean;
  items: ItemSnapshot[];
  /** Linhas em documento feito no Atrupe, fora da migração. */
  ownUses: number;
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
           p.fkidstatus                   AS status,
           ${PRODUCT_UNIT_SQL(base, 'p', 'sv')} AS unidade,
           ${LEGACY_SALE_UNIT_SQL(base, 'p', 'sv')} AS unidadeMigrada,
           sv.valor                       AS valor
      FROM ${base}.est_produto p
      LEFT JOIN ${base}.ven_servico sv ON sv.idservico = p.fkidservico
  `);

  const byCode = new Map<string, LegacyProduct>();
  for (const row of rows as any[]) {
    const codigo = text(row.codigo);
    if (!codigo) continue;

    byCode.set(matchKey(codigo), {
      codigo,
      nome: text(row.nome),
      ativo: Number(row.status) === 1,
      unidade: text(row.unidade),
      unidadeMigrada: text(row.unidadeMigrada),
      valorCentavos: importValueToCents(text(row.valor)),
    });
  }

  return byCode;
}

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
    const legacy = legacyByCode.get(matchKey(product.legacyId ?? product.code));
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
    select: {
      id: true,
      code: true,
      name: true,
      legacyId: true,
      isImported: true,
      isActive: true,
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
    },
  });

  const uses = await prisma.quotationProduct.groupBy({
    by: ['productId'],
    where: {
      product: { companyId },
      quotation: { isImported: false },
    },
    _count: { _all: true },
  });
  const ownUses = new Map(uses.map((u) => [u.productId, u._count._all]));

  return products.map((product) => ({
    ...product,
    ownUses: ownUses.get(product.id) ?? 0,
  }));
}

export async function applyFixes(
  prisma: PrismaClient,
  plan: FixPlan,
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

export function printPlan(plan: FixPlan): void {
  const linha = (label: string, total: number, extra = '') =>
    console.log(
      `  ${label.padEnd(40)} ${String(total).padStart(5)}${extra ? `   ${extra}` : ''}`,
    );

  console.log('Unidade');
  linha('corrigir', plan.unitFixes.length, changeBreakdown(plan));
  linha('já na unidade do legado', plan.unitOk);
  linha('alterados depois da carga (conferir)', plan.unitReview.length);
  linha('adotados ou sem unidade no legado', plan.unitSkipped);
  console.log('Situação');
  linha('inativar (inativo no legado)', plan.deactivate.length);
  linha('inativo no legado, mas usado no Atrupe', plan.inUse.length);
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
}

function flagValue(args: string[], name: string): string | undefined {
  const prefixo = `--${name}=`;
  return args.find((a) => a.startsWith(prefixo))?.slice(prefixo.length);
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--yes');
  const byCode = args.includes('--por-codigo');
  const companyId = flagValue(args, 'company-id');
  const [base] = args.filter((a) => !a.startsWith('--'));

  if (!companyId || !base) {
    console.error(
      'Uso: fix-legacy-products --company-id=<id> <base> [--por-codigo] [--yes]',
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

    console.log(`Empresa: ${company.name} (${company.id})`);
    console.log(
      `Base:    ${base} — ${legacyCompany.razao_social || legacyCompany.nome}`,
    );
    console.log(
      apply
        ? 'Modo:    corrigindo\n'
        : 'Modo:    simulação (use --yes para gravar)\n',
    );

    const legacyByCode = await readLegacyProducts(legacy, base);
    const products = await loadProducts(prisma, company.id, { byCode });
    const plan = planFixes(legacyByCode, products);

    printPlan(plan);

    if (apply) {
      await applyFixes(prisma, plan);
      console.log('\nProdutos corrigidos.');
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
