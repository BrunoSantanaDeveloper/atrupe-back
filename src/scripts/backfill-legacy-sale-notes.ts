import { PrismaClient } from '@prisma/client';
import * as mysql from 'mysql2/promise';
import { resolveCompanyByEmail } from './preflight-financial-import';

/**
 * Preenche, nos documentos já migrados, as observações de pagamento e entrega.
 *
 * O legado guarda pagamento e entrega como linhas próprias da venda (tipos 98 e
 * 99) e é na observação delas que ficam os recados que saem no orçamento
 * impresso — "R$ 302 Thiago", chave PIX, combinação de parcelas. A carga só lia
 * a linha de produto, então esses recados não vieram.
 *
 * A carga nova já traz. Este script é para o que entrou antes dela: escreve
 * apenas onde o campo está vazio, então não desfaz nada que alguém tenha
 * escrito no Atrupe, e pode rodar de novo sem efeito.
 *
 * Uso:
 *   npx ts-node src/scripts/backfill-legacy-sale-notes.ts <email> <base> [--yes]
 *   npx ts-node src/scripts/backfill-legacy-sale-notes.ts --company-id=<id> <base> [--yes]
 */

/** Linha de pagamento da venda no legado. */
const PAYMENT_ITEM_TYPE = 98;

/** Linha de entrega da venda no legado. */
const DELIVERY_ITEM_TYPE = 99;

export interface LegacyNotes {
  payment: string;
  delivery: string;
}

export interface NotesSummary {
  pagamento: number;
  entrega: number;
}

/** Observação já escrita não é tocada: pode ter sido ajustada no Atrupe. */
export function noteToWrite(
  atual: string | null | undefined,
  legado: string,
): string | null {
  if (!legado.trim()) return null;
  if (atual && atual.trim()) return null;
  return legado.trim();
}

export async function readLegacyNotes(
  legacy: mysql.Connection,
  base: string,
): Promise<Map<string, LegacyNotes>> {
  const [rows] = await legacy.query(`
    SELECT i.fkidsalesvenda      AS legacyId,
           i.fkidtipovendaitem   AS tipo,
           i.vendaitem_observacao AS observacao
      FROM ${base}.sales_venda_item i
     WHERE i.fkidtipovendaitem IN (${PAYMENT_ITEM_TYPE}, ${DELIVERY_ITEM_TYPE})
       AND i.vendaitem_observacao IS NOT NULL
       AND i.vendaitem_observacao <> ''
  `);

  const notas = new Map<string, LegacyNotes>();

  for (const row of rows as any[]) {
    const legacyId = String(row.legacyId ?? '').trim();
    if (!legacyId) continue;

    const atual = notas.get(legacyId) ?? { payment: '', delivery: '' };
    if (Number(row.tipo) === PAYMENT_ITEM_TYPE) {
      atual.payment = String(row.observacao ?? '');
    } else {
      atual.delivery = String(row.observacao ?? '');
    }
    notas.set(legacyId, atual);
  }

  return notas;
}

export async function backfillLegacySaleNotes(
  prisma: PrismaClient,
  legacy: mysql.Connection,
  companyId: string,
  base: string,
  options: { apply?: boolean } = {},
): Promise<NotesSummary> {
  const { apply = false } = options;
  const notas = await readLegacyNotes(legacy, base);
  const summary: NotesSummary = { pagamento: 0, entrega: 0 };

  const documentos = await prisma.quotation.findMany({
    where: { companyId, isImported: true, legacyId: { not: null } },
    select: {
      legacyId: true,
      quotationPayment: { select: { id: true, description: true } },
      deliveryInfo: { select: { id: true, notes: true } },
    },
  });

  for (const documento of documentos) {
    const legado = notas.get(String(documento.legacyId).trim());
    if (!legado) continue;

    const pagamento = documento.quotationPayment;
    const descricao = pagamento
      ? noteToWrite(pagamento.description, legado.payment)
      : null;

    if (pagamento && descricao) {
      summary.pagamento++;
      if (apply) {
        await prisma.quotationPayment.update({
          where: { id: pagamento.id },
          data: { description: descricao },
        });
      }
    }

    const entrega = documento.deliveryInfo;
    const observacao = entrega
      ? noteToWrite(entrega.notes, legado.delivery)
      : null;

    if (entrega && observacao) {
      summary.entrega++;
      if (apply) {
        await prisma.deliveryInfo.update({
          where: { id: entrega.id },
          data: { notes: observacao },
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
      'Uso: ts-node src/scripts/backfill-legacy-sale-notes.ts <email> <base> [--yes]\n' +
        '     ou --company-id=<id> <base> [--yes]',
    );
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
        ? 'Modo:    gravando\n'
        : 'Modo:    simulação (use --yes para gravar)\n',
    );

    const summary = await backfillLegacySaleNotes(
      prisma,
      legacy,
      companyId as string,
      base,
      { apply },
    );

    console.log(`Observação de pagamento: ${summary.pagamento}`);
    console.log(`Observação de entrega:   ${summary.entrega}`);
    console.log(apply ? '\nGravado.' : '\nNada foi gravado.');
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
