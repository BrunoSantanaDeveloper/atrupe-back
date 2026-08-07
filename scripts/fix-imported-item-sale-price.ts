/**
 * Corrige `product_items.sale_price` gravado com taxa por unidade bruta.
 *
 * PROBLEMA
 * Até a correção em `ImportService.importProduct`, quando o CSV trazia um produto
 * com unidade dimensional (M2, MT, KG, L, KM, H) mas SEM a medida correspondente
 * (largura/altura, duração…), o importador caía no ramo genérico e gravava
 * `salePrice = rawUnitCost`.
 *
 * `unitCost` está na unidade bruta interna (R$/mm² para AREA, R$/segundo para
 * DURATION…), enquanto `salePrice` é um TOTAL em centavos. Misturar os dois produz
 * números microscópicos: TELHA T25 a R$ 450,00/m² virou `salePrice = 0,045`
 * centavos. A listagem de itens do orçamento, que lê `salePrice`, exibia "0,00",
 * enquanto o modal de detalhe — que lê `unitCost` e converte de volta para a
 * unidade de exibição — mostrava "450,00". Daí a inconsistência relatada.
 *
 * O QUE FAZ
 * Zera (null) o `salePrice` de itens com unidade dimensional que não têm a medida
 * necessária para calcular um total. Sem a medida, não existe total possível: o
 * valor correto é `null`, e o frontend calcula o total no orçamento assim que a
 * medida é informada. O `unitCost` (que guarda o preço por m², por hora etc.) NÃO
 * é tocado — é ele que preserva os R$ 450,00 do CSV.
 *
 * Itens com unidade UNITY não são candidatos: para eles `unitCost` e `salePrice`
 * coincidem legitimamente (fator de conversão 1).
 *
 * Idempotente: rodar de novo não encontra mais candidatos.
 *
 * Rode com --dry-run primeiro.
 *
 * Uso:
 *   npx ts-node scripts/fix-imported-item-sale-price.ts --dry-run
 *   npx ts-node scripts/fix-imported-item-sale-price.ts
 *   npx ts-node scripts/fix-imported-item-sale-price.ts --company=<companyId>
 */
import { PrismaClient, UnitKind } from '@prisma/client';

const prisma = new PrismaClient();

const isDryRun = process.argv.includes('--dry-run');
const companyArg = process.argv
  .find((arg) => arg.startsWith('--company='))
  ?.split('=')[1];

/** Campo de medida que cada unidade dimensional precisa para ter um total. */
const REQUIRED_MEASURE: Partial<Record<UnitKind, string[]>> = {
  AREA: ['width', 'height'],
  LENGTH: ['length'],
  CAPACITY: ['volume'],
  WEIGHT: ['weight'],
  DISTANCE: ['distance'],
  DURATION: ['duration'],
};

const DIMENSIONAL_KINDS = Object.keys(REQUIRED_MEASURE) as UnitKind[];

async function main() {
  console.log(
    isDryRun
      ? '[DRY-RUN] Nenhuma alteração será gravada.\n'
      : '[MIGRAÇÃO] Corrigindo sale_price de itens com unidade dimensional.\n',
  );
  if (companyArg) console.log(`Filtrando pela empresa ${companyArg}\n`);

  const items = await prisma.productItem.findMany({
    where: {
      unitKind: { in: DIMENSIONAL_KINDS },
      salePrice: { not: null },
      ...(companyArg ? { product: { companyId: companyArg } } : {}),
    },
    include: {
      product: { select: { code: true, name: true, isImported: true } },
    },
  });

  const candidatos = items.filter((item) => {
    const required = REQUIRED_MEASURE[item.unitKind as UnitKind] ?? [];
    // Falta qualquer medida necessária => não há total possível.
    return required.some((field) => !item[field as keyof typeof item]);
  });

  console.log(`Itens dimensionais com sale_price preenchido: ${items.length}`);
  console.log(`Candidatos (sem a medida necessária): ${candidatos.length}`);

  if (candidatos.length === 0) {
    console.log('\nNada a corrigir.');
    return;
  }

  // Assinatura exata do bug do importador: sale_price idêntico ao unit_cost.
  const assinaturaImport = candidatos.filter(
    (item) => item.salePrice === item.unitCost,
  );
  console.log(
    `  dos quais com sale_price === unit_cost (bug do importador): ${assinaturaImport.length}`,
  );
  console.log(
    `  dos quais em produtos importados: ${
      candidatos.filter((item) => item.product.isImported).length
    }\n`,
  );

  for (const item of candidatos) {
    console.log(
      `  ${item.product.code.padEnd(12)} ${item.product.name.slice(0, 40).padEnd(42)} ` +
        `${String(item.unitKind).padEnd(9)} unit_cost=${item.unitCost} sale_price=${item.salePrice} -> null`,
    );
  }

  if (isDryRun) {
    console.log(`\n[DRY-RUN] ${candidatos.length} item(ns) seriam corrigidos.`);
    return;
  }

  const { count } = await prisma.productItem.updateMany({
    where: { id: { in: candidatos.map((item) => item.id) } },
    data: { salePrice: null },
  });

  console.log(`\n${count} item(ns) corrigido(s).`);
}

main()
  .catch((error) => {
    console.error('Falha na migração:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
