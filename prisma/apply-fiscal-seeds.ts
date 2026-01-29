/**
 * Script para aplicar CFOPs e Naturezas de Operação para todas as empresas existentes
 *
 * Uso: npx ts-node prisma/apply-fiscal-seeds.ts
 *
 * Este script irá:
 * 1. Buscar todas as empresas ativas no banco
 * 2. Para cada empresa, aplicar os itens padrão faltantes (incluindo CFOPs e Naturezas)
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { BASE_CFOPS } from '../src/seeds/cfop-base';
import { BASE_OPERATION_NATURES } from '../src/seeds/operation-nature-base';

const prisma = new PrismaClient();

async function applyBaseCfopsToCompany(companyId: string) {
  let created = 0;
  let skipped = 0;

  for (const cfop of BASE_CFOPS) {
    const existing = await prisma.cfopConfig.findUnique({
      where: {
        companyId_code: {
          companyId,
          code: cfop.code,
        },
      },
    });

    if (existing) {
      skipped++;
      continue;
    }

    await prisma.cfopConfig.create({
      data: {
        companyId,
        code: cfop.code,
        description: cfop.description,
        type: cfop.type,
        nature: cfop.nature,
        info: cfop.info,
      },
    });
    created++;
  }

  return { created, skipped };
}

async function applyBaseOperationNaturesToCompany(companyId: string) {
  let created = 0;
  let skipped = 0;

  for (const nature of BASE_OPERATION_NATURES) {
    // Buscar CFOPs relacionados
    const cfopInternal = await prisma.cfopConfig.findUnique({
      where: {
        companyId_code: {
          companyId,
          code: nature.cfopInternalCode,
        },
      },
    });

    const cfopExternal = await prisma.cfopConfig.findUnique({
      where: {
        companyId_code: {
          companyId,
          code: nature.cfopExternalCode,
        },
      },
    });

    if (!cfopInternal || !cfopExternal) {
      console.warn(
        `  ⚠️  CFOPs não encontrados para natureza '${nature.description}'. Internal: ${nature.cfopInternalCode}, External: ${nature.cfopExternalCode}`,
      );
      skipped++;
      continue;
    }

    // Verificar se já existe
    const existing = await prisma.operationNature.findFirst({
      where: {
        companyId,
        description: nature.description,
      },
    });

    if (existing) {
      skipped++;
      continue;
    }

    await prisma.operationNature.create({
      data: {
        companyId,
        description: nature.description,
        type: nature.type,
        finality: nature.finality,
        consumerPresence: nature.consumerPresence,
        info: nature.info,
        cfopInternalId: cfopInternal.id,
        cfopExternalId: cfopExternal.id,
      },
    });
    created++;
  }

  return { created, skipped };
}

async function main() {
  console.log(
    '🚀 Iniciando aplicação de seeds fiscais para empresas existentes...\n',
  );

  // Buscar todas as empresas ativas
  const companies = await prisma.company.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });

  console.log(`📊 Encontradas ${companies.length} empresas ativas\n`);

  let totalCfopsCreated = 0;
  let totalNaturesCreated = 0;

  for (const company of companies) {
    console.log(`\n🏢 Processando: ${company.name} (${company.id})`);

    // Aplicar CFOPs
    const cfopResult = await applyBaseCfopsToCompany(company.id);
    totalCfopsCreated += cfopResult.created;
    console.log(
      `   ✅ CFOPs: ${cfopResult.created} criados, ${cfopResult.skipped} já existiam`,
    );

    // Aplicar Naturezas de Operação
    const natureResult = await applyBaseOperationNaturesToCompany(company.id);
    totalNaturesCreated += natureResult.created;
    console.log(
      `   ✅ Naturezas: ${natureResult.created} criadas, ${natureResult.skipped} já existiam`,
    );
  }

  console.log('\n' + '='.repeat(60));
  console.log('📋 RESUMO FINAL:');
  console.log(`   Empresas processadas: ${companies.length}`);
  console.log(`   CFOPs criados: ${totalCfopsCreated}`);
  console.log(`   Naturezas criadas: ${totalNaturesCreated}`);
  console.log('='.repeat(60));
  console.log('\n✅ Processo concluído com sucesso!');
}

main()
  .catch((e) => {
    console.error('\n❌ Erro durante a execução:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
