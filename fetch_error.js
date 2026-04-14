/* eslint-disable @typescript-eslint/no-var-requires */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const req = await prisma.fiscalOnboardingRequest.findFirst({
    orderBy: { createdAt: 'desc' },
  });
  console.log('Status:', req.status);
  console.log('Error Message:', req.errorMessage);
  console.log('CNPJ:', req.cnpj);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
