import { Prisma, PrismaClient } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/**
 * A baixa da venda e a baixa do rolo pela tarefa da mesma venda se
 * enfileiram por esta trava: a que vem depois vê a outra e não tira o
 * material duas vezes (nem a baixa da venda roda duas vezes, quando o
 * projeto e a entrega concluem juntos).
 */
export const lockSale = (tx: Tx, quotationId: string) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`stock-sale:${quotationId}`}))`;

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

export type SaleItem = {
  origin: string | null;
  quantity: number;
  materialId: string | null;
  materialVariationId: string | null;
  snapshot: { data: unknown } | null;
  lines: { resolved: unknown }[];
};

/**
 * Os materiais da venda por material|variação: o material de venda direta,
 * as linhas do retrato de cada item e as das linhas acrescentadas. A mesma
 * conta serve à baixa da venda (ES-7) e à reserva (FULL).
 */
export function saleMaterials(items: SaleItem[]) {
  const total = new Map<
    string,
    { materialId: string; variationId: string | null; quantity: number }
  >();
  for (const item of items) {
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
  return total;
}

/**
 * A reserva (item 23; Maicol, 23/11/2026, FULL): o material das vendas
 * aprovadas cuja O.S. ainda está em andamento e que ainda não tiveram a
 * baixa da venda. O material que o impressor já baixou no rolo (ES-16) sai
 * da reserva daquela venda. A baixa real continua na produção.
 */
export async function reservedByKey(prisma: PrismaClient, companyId: string) {
  const sales = await prisma.quotation.findMany({
    where: {
      companyId,
      status: 'APPROVED',
      order: {
        is: { status: { in: ['PENDING', 'IN_PRODUCTION', 'DELIVERY'] } },
      },
    },
    select: {
      id: true,
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
  if (!sales.length) return new Map<string, number>();
  const ids = sales.map((sale) => sale.id);
  const moves = await prisma.stockMovement.findMany({
    where: { companyId, quotationId: { in: ids } },
    select: { quotationId: true, lotId: true, kind: true, replacesKey: true },
  });
  const consumed = new Set(
    moves
      .filter((move) => move.kind === 'CONSUMPTION' && !move.lotId)
      .map((move) => move.quotationId),
  );
  const fromRolls = new Map<string, Set<string>>();
  for (const move of moves) {
    if (!move.lotId || !move.replacesKey || !move.quotationId) continue;
    const keys = fromRolls.get(move.quotationId) ?? new Set<string>();
    keys.add(move.replacesKey);
    fromRolls.set(move.quotationId, keys);
  }
  const reserved = new Map<string, number>();
  for (const sale of sales) {
    if (consumed.has(sale.id)) continue;
    const rolls = fromRolls.get(sale.id);
    for (const [key, row] of saleMaterials(
      sale.quotationProduct as SaleItem[],
    )) {
      if (rolls?.has(key)) continue;
      reserved.set(key, (reserved.get(key) ?? 0) + row.quantity);
    }
  }
  return reserved;
}

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
  const uses = await prisma.stockItem.count({ where: { companyId } });
  if (!uses) return { consumed: 0 };

  const total = saleMaterials(quotation.quotationProduct);
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
      await lockSale(tx, quotationId);
      // Uma baixa só por venda. A baixa no lote pela tarefa (ES-16) não conta
      // como a baixa da venda: só não tira de novo o material que ela
      // substituiu. As duas leituras vêm depois da trava.
      const done = await tx.stockMovement.count({
        where: { companyId, quotationId, kind: 'CONSUMPTION', lotId: null },
      });
      if (done) return;
      const fromLots = await tx.stockMovement.findMany({
        where: { companyId, quotationId, lotId: { not: null } },
        select: { replacesKey: true },
      });
      const replaced = new Set(
        fromLots
          .map((row) => row.replacesKey)
          .filter((key): key is string => !!key),
      );
      for (const row of total.values()) {
        if (!known.has(row.materialId)) continue;
        const key = stockKey(row.materialId, row.variationId);
        // O impressor já deu a baixa deste material no rolo
        if (replaced.has(key)) continue;
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

/**
 * A baixa do rolo que chega depois da baixa da venda (ES-16): a venda já
 * tirou o material pela previsão; o rolo tira o que saiu de fato. Devolve ao
 * saldo, uma vez por material, o que a venda tirou, para ficar só a baixa do
 * rolo (como quando o rolo vem antes e a venda pula o material). Roda na
 * transação da baixa do rolo, depois de `lockSale`. Devolve a quantidade
 * estornada (0 quando não havia o que estornar).
 */
export async function reverseSaleConsumption(
  tx: Tx,
  input: {
    companyId: string;
    quotationId: string;
    /** material|variação do material vendido que o rolo substitui */
    key: string;
    taskId: string | null;
    origin: string;
    actor: { id: string | null; name: string };
  },
) {
  const { companyId, quotationId, key } = input;
  const item = await tx.stockItem.findUnique({
    where: { companyId_key: { companyId, key } },
    select: { id: true },
  });
  if (!item) return 0;
  const where = { companyId, quotationId, stockItemId: item.id, lotId: null };
  const reversed = await tx.stockMovement.count({
    where: { ...where, kind: 'ADJUSTMENT', replacesKey: key },
  });
  if (reversed) return 0;
  const sale = await tx.stockMovement.findMany({
    where: { ...where, kind: 'CONSUMPTION' },
    select: { quantity: true, unitCost: true },
  });
  const taken = -sale.reduce((sum, row) => sum + row.quantity, 0);
  if (!(taken > 1e-9)) return 0;
  await tx.stockItem.update({
    where: { id: item.id },
    data: { quantity: { increment: taken } },
  });
  await tx.stockMovement.create({
    data: {
      companyId,
      stockItemId: item.id,
      kind: 'ADJUSTMENT',
      quantity: taken,
      unitCost: sale[0]?.unitCost ?? null,
      origin: input.origin,
      quotationId,
      // Sem lote: não é baixa de rolo, e a baixa da venda não a conta
      lotId: null,
      taskId: input.taskId,
      replacesKey: key,
      date: new Date(),
      createdById: input.actor.id,
      createdByName: input.actor.name,
    },
  });
  return taken;
}
