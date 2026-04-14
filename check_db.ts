import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function check() {
  const company = await prisma.company.findFirst({
    where: { name: { contains: 'Atori' } },
  });
  if (!company) {
    console.log('Company not found');
    return;
  }
  console.log(`\n--- Company: ${company.name} | ID: ${company.id} ---`);

  const subs = await prisma.subscription.findMany({
    where: { companyId: company.id },
    orderBy: { createdAt: 'desc' },
    include: { payments: true },
  });

  console.log(`\nFound ${subs.length} subscriptions:\n`);
  subs.forEach((sub, i) => {
    console.log(`[${i + 1}] Sub ID: ${sub.id}`);
    console.log(`    Status: ${sub.status}`);
    console.log(`    Asaas ID: ${sub.asaasSubscriptionId}`);
    console.log(`    Created: ${sub.createdAt}`);
    console.log(`    Num Payments: ${sub.payments.length}`);
    sub.payments.forEach((p) => {
      console.log(
        `      -> Pay ID: ${p.id} | Status: ${p.status} | Asaas Pay ID: ${p.asaasPaymentId} | URL: ${p.invoiceUrl ? 'Yes' : 'No'}`,
      );
    });
    console.log('');
  });
}

check().then(() => prisma.$disconnect());
