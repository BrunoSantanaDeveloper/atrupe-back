import { PrismaService } from 'nestjs-prisma';
import { calculateFinalValue } from './quotation.utils';

/**
 * O valor do item: a base com o desconto e, por fora dele, o acréscimo
 * (ALT-25) e as linhas acrescentadas (ORC-5). Nunca negativo.
 */
export const itemValue = (
  totalValue: number,
  discount: number | null,
  discountType: string | null,
  addition: number | null | undefined,
  linesTotal: number | null | undefined = 0,
) =>
  Math.max(
    0,
    calculateFinalValue(totalValue, discount, discountType) +
      (addition || 0) +
      (linesTotal || 0),
  );

/** O total do orçamento e o das condições de pagamento: a soma dos itens. */
export async function recalculateQuotationTotal(
  prisma: PrismaService,
  quotationId: string,
) {
  const products = await prisma.quotationProduct.findMany({
    where: { quotationId },
    select: { finalValue: true },
  });
  const totalValue = products.reduce(
    (total, product) => total + (product.finalValue ?? 0),
    0,
  );
  await prisma.quotation.update({
    where: { id: quotationId },
    data: { totalValue },
  });
  await prisma.quotationPayment.update({
    where: { quotationId },
    data: { totalValue },
  });
}
