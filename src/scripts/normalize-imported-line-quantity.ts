import { PrismaClient } from '@prisma/client';
import type { UnitKind } from '@prisma/client';
import { lineRawMeasure, lineUnitCost } from '../core/import/product-unit';

/**
 * Põe as linhas dos documentos migrados no formato que a tela grava.
 *
 * Cada linha tem duas quantidades: a da linha e a da composição do produto. A
 * tela grava o produto de uma composição com a linha em 1 e a quantidade na
 * composição (33.865 linhas em 09/11/2026; só 8 fora disso), e o modal de
 * edição desse produto lê só a da composição. A carga gravava o contrário —
 * linha = N, composição = 1 —, em 19.418 linhas de 9 contas. Listagem, PDF,
 * nota fiscal e relatório multiplicam as duas e saíam certos. O modal mostrava
 * "Quantidade 1" e um valor N vezes menor e, se alguém mexesse num campo e
 * salvasse, gravava esse valor: na Clapp, uma O.S. de 110 cartões a R$ 1,20
 * ficou em R$ 12,00.
 *
 * Move o N da linha para a composição, e para `originalQuantity`, como a tela
 * grava. Taxa e totais não mudam: a medida total é a mesma.
 *
 * Só mexe na linha de uma composição exatamente como a carga a gravou: total
 * igual ao preço e taxa igual ao total dividido pela medida e pela
 * quantidade. Fica como está a linha alterada depois da carga e a de unidade
 * sem medida na linha (comprimento, hora…), que o modal já não calcula.
 *
 * Não depende do legado: vale também para a conta migrada pela linha de
 * comando. É idempotente. Sem --yes apenas relata.
 *
 * Uso:
 *   npm run documentos:quantidade:dev -- --company-id=<id> [--yes]
 *   npm run documentos:quantidade -- --company-id=<id> [--yes]   (contêiner)
 */

/** Uma linha de documento migrado com uma composição. */
export interface MigratedLine {
  lineId: string;
  itemId: string;
  /** Quantidade da linha (`quotation_products.quantity`). */
  lineQuantity: number;
  /** Quantidade da composição (`quotation_product_items.quantity`). */
  quantity: number;
  unitKind: UnitKind | null;
  unitCost: number | null;
  salePrice: number | null;
  totalValue: number | null;
  width: number | null;
  height: number | null;
}

export type QuantityDecision =
  | { action: 'move'; quantity: number }
  | { action: 'ok' }
  | { action: 'skip'; reason: SkipReason };

export type SkipReason = 'alterada' | 'sem-medida' | 'composicao';

/** Igualdade de valor gravado: a taxa por mm² tem muitas casas decimais. */
function sameValue(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
}

/** O que fazer com a quantidade da linha. */
export function decideQuantity(line: MigratedLine): QuantityDecision {
  if (line.lineQuantity <= 1) return { action: 'ok' };

  // Quantidade nos dois lugares: não é o formato desta carga.
  if (line.quantity !== 1) return { action: 'skip', reason: 'composicao' };

  const kind = line.unitKind;
  const dims = { width: line.width, height: line.height };
  if (
    (kind !== null && kind !== 'UNITY' && kind !== 'AREA') ||
    !(lineRawMeasure(kind, dims, 1) > 0)
  ) {
    return { action: 'skip', reason: 'sem-medida' };
  }

  const total = line.salePrice;
  const untouched =
    total !== null &&
    sameValue(total, line.totalValue) &&
    sameValue(
      line.unitCost,
      lineUnitCost(total, kind, dims, line.lineQuantity),
    );

  if (!untouched) return { action: 'skip', reason: 'alterada' };
  return { action: 'move', quantity: line.lineQuantity };
}

export interface QuantityPlan {
  move: { line: MigratedLine; quantity: number }[];
  skipped: Record<SkipReason, number>;
  /** Produto composto: a quantidade fica na linha, como na tela. */
  composite: number;
}

/** Tamanho da página: o contêiner da API tem 512 MiB. */
const PAGE = 1000;

