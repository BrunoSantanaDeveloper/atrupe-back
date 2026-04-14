/* eslint-disable */
/**
 * Script para aplicar CFOPs e Naturezas de Operação para todas as empresas existentes
 *
 * Uso: node prisma/apply-fiscal-seeds.js
 */
require('dotenv/config');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Dados de CFOPs embutidos diretamente
const BASE_CFOPS = [
  {
    code: '5101',
    description: 'Venda de produção do estabelecimento',
    type: 'SAIDA',
    nature: 'ESTADUAL',
    info: 'Venda de produção do estabelecimento - Operação Estadual',
  },
  {
    code: '5102',
    description: 'Venda de mercadoria adquirida ou recebida de terceiros',
    type: 'SAIDA',
    nature: 'ESTADUAL',
    info: 'Venda de mercadoria adquirida ou recebida de terceiros - Operação Estadual',
  },
  {
    code: '5202',
    description: 'Devolução de compra para comercialização',
    type: 'SAIDA',
    nature: 'ESTADUAL',
    info: 'Devolução de compra para comercialização - Operação Estadual',
  },
  {
    code: '6101',
    description: 'Venda de produção do estabelecimento',
    type: 'SAIDA',
    nature: 'INTERESTADUAL',
    info: 'Venda de produção do estabelecimento - Operação Interestadual',
  },
  {
    code: '6102',
    description: 'Venda de mercadoria adquirida ou recebida de terceiros',
    type: 'SAIDA',
    nature: 'INTERESTADUAL',
    info: 'Venda de mercadoria adquirida ou recebida de terceiros - Operação Interestadual',
  },
  {
    code: '6202',
    description: 'Devolução de compra para comercialização',
    type: 'SAIDA',
    nature: 'INTERESTADUAL',
    info: 'Devolução de compra para comercialização - Operação Interestadual',
  },
];

// Dados de Naturezas de Operação embutidos diretamente
const BASE_OPERATION_NATURES = [
  {
    description: 'Vendas de produção do estabelecimento',
    type: 'SAIDA',
    finality: '1',
    consumerPresence: '0',
    info: 'Utilizar para vendas normais de produtos personalizados e impressos publicitários.',
    cfopInternalCode: '5102',
    cfopExternalCode: '6102',
  },
  {
    description: 'Devolução de compra para comercialização',
    type: 'SAIDA',
    finality: '4',
    consumerPresence: '0',
    info: 'Utilizar para devoluções de mercadorias adquiridas de fornecedores.',
    cfopInternalCode: '5202',
    cfopExternalCode: '6202',
  },
  {
    description: 'Venda de produção própria',
    type: 'SAIDA',
    finality: '1',
    consumerPresence: '0',
    info: 'Utilizar para vendas de produtos fabricados/industrializados pelo próprio estabelecimento.',
    cfopInternalCode: '5101',
    cfopExternalCode: '6101',
  },
];

async function applyBaseCfopsToCompany(companyId) {
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

async function applyBaseOperationNaturesToCompany(companyId) {
  let created = 0;
  let skipped = 0;

  for (const nature of BASE_OPERATION_NATURES) {
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

  const companies = await prisma.company.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });

  console.log(`📊 Encontradas ${companies.length} empresas ativas\n`);

  let totalCfopsCreated = 0;
  let totalNaturesCreated = 0;

  for (const company of companies) {
    console.log(`\n🏢 Processando: ${company.name} (${company.id})`);

    const cfopResult = await applyBaseCfopsToCompany(company.id);
    totalCfopsCreated += cfopResult.created;
    console.log(
      `   ✅ CFOPs: ${cfopResult.created} criados, ${cfopResult.skipped} já existiam`,
    );

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
