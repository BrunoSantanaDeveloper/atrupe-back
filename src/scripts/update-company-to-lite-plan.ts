import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function updateCompanyToLitePlan() {
  const companyId = 'c0350e24-47f8-4e50-b7ee-c1c5f81ebf89';

  try {
    // 1. Verificar se a empresa existe
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      include: {
        Subscription: {
          include: { plan: true },
        },
      },
    });

    if (!company) {
      console.error(`❌ Empresa com ID ${companyId} não encontrada`);
      return;
    }

    console.log(`✅ Empresa encontrada: ${company.name}`);

    // 2. Buscar o plano LITE
    const litePlan = await prisma.plan.findFirst({
      where: {
        planType: 'LITE',
        isActive: true,
      },
    });

    if (!litePlan) {
      console.error('❌ Plano LITE não encontrado');
      return;
    }

    console.log(
      `✅ Plano LITE encontrado: ${litePlan.name} (ID: ${litePlan.id})`,
    );

    // 3. Verificar subscription ativa atual
    const activeSubscription = company.Subscription.find(
      (sub) => sub.status === 'ACTIVE',
    );

    if (activeSubscription) {
      console.log(
        `📋 Subscription ativa atual: ${activeSubscription.plan.name}`,
      );

      if (activeSubscription.plan.planType === 'LITE') {
        console.log('ℹ️ A empresa já está no plano LITE');
        return;
      }

      // 4. Atualizar a subscription existente para o plano LITE
      const updatedSubscription = await prisma.subscription.update({
        where: { id: activeSubscription.id },
        data: {
          planId: litePlan.id,
          value:
            litePlan.basePrice +
            (litePlan.additionalUserPrice || 0) *
              (activeSubscription.additionalUsers || 0),
          updatedAt: new Date(),
        },
        include: { plan: true },
      });

      console.log(
        `✅ Subscription atualizada para plano ${updatedSubscription.plan.name}`,
      );
      console.log(
        `💰 Novo valor: R$ ${(updatedSubscription.value / 100).toFixed(2)}`,
      );
    } else {
      console.log('⚠️ Nenhuma subscription ativa encontrada para esta empresa');

      // Se não há subscription ativa, você pode optar por criar uma nova
      // Mas isso requereria mais informações como dados do customer, etc.
      console.log(
        'ℹ️ Para criar uma nova subscription, seria necessário mais dados (customer, billing info, etc.)',
      );
    }

    console.log('🎉 Processo concluído com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao atualizar plano da empresa:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Executar o script
updateCompanyToLitePlan();
