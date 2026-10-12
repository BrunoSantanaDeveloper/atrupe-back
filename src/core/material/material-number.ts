import { Prisma } from '@prisma/client';

/**
 * O próximo número de material da empresa, dentro da transação: devolve uma
 * função que entrega um número novo a cada chamada. O código (`MAT-nn`) sai
 * dele.
 *
 * As criações da mesma empresa entram uma por vez: a trava vale até o fim da
 * transação, e quem chega depois lê o máximo já com o material anterior. O
 * índice único (empresa, número) continua sendo a garantia.
 */
export async function materialNumbers(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<() => number> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`material:${companyId}`}))`;

  const { _max } = await tx.material.aggregate({
    where: { companyId },
    _max: { number: true },
  });
  let last = _max.number ?? 0;
  return () => ++last;
}
