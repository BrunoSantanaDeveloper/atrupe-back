import { PrismaClient } from '@prisma/client';
import * as mysql from 'mysql2/promise';
import { atMiddayUtc, dayDate } from '../core/import/import-references';
import { normalizeLegacyDate } from './legacy-extractors';
import { resolveCompanyByEmail } from './preflight-financial-import';

/**
 * Corrige as datas dos documentos já migrados.
 *
 * Existe porque as cargas anteriores a setembro/2026 gravavam a ordem de
 * serviço e o orçamento sem data de origem: os dois nasciam com o instante da
 * migração, e as telas agrupam, filtram e imprimem por essa data. O histórico
 * inteiro do cliente aparecia no dia em que a migração rodou.
 *
 * Repetir a carga não resolve: ela pula o documento que já existe, que é o que
 * evita duplicar.
 *
 * São duas passagens:
 *
 * 1. Do legado: reescreve a data de criação e de aprovação do orçamento e da
 *    ordem, a partir da venda de origem.
 * 2. Local: leva as datas que ficaram à meia-noite UTC para o meio-dia. Meia-
 *    noite UTC é o dia anterior às 21h no fuso do Brasil, então a lista (que lê
 *    em UTC) e a tela do documento (que converte para São Paulo) mostravam dias
 *    diferentes para o mesmo documento.
 *
 * É idempotente: rodar de novo não muda nada do que já está certo.
 *
 * Uso:
 *   npx ts-node src/scripts/fix-legacy-document-dates.ts <email> <base> [--yes]
 *   npx ts-node src/scripts/fix-legacy-document-dates.ts --company-id=<id> <base> [--yes]
 *
 * Sem `--yes` apenas relata o que mudaria.
 */

export interface LegacySaleDates {
  legacyId: string;
  /** Data de cadastro da venda no legado. */
  createdAt: string;
  /** Data de aprovação, quando o legado registrou uma. */
  approvedAt: string;
}

export interface DateFixSummary {
  [entidade: string]: number;
}

const APPROVED_STATUS = ['APPROVED', 'DONE'];

/** Datas que o documento deveria ter, ou `null` quando já estão certas. */
export function targetDates(
  sale: LegacySaleDates,
  quotation: { status: string; createdAt: Date; approvedAt: Date | null },
): { createdAt: Date; approvedAt: Date | null } | null {
  if (!sale.createdAt) return null;

  const createdAt = dayDate(sale.createdAt);

  // O legado nem sempre registra a aprovação; nesse caso vale a data da venda,
  // que é o que a carga usa.
  const approvedAt = APPROVED_STATUS.includes(quotation.status)
    ? dayDate(sale.approvedAt || sale.createdAt)
    : null;

  const mesmaCriacao = quotation.createdAt.getTime() === createdAt.getTime();
  const mesmaAprovacao =
    (quotation.approvedAt?.getTime() ?? null) ===
    (approvedAt?.getTime() ?? null);

  if (mesmaCriacao && mesmaAprovacao) return null;
  return { createdAt, approvedAt };
}

/** Vendas do legado, uma linha por venda, só com as datas. */
export async function readLegacySaleDates(
  legacy: mysql.Connection,
  base: string,
): Promise<Map<string, LegacySaleDates>> {
  const [rows] = await legacy.query(`
    SELECT v.idsale                AS legacyId,
           v.cadastro_dt           AS createdAt,
           v.venda_data_aprovacao  AS approvedAt
      FROM ${base}.sales_venda v
  `);

  const porCodigo = new Map<string, LegacySaleDates>();

  for (const row of rows as any[]) {
    const legacyId = String(row.legacyId ?? '').trim();
    if (!legacyId) continue;

    porCodigo.set(legacyId, {
      legacyId,
      createdAt: normalizeLegacyDate(row.createdAt),
      approvedAt: normalizeLegacyDate(row.approvedAt),
    });
  }

  return porCodigo;
}

