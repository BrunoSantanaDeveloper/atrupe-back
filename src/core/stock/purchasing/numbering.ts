import { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/**
 * A numeração sequencial por empresa (solicitação, pedido de compra, lote,
 * saída dos veículos):
 * o próximo número sai do maior gravado. Duas criações ao mesmo tempo leriam
 * o mesmo maior e a segunda cairia na chave única (erro 500); a trava, presa
 * até o fim da transação, faz a segunda esperar a primeira e ler o número
 * dela. Chame dentro da transação que cria a linha, antes de ler o maior.
 */
export const lockNumbering = (
  tx: Tx,
  table:
    | 'purchase_requests'
    | 'purchase_orders'
    | 'stock_lots'
    | 'production_trips',
  companyId: string,
) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`numbering:${table}:${companyId}`}))`;
