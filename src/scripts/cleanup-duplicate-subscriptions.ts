import { PrismaClient } from '@prisma/client';
import * as readline from 'readline';

const prisma = new PrismaClient();

async function cleanupDuplicateSubscriptions() {
  console.log('🔍 Buscando assinaturas duplicadas...\n');

  // Buscar todas as assinaturas agrupadas por (companyId, status)
  const allSubscriptions = await prisma.subscription.findMany({
    where: {
      companyId: { not: null },
    },
    orderBy: {
      createdAt: 'desc',
    },
    include: {
      Company: {
        select: {
          name: true,
          legalName: true,
        },
      },
    },
  });

  // Agrupar por (companyId, status) e identificar duplicatas
  const grouped = new Map<string, any[]>();

  for (const subscription of allSubscriptions) {
    const key = `${subscription.companyId}-${subscription.status}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(subscription);
  }

  // Identificar quais deletar (todas exceto a mais recente)
  const toDelete: string[] = [];
  const duplicateGroups: any[] = [];

  for (const [_, subscriptions] of grouped.entries()) {
    if (subscriptions.length > 1) {
      const [keep, ...remove] = subscriptions; // Primeira é a mais recente (desc)
      toDelete.push(...remove.map((s) => s.id));

      duplicateGroups.push({
        company: keep.Company?.legalName || keep.Company?.name,
        status: keep.status,
        count: subscriptions.length,
        toKeep: keep.createdAt,
        toDelete: remove.map((s) => s.createdAt),
      });
    }
  }

  console.log('📊 Estatísticas:');
  console.log(`Total de assinaturas: ${allSubscriptions.length}`);
  console.log(`Grupos duplicados: ${duplicateGroups.length}`);
  console.log(`Assinaturas a deletar: ${toDelete.length}`);
  console.log(
    `Assinaturas a manter: ${allSubscriptions.length - toDelete.length}\n`,
  );

  if (duplicateGroups.length > 0) {
    console.log('🔎 Exemplos de duplicatas (primeiras 10):');
    duplicateGroups.slice(0, 10).forEach((group, i) => {
      console.log(`${i + 1}. ${group.company} (${group.status})`);
      console.log(`   - Total: ${group.count} assinaturas`);
      console.log(`   - Manter: ${new Date(group.toKeep).toISOString()}`);
      console.log(`   - Deletar: ${group.toDelete.length} assinaturas`);
    });
    console.log('');
  }

  if (toDelete.length === 0) {
    console.log('✅ Nenhuma duplicata encontrada!');
    return;
  }

  // Confirmar antes de deletar
  console.log(
    '⚠️  ATENÇÃO: Esta operação irá deletar as assinaturas duplicadas!',
  );
  console.log(
    '⚠️  Apenas a assinatura mais recente de cada grupo será mantida.\n',
  );

  // Em produção, você pode adicionar uma confirmação aqui
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question('Confirmar deleção? (yes/no): ', async (answer: string) => {
    if (answer.toLowerCase() === 'yes') {
      console.log('\n🗑️  Deletando duplicatas...');

      const result = await prisma.subscription.deleteMany({
        where: {
          id: { in: toDelete },
        },
      });

      console.log(
        `✅ ${result.count} assinaturas duplicadas deletadas com sucesso!`,
      );
    } else {
      console.log('❌ Operação cancelada.');
    }

    rl.close();
    await prisma.$disconnect();
  });
}

cleanupDuplicateSubscriptions().catch((error) => {
  console.error('❌ Erro ao limpar duplicatas:', error);
  process.exit(1);
});
