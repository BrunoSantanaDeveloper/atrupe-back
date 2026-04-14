// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const company = await prisma.company.findFirst({
    where: { name: { contains: 'Atori' } },
  });
  if (!company) {
    console.log('Company not found');
    return;
  }
  console.log('Company:', company.id);

  const subs = await prisma.subscription.findMany({
    where: { companyId: company.id },
    orderBy: { createdAt: 'desc' },
    include: { payments: true },
  });

  console.log('Subs length:', subs.length);
  subs.forEach((sub, i) => {
    console.log(
      `Sub ${i}: ID=${sub.id}, Status=${sub.status}, CreatedAt=${sub.createdAt}`,
    );
    console.log(`  Payments: ${sub.payments.length}`);
    sub.payments.forEach((p) =>
      console.log(`    Pay ID=${p.id}, Status=${p.status}`),
    );
  });
}

check().then(() => prisma.$disconnect());
