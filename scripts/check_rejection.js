const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://postgres:postgres123@localhost:5433/atrupeDb?schema=public'
    }
  }
});

async function main() {
  const nfes = await prisma.nfe.findMany({
    where: { status: 'REJECTED' },
    orderBy: { createdAt: 'desc' },
    take: 3,
    select: {
      id: true,
      numero: true,
      status: true,
      motivoRejeicao: true,
      createdAt: true
    }
  });
  console.log(JSON.stringify(nfes, null, 2));
  await prisma.$disconnect();
}

main().catch(e => { console.error(e.message); process.exit(1); });
