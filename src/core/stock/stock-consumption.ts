import { PrismaClient } from '@prisma/client';

/** As linhas de um retrato (ORC-10): o recurso e a quantidade usada. */
type SnapshotStages = {
  stages?: {
    lines?: {
      resourceId?: string | null;
      quantity?: number | null;
      actualQuantity?: number | null;
    }[];
  }[];
};

const stockKey = (materialId: string, variationId: string | null) =>
  `${materialId}|${variationId ?? ''}`;

/** material:<id>[:<variação>] → o material e a variação. */
const materialOf = (resourceId?: string | null) => {
  const match = /^material:([^:]+)(?::(.+))?$/.exec(resourceId ?? '');
  return match ? { materialId: match[1], variationId: match[2] ?? null } : null;
};

const addLines = (
  total: Map<
    string,
    { materialId: string; variationId: string | null; quantity: number }
  >,
  data: unknown,
) => {
  // O retrato tem as linhas por etapa; o processo acrescentado no item
  // guarda as linhas resolvidas soltas (sem etapas)
  type Line = NonNullable<
    NonNullable<SnapshotStages['stages']>[number]['lines']
  >[number];
  const stages = Array.isArray(data)
    ? data.some((entry) => Array.isArray(entry?.lines))
      ? (data as SnapshotStages['stages'])
      : [{ lines: data as Line[] }]
    : ((data as SnapshotStages | null)?.stages ?? []);
  for (const stage of stages ?? []) {
    for (const line of stage.lines ?? []) {
      const material = materialOf(line.resourceId);
      // O apontamento da produção vale mais que a previsão (ORC-9)
      const quantity = line.actualQuantity ?? line.quantity ?? 0;
      if (!material || !(quantity > 0)) continue;
      const key = stockKey(material.materialId, material.variationId);
      const row = total.get(key) ?? { ...material, quantity: 0 };
      row.quantity += quantity;
      total.set(key, row);
    }
  }
};

/**
 * A baixa por consumo da venda (ES-7): nasce da produção. Quando o projeto
 * do gerenciador conclui ou a entrega da O.S. é concluída (o que vier
 * primeiro), os materiais da venda saem do estoque: os do retrato de cada
 * item, os das linhas acrescentadas e o material de venda direta, pelo
 * custo médio do momento. Uma baixa só por venda, e só na empresa que usa o
 * estoque (com algum saldo cadastrado). O saldo pode ficar negativo: o
 * consumo aconteceu.
 */
export async function consumeSale(
  prisma: PrismaClient,
  quotationId: string,
  by: string,
) {
  const quotation = await prisma.quotation.findUnique({
    where: { id: quotationId },
    select: {
      companyId: true,
      quotationNumber: true,
      description: true,
      series: { select: { code: true } },
      quotationProduct: {
        select: {
          origin: true,
          quantity: true,
          materialId: true,
          materialVariationId: true,
          snapshot: { select: { data: true } },
          lines: { select: { resolved: true } },
        },
      },
    },
  });
  if (!quotation) return { consumed: 0 };
  const companyId = quotation.companyId;
  const [uses, done] = await Promise.all([
    prisma.stockItem.count({ where: { companyId } }),
    prisma.stockMovement.count({
      where: { companyId, quotationId, kind: 'CONSUMPTION' },
    }),
  ]);
  if (!uses || done) return { consumed: 0 };

  const total = new Map<
    string,
    { materialId: string; variationId: string | null; quantity: number }
  >();
  for (const item of quotation.quotationProduct) {
    if (item.origin === 'MATERIAL' && item.materialId) {
      const key = stockKey(item.materialId, item.materialVariationId);
      const row = total.get(key) ?? {
        materialId: item.materialId,
        variationId: item.materialVariationId,
        quantity: 0,
      };
      row.quantity += item.quantity;
      total.set(key, row);
    }
    if (item.snapshot?.data) addLines(total, item.snapshot.data);
    for (const line of item.lines) addLines(total, line.resolved);
  }
  if (!total.size) return { consumed: 0 };

  // Só o material do cadastro da empresa
  const materials = await prisma.material.findMany({
    where: {
      id: {
        in: [...new Set([...total.values()].map((row) => row.materialId))],
      },
      companyId,
    },
    select: { id: true },
  });
  const known = new Set(materials.map((row) => row.id));
  const reference = [quotation.quotationNumber, quotation.series?.code]
    .filter((part) => part !== null && part !== undefined && part !== '')
    .join('-');
  const origin = `OS ${reference}${quotation.description ? ` — ${quotation.description}` : ''}`;
  const date = new Date();
  let consumed = 0;
  await prisma.$transaction(
    async (tx) => {
      for (const row of total.values()) {
        if (!known.has(row.materialId)) continue;
        const key = stockKey(row.materialId, row.variationId);
        const stock = await tx.stockItem.upsert({
          where: { companyId_key: { companyId, key } },
          create: {
            companyId,
            key,
            materialId: row.materialId,
            variationId: row.variationId,
            quantity: -row.quantity,
          },
          update: { quantity: { decrement: row.quantity } },
        });
        await tx.stockMovement.create({
          data: {
            companyId,
            stockItemId: stock.id,
            kind: 'CONSUMPTION',
            quantity: -row.quantity,
            unitCost: stock.averageCost,
            origin,
            quotationId,
            date,
            createdByName: by,
          },
        });
        consumed++;
      }
    },
    { timeout: 20000 },
  );
  return { consumed };
}