/** Linhas migradas com a quantidade na linha, página a página. */
export async function planQuantities(
  prisma: PrismaClient,
  companyId: string,
): Promise<QuantityPlan> {
  const plan: QuantityPlan = {
    move: [],
    skipped: { alterada: 0, 'sem-medida': 0, composicao: 0 },
    composite: 0,
  };
  let cursor: string | undefined;

  for (;;) {
    const page = await prisma.quotationProduct.findMany({
      where: {
        quantity: { gt: 1 },
        quotation: { companyId, isImported: true },
      },
      select: {
        id: true,
        quantity: true,
        items: {
          select: {
            id: true,
            quantity: true,
            unitKind: true,
            unitCost: true,
            salePrice: true,
            totalValue: true,
            width: true,
            height: true,
          },
        },
      },
      orderBy: { id: 'asc' },
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    for (const row of page) {
      if (row.items.length !== 1) {
        plan.composite++;
        continue;
      }

      const [item] = row.items;
      const line: MigratedLine = {
        lineId: row.id,
        itemId: item.id,
        lineQuantity: row.quantity,
        quantity: item.quantity,
        unitKind: item.unitKind,
        unitCost: item.unitCost,
        salePrice: item.salePrice,
        totalValue: item.totalValue,
        width: item.width,
        height: item.height,
      };

      const decision = decideQuantity(line);
      if (decision.action === 'move') {
        plan.move.push({ line, quantity: decision.quantity });
      } else if (decision.action === 'skip') {
        plan.skipped[decision.reason]++;
      }
    }

    if (page.length < PAGE) break;
    cursor = page[page.length - 1].id;
  }

  return plan;
}

/** Quantas linhas gravar por transação. */
const BATCH = 100;

export async function applyQuantities(
  prisma: PrismaClient,
  plan: QuantityPlan,
): Promise<void> {
  for (let i = 0; i < plan.move.length; i += BATCH) {
    const batch = plan.move.slice(i, i + BATCH);
    await prisma.$transaction(
      batch.flatMap(({ line, quantity }) => [
        prisma.quotationProduct.update({
          where: { id: line.lineId },
          data: { quantity: 1 },
        }),
        prisma.quotationProductItem.update({
          where: { id: line.itemId },
          data: { quantity, originalQuantity: quantity },
        }),
      ]),
    );
  }
}

function flagValue(args: string[], name: string): string | undefined {
  const prefixo = `--${name}=`;
  return args.find((a) => a.startsWith(prefixo))?.slice(prefixo.length);
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--yes');
  const companyId = flagValue(args, 'company-id');

  if (!companyId) {
    console.error(
      'Uso: normalize-imported-line-quantity --company-id=<id> [--yes]',
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();

  try {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true },
    });
    if (!company) throw new Error(`Empresa ${companyId} não encontrada`);

    console.log(`Empresa: ${company.name} (${company.id})`);
    console.log(
      apply
        ? 'Modo:    corrigindo\n'
        : 'Modo:    simulação (use --yes para gravar)\n',
    );

    const plan = await planQuantities(prisma, company.id);
    const linha = (label: string, total: number) =>
      console.log(`  ${label.padEnd(44)} ${String(total).padStart(6)}`);

    console.log('Linhas migradas com a quantidade na linha');
    linha('mover a quantidade para a composição', plan.move.length);
    linha('alteradas depois da carga (mantidas)', plan.skipped.alterada);
    linha('sem medida na linha (mantidas)', plan.skipped['sem-medida']);
    linha('quantidade nos dois lugares (mantidas)', plan.skipped.composicao);
    linha('produto composto (fica na linha)', plan.composite);

    if (apply) {
      await applyQuantities(prisma, plan);
      // Para desfazer: linha = N e composição = 1 (originalQuantity = 1).
      console.log('\nLinhas corrigidas (linha, composição, quantidade):');
      for (const { line, quantity } of plan.move) {
        console.log(`  LINHA ${line.lineId} ${line.itemId} ${quantity}`);
      }
      console.log('\nQuantidades corrigidas.');
    } else {
      console.log('\nNada foi gravado.');
    }
  } catch (error: any) {
    console.error(`\nFalhou: ${error.message}`);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main();
}
