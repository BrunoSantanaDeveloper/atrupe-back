#!/usr/bin/env ts-node
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixMissingSubscriptions() {
  console.log('🔍 Verificando subscriptions...');

  try {
    // 1. Verificar quantas subscriptions existem
    const totalSubs = await prisma.subscription.count();
    const activeSubs = await prisma.subscription.count({});

    console.log(`📊 Total subscriptions: ${totalSubs}`);
    console.log(`✅ Active subscriptions: ${activeSubs}`);

    // 2. Verificar se existem planos
    const plans = await prisma.plan.findMany({
      select: { id: true, name: true, planType: true },
    });
    console.log(`📋 Planos disponíveis: ${plans.length}`);
    if (plans.length > 0) {
      console.log(
        'Planos:',
        plans.map((p) => `${p.name} (${p.planType})`).join(', '),
      );
    }

    // 3. Verificar a empresa específica
    const companyId = '69dca199-98bb-46cc-84e6-9872af2c282f';
    console.log(`\n🏢 Verificando empresa: ${companyId}`);

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      include: {
        Subscription: true,
      },
    });

    if (!company) {
      console.log('❌ Empresa não encontrada!');
      return;
    }

    console.log(
      `✅ Empresa encontrada: ${(company as any).companyName || 'Sem nome'}`,
    );
    console.log(`📅 Trial termina em: ${company.trialEndsAt || 'Sem trial'}`);
    console.log(`🔒 Subscriptions da empresa: ${company.Subscription.length}`);

    if (company.Subscription.length === 0) {
      console.log('🚨 Empresa sem subscription! Criando subscription TRIAL...');

      // Buscar plano TRIAL
      const trialPlan = plans.find((p) => p.planType === 'TRIAL');
      if (!trialPlan) {
        console.log('❌ Plano TRIAL não encontrado!');
        return;
      }

      // Criar customer (sem companyId - não existe no modelo)
      const customer = await prisma.customer.create({
        data: {
          name: (company as any).companyName || 'Empresa',
          email: `trial-${Date.now()}@empresa.com`,
          document: `00000000000${Date.now()}`, // Campo obrigatório
          asaasCustomerId: `asaas_trial_${Date.now()}`, // Campo obrigatório
          phone: '11999999999',
          address: 'Endereço Padrão',
          city: 'São Paulo',
          state: 'SP',
          postalCode: '01000-000',
          addressNumber: '123',
        },
      });

      // Criar subscription TRIAL
      const trialEndDate = new Date();
      trialEndDate.setDate(trialEndDate.getDate() + 7); // 7 dias de trial

      const subscription = await prisma.subscription.create({
        data: {
          companyId: company.id,
          planId: trialPlan.id,
          customerId: customer.id,
          additionalUsers: 0,
          // additionalAccesses campo removido
          // modules array removido - usar subscriptionFeatures
          asaasSubscriptionId: `trial_${Date.now()}`,
          nextDueDate: trialEndDate,
          value: 0, // Trial gratuito
          billingType: 'CREDIT_CARD',
          cycle: 'MONTHLY',
        },
      });

      console.log(`✅ Subscription TRIAL criada: ${subscription.id}`);
    } else {
      console.log('📋 Subscriptions existentes:');
      company.Subscription.forEach((sub, i) => {
        console.log(
          `  ${i + 1}. Status: ${sub.status}, Plan: ${sub.planId}, Valor: R$ ${sub.value / 100}`,
        );
      });
    }

    console.log('\n🎯 Testando PlanControlService...');

    // Importar e testar o serviço (simulação)
    console.log('📝 Para testar, use:');
    console.log(`await planControlService.getCompanyPlanInfo('${companyId}');`);
  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixMissingSubscriptions();
