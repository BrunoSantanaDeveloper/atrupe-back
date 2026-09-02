import { PrismaClient } from '@prisma/client';
import { resolveCompanyByEmail } from './preflight-financial-import';

/**
 * Apaga tudo o que a migração do legado gravou numa empresa, para permitir
 * repetir a carga do zero.
 *
 * Existe porque a importação de vendas não era idempotente até a introdução do
 * código do legado no orçamento: quem rodou a carga duas vezes ficou com
 * documentos duplicados, e não há como distinguir o original da cópia a não ser
 * apagando os dois e recarregando.
 *
 * Só remove registro marcado como importado. Documento criado pelo usuário na
 * empresa fica intacto.
 *
 * A remoção é feita em ordem de dependência: as relações filhas do orçamento
 * não têm exclusão em cascata no banco.
 *
 * Uso:
 *   npx ts-node src/scripts/reset-legacy-import.ts <email> [--sales-only] [--yes]
 *
 * Sem `--yes` o script apenas relata o que seria apagado.
 */

export interface ResetSummary {
  [entity: string]: number;
}

export async function resetLegacyImport(
  prisma: PrismaClient,
  companyId: string,
  options: { salesOnly?: boolean; apply?: boolean } = {},
): Promise<ResetSummary> {
  const { salesOnly = false, apply = false } = options;

  const quotations = await prisma.quotation.findMany({
    where: { companyId, isImported: true },
    select: { id: true },
  });
  const quotationIds = quotations.map((q) => q.id);

  const summary: ResetSummary = {};
  const count = async (label: string, value: number) => {
    summary[label] = value;
  };

  if (quotationIds.length > 0) {
    const payments = await prisma.quotationPayment.findMany({
      where: { quotationId: { in: quotationIds } },
      select: { id: true },
    });
    const paymentIds = payments.map((p) => p.id);

    const receivables = await prisma.receivable.findMany({
      where: { quotationId: { in: quotationIds } },
      select: { id: true },
    });
    const receivableIds = receivables.map((r) => r.id);

    const payables = await prisma.payable.findMany({
      where: { quotationId: { in: quotationIds } },
      select: { id: true },
    });
    const payableIds = payables.map((p) => p.id);

    const orders = await prisma.order.findMany({
      where: { quotationId: { in: quotationIds } },
      select: { id: true },
    });
    const orderIds = orders.map((o) => o.id);

    await count('Orçamentos e ordens', quotationIds.length);
    await count('Ordens de serviço', orderIds.length);
    await count('Contas a receber', receivableIds.length);
    await count('Contas a pagar', payableIds.length);

    if (apply) {
      // Ordem de dependência: filho antes do pai.
      await prisma.receivableHistory.deleteMany({
        where: { receivableId: { in: receivableIds } },
      });
      await prisma.receivableInstallment.deleteMany({
        where: { receivableId: { in: receivableIds } },
      });
      await prisma.receivable.deleteMany({
        where: { id: { in: receivableIds } },
      });

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
      await prisma.quotation.deleteMany({
        where: { id: { in: quotationIds } },
      });
    }
  } else {
    await count('Orçamentos e ordens', 0);
  }

  if (salesOnly) return summary;

  // Cadastros: idempotentes por código do legado, então normalmente não
  // precisam ser apagados. Ficam disponíveis para uma recarga completa.
  const financeiro = await prisma.receivable.count({
    where: { companyId, quotationId: null },
  });
  await count('Lançamentos financeiros avulsos', financeiro);

  if (apply) {
    const avulsos = await prisma.receivable.findMany({
      where: { companyId, quotationId: null },
      select: { id: true },
    });
    const ids = avulsos.map((r) => r.id);

    await prisma.receivableHistory.deleteMany({
      where: { receivableId: { in: ids } },
    });
    await prisma.receivableInstallment.deleteMany({
      where: { receivableId: { in: ids } },
    });
    await prisma.receivable.deleteMany({ where: { id: { in: ids } } });
  }

  return summary;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--yes');
  const salesOnly = args.includes('--sales-only');
  const [email] = args.filter((a) => !a.startsWith('--'));

  if (!email) {
    console.error(
      'Uso: ts-node src/scripts/reset-legacy-import.ts <email> [--sales-only] [--yes]',
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const { companyId, companyName } = await resolveCompanyByEmail(
      prisma,
      email,
    );

    console.log(`Empresa: ${companyName} (${companyId})`);
    console.log(
      apply
        ? 'Modo:    apagando\n'
        : 'Modo:    simulação (use --yes para apagar)\n',
    );

    const summary = await resetLegacyImport(prisma, companyId, {
      salesOnly,
      apply,
    });

    for (const [label, total] of Object.entries(summary)) {
      console.log(`${label.padEnd(32)} ${String(total).padStart(6)}`);
    }

    console.log(apply ? '\nRemovido.' : '\nNada foi apagado.');
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
