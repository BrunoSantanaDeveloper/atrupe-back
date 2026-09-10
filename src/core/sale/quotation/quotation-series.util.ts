import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Move um orçamento (ou a O.S. dele) para outra série de venda.
 *
 * O número do orçamento sai do contador da série (`currentBudgetNumber`), então
 * trocar só o `seriesId` levaria o #38 da T1 para #38 da V1 — repetindo um
 * número que a V1 pode já ter usado. Aqui a série nova entrega o próximo número
 * do próprio contador, com o mesmo incremento atômico da criação. O número
 * antigo vira uma lacuna na série de origem, como numa exclusão.
 */
export async function reassignQuotationSeries(
  tx: Prisma.TransactionClient,
  quotation: { companyId: string | null; subCompanyId?: string | null },
  seriesId: string,
): Promise<{ seriesId: string; quotationNumber: number; code: string }> {
  const series = await tx.saleSeries.findUnique({
    where: { id: seriesId },
    select: { id: true, code: true, companyId: true, isActive: true },
  });

  if (!series) {
    throw new NotFoundException('Série não encontrada.');
  }

  // A série pode pertencer à empresa principal ou à filial que criou o orçamento.
  const allowedCompanies = [quotation.companyId, quotation.subCompanyId].filter(
    Boolean,
  );
  if (!allowedCompanies.includes(series.companyId)) {
    throw new BadRequestException(
      'A série não pertence à empresa do orçamento.',
    );
  }

  if (!series.isActive) {
    throw new BadRequestException(
      'Não é possível mover o orçamento para uma série inativa.',
    );
  }

  const { currentBudgetNumber } = await tx.saleSeries.update({
    where: { id: series.id },
    data: { currentBudgetNumber: { increment: 1 } },
    select: { currentBudgetNumber: true },
  });

  return {
    seriesId: series.id,
    quotationNumber: currentBudgetNumber,
    code: series.code,
  };
}
