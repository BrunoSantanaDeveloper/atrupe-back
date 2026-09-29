/**
 * Remoção de venda migrada, com tudo que a carga pendurou nela.
 *
 * Reimportar um documento exige apagá-lo antes: as relações filhas — itens,
 * pagamento, parcelas, entrega, ordem de serviço e o financeiro gerado pela
 * venda — não têm exclusão em cascata no banco.
 *
 * Serve a dois caminhos: o reset completo da carga de um cliente e a
 * atualização do documento que mudou no legado depois da primeira migração.
 */

type PrismaLike = any;

/** Ids dos registros que a venda migrada carrega. */
async function relatedIds(prisma: PrismaLike, quotationIds: string[]) {
  const [payments, receivables, payables, orders] = await Promise.all([
    prisma.quotationPayment.findMany({
      where: { quotationId: { in: quotationIds } },
      select: { id: true },
    }),
    prisma.receivable.findMany({
      where: { quotationId: { in: quotationIds } },
      select: { id: true },
    }),
    prisma.payable.findMany({
      where: { quotationId: { in: quotationIds } },
      select: { id: true },
    }),
    prisma.order.findMany({
      where: { quotationId: { in: quotationIds } },
      select: { id: true },
    }),
  ]);

  return {
    paymentIds: payments.map((p: any) => p.id),
    receivableIds: receivables.map((r: any) => r.id),
    payableIds: payables.map((p: any) => p.id),
    orderIds: orders.map((o: any) => o.id),
  };
}

export async function deleteImportedSales(
  prisma: PrismaLike,
  quotationIds: string[],
): Promise<void> {
  if (quotationIds.length === 0) return;

  const { paymentIds, receivableIds, payableIds, orderIds } = await relatedIds(
    prisma,
    quotationIds,
  );

  // Ordem de dependência: filho antes do pai.
  await prisma.receivableHistory.deleteMany({
    where: { receivableId: { in: receivableIds } },
  });
  await prisma.receivableInstallment.deleteMany({
    where: { receivableId: { in: receivableIds } },
  });
  await prisma.receivable.deleteMany({ where: { id: { in: receivableIds } } });

  await prisma.payableHistory.deleteMany({
    where: { payableId: { in: payableIds } },
  });
  await prisma.payableInstallment.deleteMany({
    where: { payableId: { in: payableIds } },
  });
  await prisma.commission.deleteMany({
    where: { payableId: { in: payableIds } },
  });
  await prisma.payable.deleteMany({ where: { id: { in: payableIds } } });

  await prisma.orderHistory.deleteMany({
    where: { orderId: { in: orderIds } },
  });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });

  await prisma.quotationInstallment.deleteMany({
    where: { quotationPaymentId: { in: paymentIds } },
  });
  await prisma.commission.deleteMany({
    where: { quotationPayment: { quotationId: { in: quotationIds } } },
  });
  await prisma.quotationPayment.deleteMany({
    where: { id: { in: paymentIds } },
  });

  await prisma.quotationProductItem.deleteMany({
    where: { quotationId: { in: quotationIds } },
  });
  await prisma.quotationProduct.deleteMany({
    where: { quotationId: { in: quotationIds } },
  });
  await prisma.deliveryInfo.deleteMany({
    where: { quotationId: { in: quotationIds } },
  });
  await prisma.deliverySchedule.deleteMany({
    where: { quotationId: { in: quotationIds } },
  });
  await prisma.quotationHistory.deleteMany({
    where: { quotationId: { in: quotationIds } },
  });
  await prisma.quotation.deleteMany({ where: { id: { in: quotationIds } } });
}
