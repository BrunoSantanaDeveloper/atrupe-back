import { PrismaClient } from '@prisma/client';
import { resolveCompanyByEmail } from './preflight-financial-import';

/**
 * Remove os lançamentos financeiros que a migração duplicou.
 *
 * A carga do financeiro reconhece o que já migrou comparando descrição, valor,
 * data de referência e o vencimento da primeira parcela. A conversão de data
 * mudou na gravação e não na comparação: a busca procurava a parcela à
 * meia-noite enquanto a carga passou a gravá-la ao meio-dia, então nenhuma
 * execução reconhecia o que já existia e recriava o financeiro inteiro.
 *
 * O documento de venda não entra aqui: ele é reconhecido pelo código do
 * legado, que não depende de data.
 *
 * Mantém o registro mais antigo de cada grupo e apaga os demais, com as
 * parcelas e o histórico. Sem `--yes` apenas relata.
 *
 * Uso:
 *   npx ts-node src/scripts/dedupe-imported-financial.ts <email> [--yes]
 *   npx ts-node src/scripts/dedupe-imported-financial.ts --company-id=<id> [--yes]
 */

export interface FinancialRecord {
  id: string;
  description: string | null;
  totalAmount: number;
  referenceDate: Date | null;
  createdAt: Date;
}

export interface DedupeSummary {
  receivables: { grupos: number; remover: number };
  payables: { grupos: number; remover: number };
}

/** Chave do lançamento: o que identifica o mesmo registro do legado. */
function key(record: FinancialRecord): string {
  return [
    record.description ?? '',
    record.totalAmount,
    record.referenceDate?.toISOString() ?? '',
  ].join('|');
}

/**
 * Ids a apagar: tudo menos o registro mais antigo de cada grupo repetido.
 *
 * O mais antigo é o que a primeira carga gravou — é nele que uma baixa ou
 * anotação feita pelo cliente estaria.
 */
export function duplicatesToRemove(records: FinancialRecord[]): string[] {
  const grupos = new Map<string, FinancialRecord[]>();

  for (const record of records) {
    const k = key(record);
    grupos.set(k, [...(grupos.get(k) ?? []), record]);
  }

  const remover: string[] = [];

  for (const grupo of grupos.values()) {
    if (grupo.length < 2) continue;

    const ordenado = [...grupo].sort(
      (a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.id.localeCompare(b.id),
    );

    remover.push(...ordenado.slice(1).map((r) => r.id));
  }

  return remover;
}

export async function dedupeImportedFinancial(
  prisma: PrismaClient,
  companyId: string,
  options: { apply?: boolean } = {},
): Promise<DedupeSummary> {
  const { apply = false } = options;

  const select = {
    id: true,
    description: true,
    totalAmount: true,
    referenceDate: true,
    createdAt: true,
  };

  // Só o financeiro avulso do legado: o que veio junto da venda é apagado com
  // ela quando o documento é reimportado.
  const receivables = await prisma.receivable.findMany({
    where: { companyId, isImported: true, quotationId: null },
    select,
  });
  const payables = await prisma.payable.findMany({
    where: { companyId, isImported: true, quotationId: null },
    select,
  });

  const receivableIds = duplicatesToRemove(receivables);
  const payableIds = duplicatesToRemove(payables);

  if (apply) {
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
  }

  return {
    receivables: {
      grupos: receivables.length - receivableIds.length,
      remover: receivableIds.length,
    },
    payables: {
      grupos: payables.length - payableIds.length,
      remover: payableIds.length,
    },
  };
}

function flagValue(args: string[], name: string): string | undefined {
  const prefixo = `--${name}=`;
  return args.find((a) => a.startsWith(prefixo))?.slice(prefixo.length);
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--yes');
  const companyIdFlag = flagValue(args, 'company-id');
  const [email] = args.filter((a) => !a.startsWith('--'));

  if (!companyIdFlag && !email) {
    console.error(
      'Uso: ts-node src/scripts/dedupe-imported-financial.ts <email> [--yes]\n' +
        '     ou --company-id=<id> [--yes]',
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();

  try {
    let companyId = companyIdFlag;
    let companyName = companyIdFlag;

    if (!companyId) {
      const resolvido = await resolveCompanyByEmail(prisma, email);
      companyId = resolvido.companyId;
      companyName = resolvido.companyName;
    }

    console.log(`Empresa: ${companyName} (${companyId})`);
    console.log(
      apply
        ? 'Modo:    apagando\n'
        : 'Modo:    simulação (use --yes para apagar)\n',
    );

    const summary = await dedupeImportedFinancial(prisma, companyId as string, {
      apply,
    });

    console.log(
      `Contas a receber: ${summary.receivables.grupos} mantidas, ` +
        `${summary.receivables.remover} duplicadas`,
    );
    console.log(
      `Contas a pagar:   ${summary.payables.grupos} mantidas, ` +
        `${summary.payables.remover} duplicadas`,
    );

    console.log(apply ? '\nDuplicadas removidas.' : '\nNada foi apagado.');
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
