import { PrismaClient } from '@prisma/client';
import { BASE_BANKS } from '../seeds/banks-base';

/**
 * Contas bancárias exigidas pela importação financeira.
 *
 * Os nomes precisam ser idênticos aos da coluna ContaBancaria do CSV: o
 * validador da importação busca por `name` exato (financial-import.schema.ts).
 * Origem desta lista: attachments/financeiro-novo-extrato-atrupe.csv
 */
export const ACCOUNTS_TO_CREATE = [
  { name: 'Bradesco CC 8392-5', bankCode: '237' },
  { name: 'Sicredi CC 47204-3', bankCode: '748' },
  { name: 'Caixa do Financeiro', bankCode: '000' },
  { name: 'Stone CC 22230540-1', bankCode: '197' },
];

/**
 * Garante que o banco do catálogo global exista, criando a partir do seed
 * base quando faltar (o Sicredi só passou a existir lá recentemente).
 */
async function ensureBank(prisma: PrismaClient, bankCode: string) {
  const existing = await prisma.bank.findFirst({ where: { code: bankCode } });

  if (existing) return existing;

  const seedBank = BASE_BANKS.find((bank) => bank.code === bankCode);

  if (!seedBank) {
    throw new Error(
      `Banco de código ${bankCode} não existe na base nem em BASE_BANKS`,
    );
  }

  const created = await prisma.bank.create({
    data: {
      name: seedBank.name,
      code: seedBank.code,
      icon: seedBank.icon,
    },
  });

  console.log(`🏦 Banco criado: ${created.name} (${created.code})`);

  return created;
}

export async function runCreateBankAccounts(
  prisma: PrismaClient,
  companyId: string,
) {
  const company = await prisma.company.findUnique({ where: { id: companyId } });

  if (!company) {
    throw new Error(`Empresa com ID ${companyId} não encontrada`);
  }

  console.log(`✅ Empresa encontrada: ${company.name}`);

  // O cadastro pela tela cria uma linha de controle de caixa por condição de
  // pagamento, todas desligadas por padrão. Replicado aqui para as contas
  // criadas pelo script ficarem iguais às criadas pela interface.
  const paymentConditions = await prisma.paymentCondition.findMany({
    where: { companyId, isActive: true },
    select: { id: true },
  });

  console.log(
    `ℹ️ ${paymentConditions.length} condição(ões) de pagamento ativa(s)`,
  );

  const summary = { created: 0, reactivated: 0, skipped: 0 };

  for (const account of ACCOUNTS_TO_CREATE) {
    const existing = await prisma.bankAccount.findFirst({
      where: { name: account.name, companyId },
    });

    if (existing?.isActive) {
      console.log(`⏭️ Já existe e está ativa: ${account.name}`);
      summary.skipped++;
      continue;
    }

    // Conta inativa com o mesmo nome também faz a importação falhar, porque o
    // validador filtra por isActive: true. Reativar em vez de duplicar.
    if (existing) {
      await prisma.bankAccount.update({
        where: { id: existing.id },
        data: { isActive: true },
      });
      console.log(`♻️ Reativada: ${account.name}`);
      summary.reactivated++;
      continue;
    }

    const bank = await ensureBank(prisma, account.bankCode);

    await prisma.bankAccount.create({
      data: {
        name: account.name,
        bankId: bank.id,
        companyId,
        cashControl: true,
        bankAccountCashControl: {
          createMany: {
            data: paymentConditions.map((condition) => ({
              paymentConditionId: condition.id,
              acceptIncomes: false,
              incomeType: 'PAYSOFF' as const,
              acceptPayments: false,
              paymentType: 'PAYSOFF' as const,
            })),
          },
        },
      },
    });

    console.log(`✅ Criada: ${account.name} (${bank.name})`);
    summary.created++;
  }

  const active = await prisma.bankAccount.findMany({
    where: { companyId, isActive: true },
    select: { name: true },
    orderBy: { name: 'asc' },
  });

  console.log('\n📋 Contas ativas da empresa:');
  active.forEach((item) => console.log(`   - ${item.name}`));

  return summary;
}

async function main() {
  const companyId = process.argv[2];

  if (!companyId) {
    console.error('❌ Informe o companyId:');
    console.error(
      '   npx ts-node src/scripts/create-bank-accounts.ts <companyId>',
    );
    process.exit(1);
  }

  let prisma: PrismaClient | undefined;
  try {
    prisma = new PrismaClient();
    const summary = await runCreateBankAccounts(prisma, companyId);
    console.log(
      `\n🎉 Concluído: ${summary.created} criada(s), ` +
        `${summary.reactivated} reativada(s), ${summary.skipped} já existente(s)`,
    );
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n❌ Erro ao criar contas bancárias: ${message}`);
    process.exit(1);
  } finally {
    await prisma?.$disconnect();
  }
}

if (require.main === module) {
  main();
}
