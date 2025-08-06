#!/usr/bin/env ts-node

import { PrismaService } from 'nestjs-prisma';
import { SeedPlansService } from '../seeds/seed-plans.service';

async function main() {
  const prisma = new PrismaService();
  const seedService = new SeedPlansService(prisma);

  try {
    console.log('🚀 Iniciando migração e seed dos planos...');

    // Primeiro, executar o seed
    await seedService.seedAll();

    // Verificar se foi populado corretamente
    console.log('\n📊 Verificando dados inseridos...');

    const features = await prisma.feature.count();
    console.log(`✓ Features: ${features}`);

    const limits = await prisma.limit.count();
    console.log(`✓ Limits: ${limits}`);

    const plans = await prisma.plan.count();
    console.log(`✓ Plans: ${plans}`);

    const planFeatures = await prisma.planFeature.count();
    console.log(`✓ Plan Features: ${planFeatures}`);

    const planLimits = await prisma.planLimit.count();
    console.log(`✓ Plan Limits: ${planLimits}`);

    // Mostrar exemplo de um plano completo
    console.log('\n📋 Exemplo de plano LITE com features e limits:');
    const litePlan = await seedService.getPlanByType('LITE');

    if (litePlan) {
      console.log(`Plano: ${litePlan.name}`);
      console.log(`Preço base: R$ ${(litePlan.basePrice / 100).toFixed(2)}`);
      console.log(
        `Preço usuário adicional: R$ ${(litePlan.additionalAccessPrice / 100).toFixed(2)}`,
      );

      console.log('\nFeatures:');
      litePlan.planFeatures.forEach((pf) => {
        console.log(`  - ${pf.feature.name} (${pf.feature.key})`);
      });

      console.log('\nLimits:');
      litePlan.planLimits.forEach((pl) => {
        const value = pl.value === -1 ? 'Ilimitado' : pl.value.toString();
        console.log(`  - ${pl.limit.name}: ${value} ${pl.limit.unit || ''}`);
      });
    }

    console.log('\n✅ Migração e seed concluídos com sucesso!');
  } catch (error) {
    console.error('❌ Erro durante migração e seed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main();
}
