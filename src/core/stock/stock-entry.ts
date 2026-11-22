import { Prisma, StockMovementKind } from '@prisma/client';
import { costChange } from '../material/material.service';
import type { CashActor } from '../financial/cash-control/cash-ledger';

type Tx = Prisma.TransactionClient;
type Charges = Parameters<typeof costChange>[3];

export const stockKey = (materialId: string, variationId: string | null) =>
  `${materialId}|${variationId ?? ''}`;

/**
 * A entrada de um material no estoque (ES-5, ES-6): soma ao saldo, refaz o
 * custo médio (o saldo negativo não pesa), grava o movimento com a origem
 * e leva o custo médio ao material ou à variação, que é o custo da
 * composição. Usada pela nota de entrada e pelo pedido de compra.
 */
export async function enterStock(
  tx: Tx,
  entry: {
    companyId: string;
    materialId: string;
    variationId: string | null;
    /** Na unidade do material */
    quantity: number;
    /** Centavos por unidade do material */
    entryCost: number;
    origin: string;
    invoiceId?: string | null;
    date: Date;
    actor: CashActor;
    charges: Charges;
  },
) {
  const { companyId, materialId, variationId, quantity, entryCost } = entry;
  const key = stockKey(materialId, variationId);
  const current = await tx.stockItem.findUnique({
    where: { companyId_key: { companyId, key } },
  });
  const before = Math.max(0, current?.quantity ?? 0);
  const averageCost =
    before > 0
      ? Math.round(
          (before * (current?.averageCost ?? 0) + quantity * entryCost) /
            (before + quantity),
        )
      : entryCost;
  const stock = await tx.stockItem.upsert({
    where: { companyId_key: { companyId, key } },
    create: {
      companyId,
      key,
      materialId,
      variationId,
      quantity,
      averageCost,
      lastEntryCost: entryCost,
      lastEntryDate: entry.date,
    },
    update: {
      quantity: { increment: quantity },
      averageCost,
      lastEntryCost: entryCost,
      lastEntryDate: entry.date,
    },
  });
  await tx.stockMovement.create({
    data: {
      companyId,
      stockItemId: stock.id,
      kind: StockMovementKind.ENTRY,
      quantity,
      unitCost: entryCost,
      origin: entry.origin,
      invoiceId: entry.invoiceId ?? null,
      date: entry.date,
      createdById: entry.actor.id,
      createdByName: entry.actor.name,
    },
  });
  // O custo médio é o custo do material na composição (ES-5): no preço
  // variável o preço acompanha; no fixo, só a margem muda
  const material = await tx.material.findUnique({
    where: { id: materialId },
    select: {
      priceRule: true,
      cost: true,
      price: true,
      desiredMargin: true,
      _count: { select: { variations: true } },
    },
  });
  if (variationId) {
    const variation = await tx.materialVariation.findUnique({
      where: { id: variationId },
      select: { cost: true, price: true, desiredMargin: true },
    });
    if (material && variation) {
      const data = costChange(
        material.priceRule,
        variation,
        averageCost,
        entry.charges,
      );
      if (Object.keys(data).length) {
        await tx.materialVariation.update({ where: { id: variationId }, data });
      }
    }
  } else if (material && !material._count.variations) {
    const data = costChange(
      material.priceRule,
      material,
      averageCost,
      entry.charges,
    );
    if (Object.keys(data).length) {
      await tx.material.update({ where: { id: materialId }, data });
    }
  }
  return stock;
}
