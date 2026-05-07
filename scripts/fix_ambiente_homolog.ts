/**
 * Script de correção: Garante que todos os InvoicyConfig em homologação
 * tenham environment='HOMOLOGACAO' e ambiente=2 sincronizados.
 *
 * Execute com: npx ts-node -e "require('./scripts/fix_ambiente_homolog.ts')"
 * Ou via Prisma Studio para verificar antes.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 Verificando configurações de ambiente...\n');

  // Buscar todos os configs
  const all = await prisma.invoicyConfig.findMany({
    select: {
      id: true,
      name: true,
      environment: true,
      ambiente: true,
      companyId: true,
      company: { select: { name: true, cnpj: true } },
    },
  });

  console.log(`📋 Total de emissores encontrados: ${all.length}`);

  for (const cfg of all) {
    const envStr = cfg.environment;
    const ambInt = cfg.ambiente;
    console.log(
      `\n  Emissor: ${cfg.company?.name} (${cfg.name})\n  environment: ${envStr} | ambiente: ${ambInt}`,
    );

    // Detectar inconsistência
    const envIsProd = envStr === 'PRODUCAO';
    const ambIsProd = ambInt === 1;

    if (envIsProd !== ambIsProd) {
      console.log(`  ⚠️  INCONSISTÊNCIA DETECTADA - corrigindo...`);

      // Prioridade: corrigir para HOMOLOGACAO (seguro para testes)
      await prisma.invoicyConfig.update({
        where: { id: cfg.id },
        data: {
          environment: 'HOMOLOGACAO',
          ambiente: 2,
        },
      });
      console.log(`  ✅ Corrigido: environment=HOMOLOGACAO, ambiente=2`);
    } else if (envIsProd && ambIsProd) {
      // Ambos apontam para PRODUCAO — manter como está (é intencional)
      console.log(`  ℹ️  Configurado para PRODUÇÃO (intencional, sem alteração)`);
    } else {
      console.log(`  ✅ OK - Homologação (consistente)`);
    }
  }

  console.log('\n🎉 Verificação concluída!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
