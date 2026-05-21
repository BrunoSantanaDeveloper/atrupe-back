import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const company = await prisma.company.findFirst();
  if (!company) {
    console.log('No company found');
    return;
  }

  const orderWhere: any = { companyId: company.id };
  const orders = await prisma.order.findMany({
    where: orderWhere,
    take: 5,
  });
  console.log('Orders found:', orders.length);

  const nfeWhere: any = {
    companyId: company.id,
    orderId: null,
    quotationId: null,
  };
  const nfes = await prisma.nfe.findMany({
    where: nfeWhere,
    take: 5,
  });
  console.log('NFEs found:', nfes.length);
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
