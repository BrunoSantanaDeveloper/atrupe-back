#!/usr/bin/env ts-node
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkSubscriptions() {
  try {
    const companyId = '69dca199-98bb-46cc-84e6-9872af2c282f';

    console.log('🔍 Verificando subscriptions...');

    // Verificar subscriptions da empresa
    const subscriptions = await prisma.subscription.findMany({
      where: { companyId },
      include: { plan: true },
    });

    console.log(`📊 Subscriptions encontradas: ${subscriptions.length}`);

    if (subscriptions.length === 0) {
      console.log('❌ Nenhuma subscription encontrada para esta empresa!');

      // Listar planos disponíveis
      const plans = await prisma.plan.findMany({
        select: { id: true, name: true, planType: true },
      });

      console.log(`📋 Planos disponíveis: ${plans.length}`);
      plans.forEach((plan) => {
        console.log(`  - ${plan.name} (${plan.planType}) - ID: ${plan.id}`);
      });

      if (plans.length > 0) {
        const trialPlan = plans.find((p) => p.planType === 'TRIAL');
        if (trialPlan) {
          console.log(
            '\n💡 Sugestão: Execute o comando para criar uma subscription TRIAL:',
          );
          console.log(
            `npx prisma db execute --stdin <<< "INSERT INTO subscriptions (id, \\"companyId\\", \\"planId\\", \\"customerId\\", \\"additionalUsers\\", \\"asaasSubscriptionId\\", \\"nextDueDate\\", value, status, \\"billingType\\", cycle, \\"createdAt\\", \\"updatedAt\\") VALUES (gen_random_uuid(), '${companyId}', '${trialPlan.id}', (SELECT id FROM customers LIMIT 1), 0, 'trial_${Date.now()}', NOW() + INTERVAL '7 days', 0, 'ACTIVE', 'CREDIT_CARD', 'MONTHLY', NOW(), NOW());"`,
          );
        }
      }
    } else {
      console.log('✅ Subscriptions encontradas:');
      subscriptions.forEach((sub, i) => {
        console.log(`  ${i + 1}. Status: ${sub.status}`);
        console.log(`     Plano: ${sub.plan.name} (${sub.plan.planType})`);
        console.log(`     Valor: R$ ${sub.value / 100}`);
        console.log(`     Criada: ${sub.createdAt}`);
        console.log('');
      });
    }
  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkSubscriptions();
