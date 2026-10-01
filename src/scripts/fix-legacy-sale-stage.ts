import { PrismaClient } from '@prisma/client';
import * as mysql from 'mysql2/promise';
import {
  LegacyStageRow,
  orcamentoFechado,
  ordemConcluida,
} from './legacy-extractors';
import { resolveCompanyByEmail } from './preflight-financial-import';

/**
 * Põe os documentos já migrados na etapa em que o legado os deixou.
 *
 * As cargas anteriores liam só o status da entrega para decidir se a ordem
 * estava pronta, e o cliente quase nunca marca esse último passo: a O.S.
 * termina na etapa "Entrega", com produção e financeiro concluídos. Na base do
 * primeiro cliente isso foi 8.243 de 8.615 ordens, todas em produção na conta
 * nova — uma fila de trabalho que não existe. O orçamento tinha o mesmo
 * problema pelo lado do substatus.
 *
 * A carga de hoje já lê a etapa pelo código do substatus. Este script é para o
 * que entrou antes dela, e evita a alternativa: reimportar apaga e recria cada
 * documento, com os ids e o financeiro que vêm atrás.
 *
 * Só promove: a ordem que alguém concluiu no Atrupe não volta para produção, e
 * o orçamento que já saiu de "Digitação" fica como está. Rodar de novo não
 * muda nada do que já está certo.
 *
 * Uso:
 *   npx ts-node src/scripts/fix-legacy-sale-stage.ts <email> <base> [--yes]
 *   npx ts-node src/scripts/fix-legacy-sale-stage.ts --company-id=<id> <base> [--yes]
 *
 * Sem --yes apenas relata o que mudaria.
 */

/** Status da venda no legado: 2 = orçamento cancelado, 4 = ordem cancelada. */
const LEGACY_CANCELED_QUOTATION = 2;
const LEGACY_CANCELED_ORDER = 4;

export interface LegacySaleStage extends LegacyStageRow {
  legacyId: string;
  statusLegado: number;
}

export interface StageTarget {
  quotationStatus?: 'DONE' | 'REJECTED';
  orderStatus?: 'FINISHED' | 'CANCELED';
}

export interface StageFixSummary {
  [entidade: string]: number;
}

/** Situação que o documento deveria ter, ou `null` quando não há o que mudar. */
export function targetStage(
  sale: LegacySaleStage,
  doc: { status: string; order: { status: string } | null },
): StageTarget | null {
  if (doc.order) {
    const alvo =
      Number(sale.statusLegado) === LEGACY_CANCELED_ORDER
        ? 'CANCELED'
        : ordemConcluida(sale)
          ? 'FINISHED'
          : null;

    // Só promove. A ordem que o cliente concluiu ou cancelou no Atrupe depois
    // da migração não volta para a etapa do legado.
    if (!alvo || doc.order.status !== 'IN_PRODUCTION') return null;
    return { orderStatus: alvo };
  }

  const alvo =
    Number(sale.statusLegado) === LEGACY_CANCELED_QUOTATION
      ? 'REJECTED'
      : orcamentoFechado(sale)
        ? 'DONE'
        : null;

  if (!alvo || doc.status !== 'OPEN') return null;
  return { quotationStatus: alvo };
}

/** Uma linha por venda, só com o que diz a etapa. */
export async function readLegacySaleStages(
  legacy: mysql.Connection,
  base: string,
): Promise<Map<string, LegacySaleStage>> {
  const [rows] = await legacy.query(`
    SELECT v.idsale               AS legacyId,
           v.venda_fkidstatus     AS statusLegado,
           v.venda_fkidsubstatus  AS substatusLegado,
           (SELECT sub.confsubstatus_cod FROM ${base}.sales_conf_substatus sub
             WHERE sub.idconf_substatus = v.venda_fkidsubstatus) AS etapaLegado,
           (SELECT MAX(e2.entrega_fkidstatus) FROM ${base}.sales_entrega e2
             WHERE e2.fkidsale = v.idsale)                       AS statusEntrega
      FROM ${base}.sales_venda v
  `);

  const porCodigo = new Map<string, LegacySaleStage>();

  for (const row of rows as any[]) {
    const legacyId = String(row.legacyId ?? '').trim();
    if (!legacyId) continue;

    porCodigo.set(legacyId, {
      legacyId,
      statusLegado: Number(row.statusLegado),
      substatusLegado: row.substatusLegado,
      etapaLegado: row.etapaLegado,
      statusEntrega: row.statusEntrega,
    });
  }

  return porCodigo;
}

export async function fixLegacySaleStage(
  prisma: PrismaClient,
  legacy: mysql.Connection,
  companyId: string,
  base: string,
  options: { apply?: boolean } = {},
): Promise<StageFixSummary> {
  const { apply = false } = options;
  const summary: StageFixSummary = {
    'Ordens concluídas': 0,
    'Ordens canceladas': 0,
    'Orçamentos aguardando': 0,
    'Orçamentos rejeitados': 0,
  };

  const vendas = await readLegacySaleStages(legacy, base);

  const documentos = await prisma.quotation.findMany({
    where: { companyId, isImported: true, legacyId: { not: null } },
    select: {
      id: true,
      legacyId: true,
      status: true,
      order: { select: { id: true, status: true } },
    },
  });

  for (const documento of documentos) {
    const sale = vendas.get(String(documento.legacyId).trim());
    if (!sale) continue;

    const alvo = targetStage(sale, documento);
    if (!alvo) continue;

    if (alvo.orderStatus) {
      summary[
        alvo.orderStatus === 'CANCELED'
          ? 'Ordens canceladas'
          : 'Ordens concluídas'
      ]++;

      if (apply) {
        await prisma.order.update({
          where: { id: documento.order!.id },
          data: { status: alvo.orderStatus },
        });
      }
    }

    if (alvo.quotationStatus) {
      summary[
        alvo.quotationStatus === 'REJECTED'
          ? 'Orçamentos rejeitados'
          : 'Orçamentos aguardando'
      ]++;

      if (apply) {
        await prisma.quotation.update({
          where: { id: documento.id },
          data: { status: alvo.quotationStatus },
        });
      }
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
      'Uso: ts-node src/scripts/fix-legacy-sale-stage.ts <email> <base> [--yes]\n' +
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

    const summary = await fixLegacySaleStage(
      prisma,
      legacy,
      companyId as string,
      base,
      { apply },
    );

    for (const [label, total] of Object.entries(summary)) {
      console.log(`${label.padEnd(24)} ${String(total).padStart(7)}`);
    }

    console.log(apply ? '\nEtapas corrigidas.' : '\nNada foi gravado.');
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