/** Data à meia-noite UTC é a que a carga antiga gravou; só ela é ajustada. */
function precisaDoMeioDia(value: Date | null | undefined): boolean {
  if (!value) return false;
  return (
    value.getUTCHours() === 0 &&
    value.getUTCMinutes() === 0 &&
    value.getUTCSeconds() === 0
  );
}

export async function fixLegacyDocumentDates(
  prisma: PrismaClient,
  legacy: mysql.Connection,
  companyId: string,
  base: string,
  options: { apply?: boolean } = {},
): Promise<DateFixSummary> {
  const { apply = false } = options;
  const summary: DateFixSummary = {
    'Orçamentos e ordens': 0,
    'Ordens de serviço': 0,
    'Contas a receber': 0,
    'Contas a pagar': 0,
    'Parcelas a receber': 0,
    'Parcelas a pagar': 0,
  };

  const vendas = await readLegacySaleDates(legacy, base);

  // 1. Documentos: data de origem, vinda da venda do legado.
  const quotations = await prisma.quotation.findMany({
    where: { companyId, isImported: true, legacyId: { not: null } },
    select: {
      id: true,
      legacyId: true,
      status: true,
      createdAt: true,
      approvedAt: true,
      order: { select: { id: true, createdAt: true } },
    },
  });

  for (const quotation of quotations) {
    const sale = vendas.get(String(quotation.legacyId).trim());
    if (!sale) continue;

    const alvo = targetDates(sale, quotation);
    if (!alvo) continue;

    summary['Orçamentos e ordens']++;

    if (apply) {
      await prisma.quotation.update({
        where: { id: quotation.id },
        data: { createdAt: alvo.createdAt, approvedAt: alvo.approvedAt },
      });
    }

    // A lista de O.S. agrupa pela data da ordem, não pela do orçamento.
    const order = (quotation as any).order;
    if (order && order.createdAt.getTime() !== alvo.createdAt.getTime()) {
      summary['Ordens de serviço']++;
      if (apply) {
        await prisma.order.update({
          where: { id: order.id },
          data: { createdAt: alvo.createdAt },
        });
      }
    }
  }

  // 2. Financeiro migrado: a data de criação acompanha a de referência, e o
  // que ficou à meia-noite UTC vai para o meio-dia.
  const receivables = await prisma.receivable.findMany({
    where: { companyId, isImported: true },
    select: { id: true, createdAt: true, referenceDate: true },
  });

  for (const receivable of receivables) {
    const referenceDate = precisaDoMeioDia(receivable.referenceDate)
      ? atMiddayUtc(receivable.referenceDate as Date)
      : receivable.referenceDate;

    const createdAt = referenceDate ?? receivable.createdAt;

    const mudou =
      receivable.createdAt.getTime() !== createdAt.getTime() ||
      (receivable.referenceDate?.getTime() ?? null) !==
        (referenceDate?.getTime() ?? null);

    if (!mudou) continue;

    summary['Contas a receber']++;
    if (apply) {
      await prisma.receivable.update({
        where: { id: receivable.id },
        data: { createdAt, referenceDate },
      });
    }
  }

  const payables = await prisma.payable.findMany({
    where: { companyId, isImported: true },
    select: { id: true, createdAt: true, referenceDate: true },
  });

  for (const payable of payables) {
    const referenceDate = precisaDoMeioDia(payable.referenceDate)
      ? atMiddayUtc(payable.referenceDate as Date)
      : payable.referenceDate;

    const createdAt = referenceDate ?? payable.createdAt;

    const mudou =
      payable.createdAt.getTime() !== createdAt.getTime() ||
      (payable.referenceDate?.getTime() ?? null) !==
        (referenceDate?.getTime() ?? null);

    if (!mudou) continue;

    summary['Contas a pagar']++;
    if (apply) {
      await prisma.payable.update({
        where: { id: payable.id },
        data: { createdAt, referenceDate },
      });
    }
  }

  // 3. Parcelas: vencimento e pagamento também ficaram à meia-noite UTC, e é
  // por eles que o financeiro é listado.
  const receivableInstallments = await prisma.receivableInstallment.findMany({
    where: { receivable: { companyId, isImported: true } },
    select: { id: true, dueDate: true, paidDate: true },
  });

  for (const installment of receivableInstallments) {
    const dueDate = precisaDoMeioDia(installment.dueDate)
      ? atMiddayUtc(installment.dueDate as Date)
      : installment.dueDate;
    const paidDate = precisaDoMeioDia(installment.paidDate)
      ? atMiddayUtc(installment.paidDate as Date)
      : installment.paidDate;

    if (dueDate === installment.dueDate && paidDate === installment.paidDate) {
      continue;
    }

    summary['Parcelas a receber']++;
    if (apply) {
      await prisma.receivableInstallment.update({
        where: { id: installment.id },
        data: { dueDate, paidDate },
      });
    }
  }

  const payableInstallments = await prisma.payableInstallment.findMany({
    where: { payable: { companyId, isImported: true } },
    select: { id: true, dueDate: true, paidDate: true },
  });

  for (const installment of payableInstallments) {
    const dueDate = precisaDoMeioDia(installment.dueDate)
      ? atMiddayUtc(installment.dueDate as Date)
      : installment.dueDate;
    const paidDate = precisaDoMeioDia(installment.paidDate)
      ? atMiddayUtc(installment.paidDate as Date)
      : installment.paidDate;

    if (dueDate === installment.dueDate && paidDate === installment.paidDate) {
      continue;
    }

    summary['Parcelas a pagar']++;
    if (apply) {
      await prisma.payableInstallment.update({
        where: { id: installment.id },
        data: { dueDate, paidDate },
      });
    }
  }

  return summary;
}

