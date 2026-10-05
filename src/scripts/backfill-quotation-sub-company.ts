import { PrismaClient } from '@prisma/client';

/**
 * Preenche a subempresa fiscal nos documentos de venda que estão sem ela.
 *
 * Todo documento criado pela tela nasce com `subCompanyId` — em conta simples,
 * a própria empresa. O GET do documento monta "Empresa" a partir dela, e o
 * formulário de edição exige essa empresa: sem ela, o zod barrava o salvar em
 * silêncio, sem request e sem aviso. O importador do legado nunca gravou o
 * campo, então nenhum documento migrado aceitava edição.
 *
 * A carga nova já grava. Este script é para o que entrou antes dela, e segue a
 * mesma regra do documento nativo: subempresa = empresa do documento. Rodar de
 * novo não muda nada.
 *
 * Uso:
 *   npx ts-node src/scripts/backfill-quotation-sub-company.ts [--yes]
 *
 * Sem --yes apenas relata o que mudaria.
 */

export interface SubCompanySummary {
  /** Documentos migrados sem subempresa. */
  migrados: number;
  /** Documentos criados no sistema sem subempresa (caminhos antigos). */
  nativos: number;
  /** Quantos foram gravados (0 na simulação). */
  gravados: number;
}

export async function backfillQuotationSubCompany(
  prisma: PrismaClient,
  options: { apply?: boolean } = {},
): Promise<SubCompanySummary> {
  const { apply = false } = options;

  const migrados = await prisma.quotation.count({
    where: { subCompanyId: null, isImported: true },
  });
  const nativos = await prisma.quotation.count({
    where: { subCompanyId: null, isImported: false },
  });

  let gravados = 0;
  if (apply && migrados + nativos > 0) {
    gravados = await prisma.$executeRaw`
      UPDATE quotations
         SET "subCompanyId" = "companyId"
       WHERE "subCompanyId" IS NULL
    `;
  }

  return { migrados, nativos, gravados };
}

async function main() {
  const apply = process.argv.slice(2).includes('--yes');
  const prisma = new PrismaClient();

  try {
    console.log(
      apply ? 'Modo: gravando\n' : 'Modo: simulação (use --yes para gravar)\n',
    );

    const summary = await backfillQuotationSubCompany(prisma, { apply });

    console.log(`Migrados sem subempresa: ${summary.migrados}`);
    console.log(`Nativos sem subempresa:  ${summary.nativos}`);
    console.log(
      apply ? `\nGravados: ${summary.gravados}.` : '\nNada foi gravado.',
    );
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
