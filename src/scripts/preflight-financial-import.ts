import { readFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';
import { ImportService } from '../core/import/import.service';
import { FINANCIAL_IMPORT_SCHEMA } from '../core/import/schemas/financial-import.schema';

/**
 * Diagnóstico read-only da importação financeira.
 *
 * Roda a MESMA validação do servidor sobre o CSV, sem gravar nada, e imprime
 * todas as linhas que seriam rejeitadas — inclusive as que não cabem no modal
 * de erros da tela.
 *
 * Uso:
 *   npx ts-node src/scripts/preflight-financial-import.ts <email> <caminho-csv>
 */

type ImportError = {
  row: number;
  field: string;
  value: string;
  error: string;
};

/**
 * Resolve a empresa a partir do e-mail de um usuário (o vínculo é via Employee).
 */
export async function resolveCompanyByEmail(
  prisma: PrismaClient,
  email: string,
) {
  const user = await prisma.user.findFirst({
    where: { email: email.toLowerCase().trim() },
    select: { id: true, email: true },
  });

  if (!user) {
    throw new Error(`Nenhum usuário com o e-mail ${email}`);
  }

  const employees = await prisma.employee.findMany({
    where: { userId: user.id, isActive: true },
    select: { companyId: true, company: { select: { name: true } } },
  });

  if (employees.length === 0) {
    throw new Error(`Usuário ${email} não tem colaborador ativo vinculado`);
  }

  if (employees.length > 1) {
    console.warn(
      `⚠️ Usuário vinculado a ${employees.length} empresas. Usando a primeira:`,
      employees.map((e) => e.company.name).join(', '),
    );
  }

  return {
    companyId: employees[0].companyId,
    companyName: employees[0].company.name,
  };
}

export async function runPreflight(
  prisma: PrismaClient,
  email: string,
  csvPath: string,
) {
  const { companyId, companyName } = await resolveCompanyByEmail(prisma, email);
  console.log(`✅ Empresa: ${companyName} (${companyId})`);

  // Reaproveita o parser e o validador do serviço em vez de replicá-los: assim
  // o preflight não diverge do que o servidor faz de verdade. O MinioService
  // não é usado por nenhum dos dois caminhos.
  const service = new ImportService(prisma as any, null as any);
  const internals = service as any;

  const rows = (await service.parseCsv(readFileSync(csvPath))).map((row) =>
    internals.normalizeRow(row),
  );
  console.log(`📄 ${rows.length} linha(s) de dados em ${csvPath}\n`);

  const errors: ImportError[] = [];

  for (let i = 0; i < rows.length; i++) {
    const rowErrors: ImportError[] = await internals.validateRow(
      rows[i],
      FINANCIAL_IMPORT_SCHEMA,
      companyId,
      i + 2, // mesma numeração exibida na tela
      false,
    );
    errors.push(...rowErrors);
  }

  if (errors.length === 0) {
    console.log('🎉 Nenhum erro: a importação passaria inteira.');
    return { totalRows: rows.length, errors };
  }

  console.log(
    `❌ ${errors.length} erro(s) em ${new Set(errors.map((e) => e.row)).size} linha(s)\n`,
  );

  // Agrupado por coluna + motivo + valor: é o que diz o que precisa ser
  // cadastrado, sem repetir a mesma pendência dezenas de vezes.
  const grouped = new Map<string, { sample: ImportError; rows: number[] }>();

  for (const error of errors) {
    const key = `${error.field}|${error.value}|${error.error}`;
    const entry = grouped.get(key);
    if (entry) {
      entry.rows.push(error.row);
    } else {
      grouped.set(key, { sample: error, rows: [error.row] });
    }
  }

  console.log('Pendências agrupadas:');
  for (const { sample, rows: affected } of grouped.values()) {
    console.log(`\n  [${sample.field}] ${sample.value || '(vazio)'}`);
    console.log(`     motivo: ${sample.error}`);
    console.log(
      `     linhas (${affected.length}): ${affected.slice(0, 20).join(', ')}` +
        (affected.length > 20 ? ` … +${affected.length - 20}` : ''),
    );
  }

  return { totalRows: rows.length, errors };
}

async function main() {
  const [email, csvPath] = process.argv.slice(2);

  if (!email || !csvPath) {
    console.error('❌ Informe o e-mail do usuário e o caminho do CSV:');
    console.error(
      '   npx ts-node src/scripts/preflight-financial-import.ts <email> <caminho-csv>',
    );
    process.exit(1);
  }

  let prisma: PrismaClient | undefined;
  try {
    prisma = new PrismaClient();
    const { errors } = await runPreflight(prisma, email, csvPath);
    process.exit(errors.length === 0 ? 0 : 1);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n❌ Erro no preflight: ${message}`);
    process.exit(1);
  } finally {
    await prisma?.$disconnect();
  }
}

if (require.main === module) {
  main();
}