function flagValue(args: string[], name: string): string | undefined {
  const prefixo = `--${name}=`;
  return args.find((a) => a.startsWith(prefixo))?.slice(prefixo.length);
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--yes');
  const companyIdFlag = flagValue(args, 'company-id');
  const posicionais = args.filter((a) => !a.startsWith('--'));

  const email = companyIdFlag ? undefined : posicionais[0];
  const base = companyIdFlag ? posicionais[0] : posicionais[1];

  if (!base || (!companyIdFlag && !email)) {
    console.error(
      'Uso: ts-node src/scripts/fix-legacy-document-dates.ts <email> <base> [--yes]\n' +
        '     ou --company-id=<id> <base> [--yes]',
    );
    process.exit(1);
  }

  if (!/^acn_\d+$/.test(base)) {
    console.error(`Nome de base inválido: '${base}'. Esperado acn_000000.`);
    process.exit(1);
  }

  const prisma = new PrismaClient();
  let legacy: mysql.Connection | undefined;

  try {
    let companyId = companyIdFlag;
    let companyName = companyIdFlag;

    if (!companyId) {
      const resolvido = await resolveCompanyByEmail(prisma, email as string);
      companyId = resolvido.companyId;
      companyName = resolvido.companyName;
    }

    legacy = await mysql.createConnection({
      host: process.env.LEGACY_DB_HOST || '127.0.0.1',
      port: Number(process.env.LEGACY_DB_PORT || 13306),
      user: process.env.LEGACY_DB_USER,
      password: process.env.LEGACY_DB_PASSWORD,
      connectTimeout: 20000,
    });

    console.log(`Empresa: ${companyName} (${companyId})`);
    console.log(`Base:    ${base}`);
    console.log(
      apply
        ? 'Modo:    corrigindo\n'
        : 'Modo:    simulação (use --yes para gravar)\n',
    );

    const summary = await fixLegacyDocumentDates(
      prisma,
      legacy,
      companyId as string,
      base,
      { apply },
    );

    for (const [label, total] of Object.entries(summary)) {
      console.log(`${label.padEnd(24)} ${String(total).padStart(7)}`);
    }

    console.log(apply ? '\nDatas corrigidas.' : '\nNada foi gravado.');
  } catch (error: any) {
    console.error(`\nFalhou: ${error.message}`);
    process.exit(1);
  } finally {
    await legacy?.end().catch(() => undefined);
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main();
}
