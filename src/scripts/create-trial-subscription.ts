#!/usr/bin/env ts-node
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function createTrialSubscription() {
  try {
    const companyId = '69dca199-98bb-46cc-84e6-9872af2c282f';
    
    console.log('🏢 Criando subscription TRIAL para empresa:', companyId);
    
    // 1. Verificar se a empresa existe
    const company = await prisma.company.findUnique({
      where: { id: companyId }
    });
    
    if (!company) {
      console.log('❌ Empresa não encontrada!');
      return;
    }
    
    console.log('✅ Empresa encontrada');
    
    // 2. Buscar plano TRIAL
    const trialPlan = await prisma.plan.findFirst({
      where: { planType: 'TRIAL' }
    });
    
    if (!trialPlan) {
      console.log('❌ Plano TRIAL não encontrado!');
      return;
    }
    
    console.log('✅ Plano TRIAL encontrado:', trialPlan.name);
    
    // 3. Buscar qualquer customer ou criar um novo
    let customer = await prisma.customer.findFirst();
    
    if (!customer) {
      console.log('📝 Criando customer...');
      customer = await prisma.customer.create({
        data: {
          name: 'Cliente Trial',
          email: `trial-${Date.now()}@empresa.com`,
          document: `00000000000${Date.now()}`,
          asaasCustomerId: `asaas_trial_${Date.now()}`,
          phone: '11999999999',
          address: 'Rua Teste 123',
          city: 'São Paulo',
          state: 'SP',
          postalCode: '01000-000',
          addressNumber: '123'
        }
      });
      console.log('✅ Customer criado:', customer.id);
    } else {
      console.log('✅ Customer existente:', customer.id);
    }
    
    // 4. Verificar se já existe subscription ativa
    const existingSubscription = await prisma.subscription.findFirst({
      where: { 
        companyId,
        status: 'ACTIVE'
      }
    });
    
    if (existingSubscription) {
      console.log('⚠️ Já existe subscription ativa:', existingSubscription.id);
      console.log('Status:', existingSubscription.status);
      return;
    }
    
    // 5. Criar subscription TRIAL
    const trialEndDate = new Date();
    trialEndDate.setDate(trialEndDate.getDate() + 7); // 7 dias
    
    const subscription = await prisma.subscription.create({
      data: {
        companyId: companyId,
        planId: trialPlan.id,
        customerId: customer.id,
        additionalUsers: 0,
        additionalAccesses: 0, // Compatibilidade
        modules: [], // Compatibilidade
        asaasSubscriptionId: `trial_manual_${Date.now()}`,
        nextDueDate: trialEndDate,
        value: 0, // Gratuito
        status: 'ACTIVE',
        billingType: 'CREDIT_CARD',
        cycle: 'MONTHLY'
      }
    });
    
    console.log('🎉 Subscription TRIAL criada com sucesso!');
    console.log('ID:', subscription.id);
    console.log('Status:', subscription.status);
    console.log('Termina em:', subscription.nextDueDate);
    
  } catch (error) {
    console.error('❌ Erro ao criar subscription:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createTrialSubscription();