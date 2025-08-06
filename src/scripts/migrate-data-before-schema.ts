#!/usr/bin/env ts-node
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function migrateData() {
  console.log('Iniciando migração de dados...');

  try {
    // 1. Migrar dados de additionalAccesses para additionalUsers nas subscriptions
    console.log('Migrando additionalAccesses para additionalUsers...');
    const subscriptions = await prisma.subscription.findMany({
      select: {
        id: true,
        additionalAccesses: true,
      },
    });

    for (const subscription of subscriptions) {
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          additionalUsers: subscription.additionalAccesses || 0,
        },
      });
    }
    console.log(
      `✅ Migrados ${subscriptions.length} registros de subscription`,
    );

    // 2. Migrar dados de additionalAccessPrice para additionalUserPrice nos plans
    console.log('Migrando additionalAccessPrice para additionalUserPrice...');
    const plans = await prisma.plan.findMany({
      select: {
        id: true,
        additionalAccessPrice: true,
      },
    });

    for (const plan of plans) {
      await prisma.plan.update({
        where: { id: plan.id },
        data: {
          additionalUserPrice: plan.additionalAccessPrice || 0,
        },
      });
    }
    console.log(`✅ Migrados ${plans.length} registros de plan`);

    console.log('✅ Migração de dados concluída com sucesso!');
    console.log(
      'Agora você pode executar: npx prisma db push --accept-data-loss',
    );
  } catch (error) {
    console.error('❌ Erro durante a migração de dados:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

migrateData();
