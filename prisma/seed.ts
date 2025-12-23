// prisma/seed.ts
import { PrismaClient } from '@prisma/client';
import { BASE_BANKS } from '../src/seeds/banks-base';
import { BASE_FEATURES } from '../src/seeds/features-base';
import { BASE_LIMITS } from '../src/seeds/limits-base';
import { PLAN_CONFIGURATIONS } from '../src/seeds/plans-complete';
import { ACADEMY_ITEMS } from '../src/seeds/academy-base';
import { BASE_PAYMENT_METHODS } from '../src/seeds/payment-methods-base';
import { BASE_CONTACT_SOURCES } from '../src/seeds/contact-sources-base';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function createDefaultBanks() {
  console.log('Criando bancos padrão...');

  for (const bankData of BASE_BANKS) {
    try {
      const existingBank = await prisma.bank.findFirst({
        where: { code: bankData.code },
      });

      if (!existingBank) {
        await prisma.bank.create({
          data: {
            name: bankData.name,
            code: bankData.code,
            icon: bankData.icon,
          },
        });
        console.log(`Banco criado: ${bankData.name} (${bankData.code})`);
      } else {
        console.log(`Banco já existe: ${bankData.name} (${bankData.code})`);
      }
    } catch (error) {
      console.error(`Erro ao criar banco ${bankData.name}:`, error);
    }
  }
}

async function createDefaultFeatures() {
  console.log('Criando features de planos padrão...');

  for (const feature of BASE_FEATURES) {
    try {
      await prisma.feature.upsert({
        where: { key: feature.key },
        update: {
          name: feature.name,
          description: feature.description,
          category: feature.category,
          price: feature.price,
          isActive: feature.isActive,
        },
        create: feature,
      });
      console.log(`Feature criada/atualizada: ${feature.name}`);
    } catch (error) {
      console.error(`Erro ao criar feature ${feature.name}:`, error);
    }
  }
}

async function createDefaultLimits() {
  console.log('Criando limits de planos padrão...');

  for (const limit of BASE_LIMITS) {
    try {
      await prisma.limit.upsert({
        where: { key: limit.key },
        update: {
          name: limit.name,
          description: limit.description,
          unit: limit.unit,
          isActive: limit.isActive,
        },
        create: limit,
      });
      console.log(`Limit criado/atualizado: ${limit.name}`);
    } catch (error) {
      console.error(`Erro ao criar limit ${limit.name}:`, error);
    }
  }
}

async function createDefaultPaymentMethods() {
  console.log('Criando métodos de pagamento padrão...');

  for (const method of BASE_PAYMENT_METHODS) {
    try {
      const existingMethod = await prisma.paymentMethod.findFirst({
        where: { code: method.code },
      });

      if (!existingMethod) {
        await prisma.paymentMethod.create({
          data: {
            name: method.name,
            code: method.code,
          },
        });
        console.log(
          `Método de pagamento criado: ${method.name} (${method.code})`,
        );
      } else {
        console.log(
          `Método de pagamento já existe: ${method.name} (${method.code})`,
        );
      }
    } catch (error) {
      console.error(`Erro ao criar método de pagamento ${method.name}:`, error);
    }
  }
}

async function createDefaultPlans() {
  console.log('Criando planos padrão...');

  for (const [planKey, config] of Object.entries(PLAN_CONFIGURATIONS)) {
    try {
      // Criar ou atualizar o plano
      const plan = await prisma.plan.upsert({
        where: { name: config.plan.name },
        update: {
          description: config.plan.description,
          basePrice: config.plan.basePrice,
          additionalUserPrice: config.plan.additionalUserPrice,
          planType: config.plan.planType,
          order: config.plan.order,
          isActive: config.plan.isActive,
          badge: config.badge || null,
          concept: config.concept || null,
          features: config.featuresList || null,
        },
        create: {
          ...config.plan,
          badge: config.badge || null,
          concept: config.concept || null,
          features: config.featuresList || null,
        },
      });

      // Limpar features e limits antigos
      await prisma.planFeature.deleteMany({
        where: { planId: plan.id },
      });
      await prisma.planLimit.deleteMany({
        where: { planId: plan.id },
      });

      // Associar features ao plano
      for (const featureKey of config.features) {
        const feature = await prisma.feature.findUnique({
          where: { key: featureKey },
        });

        if (feature) {
          await prisma.planFeature.create({
            data: {
              planId: plan.id,
              featureId: feature.id,
              isActive: true,
            },
          });
        }
      }

      // Associar limits ao plano
      for (const [limitKey, value] of Object.entries(config.limits)) {
        const limit = await prisma.limit.findUnique({
          where: { key: limitKey },
        });

        if (limit) {
          await prisma.planLimit.create({
            data: {
              planId: plan.id,
              limitId: limit.id,
              value: value as number,
              isActive: true,
            },
          });
        }
      }

      console.log(`Plano criado/atualizado: ${config.plan.name}`);
    } catch (error) {
      console.error(`Erro ao criar plano ${planKey}:`, error);
    }
  }
}

async function createDefaultAcademyItems() {
  console.log('Criando/atualizando itens da Academy...');

  let created = 0;
  let updated = 0;

  for (const item of ACADEMY_ITEMS) {
    try {
      // Buscar registro existente pelo identificador único (section + title)
      const existing = await prisma.academySystem.findFirst({
        where: {
          section: item.section,
          title: item.title,
        },
      });

      if (existing) {
        // Atualizar registro existente
        await prisma.academySystem.update({
          where: { id: existing.id },
          data: {
            type: item.type,
            description: item.description,
            order: item.order,
            videoUrl: item.videoUrl,
            page: item.page ?? null,
            modal: item.modal ?? null,
            buttonTitle: item.buttonTitle ?? null,
            files: item.files as any,
          },
        });
        updated++;
        console.log(
          `Item da Academy atualizado: ${item.title} (${item.section})`,
        );
      } else {
        // Criar novo registro
        await prisma.academySystem.create({
          data: {
            ...item,
            files: item.files as any,
            page: item.page ?? null,
            modal: item.modal ?? null,
            buttonTitle: item.buttonTitle ?? null,
          },
        });
        created++;
        console.log(`Item da Academy criado: ${item.title} (${item.section})`);
      }
    } catch (error) {
      console.error(
        `Erro ao criar/atualizar item da Academy ${item.title}:`,
        error,
      );
    }
  }

  console.log(
    `Academy seeding concluído! ${created} criados, ${updated} atualizados.`,
  );
}

async function createDefaultContactSources() {
  console.log('Criando fontes de contato padrão...');

  for (const source of BASE_CONTACT_SOURCES) {
    try {
      const existingSource = await prisma.contactSource.findFirst({
        where: { name: source.name },
      });

      if (!existingSource) {
        await prisma.contactSource.create({
          data: {
            name: source.name,
          },
        });
        console.log(`Fonte de contato criada: ${source.name}`);
      } else {
        console.log(`Fonte de contato já existe: ${source.name}`);
      }
    } catch (error) {
      console.error(`Erro ao criar fonte de contato ${source.name}:`, error);
    }
  }
}

async function createSystemAdminUser() {
  console.log('Criando usuário administrador do sistema...');

  const adminEmail = 'sistema@atrupe.com.br';
  const adminPassword = 'fkD31=b5y&1$';

  try {
    // Verifica se o usuário já existe
    let adminUser = await prisma.user.findUnique({
      where: { email: adminEmail },
    });

    if (adminUser) {
      console.log(`Usuário administrador já existe: ${adminEmail}`);
    } else {
      // Hash da senha usando argon2
      const hashedPassword = await argon2.hash(adminPassword);

      // Cria o usuário administrador do sistema
      // Este usuário não está vinculado a nenhuma empresa específica
      // e tem permissões especiais para gerenciar o sistema
      adminUser = await prisma.user.create({
        data: {
          email: adminEmail,
          password: hashedPassword,
          name: 'Administrador do Sistema',
          isActive: true,
          isVerified: true,
          phone: '+55 (00) 00000-0000', // Identificador especial para admin de sistema
        },
      });

      console.log(`Usuário administrador criado com sucesso: ${adminEmail}`);
    }

    // Criar uma Company especial para o sistema (se não existir)
    let systemCompany = await prisma.company.findFirst({
      where: { name: 'Sistema Atrupe' },
    });

    if (!systemCompany) {
      systemCompany = await prisma.company.create({
        data: {
          name: 'Sistema Atrupe',
          cnpj: '00.000.000/0000-00',
          legalName: 'Sistema Administrativo Atrupe',
          email: 'sistema@atrupe.com.br',
          isActive: true,
        },
      });
      console.log('Empresa do sistema criada com sucesso');
    }

    // Criar um Role de administrador do sistema
    let systemRole = await prisma.role.findFirst({
      where: {
        name: 'Administrador do Sistema',
        companyId: systemCompany.id,
      },
    });

    if (!systemRole) {
      systemRole = await prisma.role.create({
        data: {
          name: 'Administrador do Sistema',
          companyId: systemCompany.id,
          isAdmin: true,
          isActive: true,
          permissions: ['*'], // Todas as permissões
        },
      });
      console.log('Role de administrador do sistema criado com sucesso');
    }

    // Criar UserRole marcando como administrador do sistema
    const existingUserRole = await prisma.userRole.findUnique({
      where: {
        userId_roleId: {
          userId: adminUser.id,
          roleId: systemRole.id,
        },
      },
    });

    if (!existingUserRole) {
      await prisma.userRole.create({
        data: {
          userId: adminUser.id,
          roleId: systemRole.id,
          isSystemAdmin: true,
        },
      });
      console.log('UserRole de administrador do sistema criado com sucesso');
    }

    console.log(
      `ID do admin: ${adminUser.id} - Use este ID para identificar o admin do sistema`,
    );
  } catch (error) {
    console.error('Erro ao criar usuário administrador do sistema:', error);
  }
}

async function main() {
  console.log('Iniciando o processo de seeding...');

  // Criar usuário administrador do sistema
  await createSystemAdminUser();

  // Criar bancos padrão
  await createDefaultBanks();

  // Criar métodos de pagamento padrão
  await createDefaultPaymentMethods();

  // Criar fontes de contato padrão
  await createDefaultContactSources();

  // Criar features, limits e planos
  await createDefaultFeatures();
  await createDefaultLimits();
  await createDefaultPlans();

  // Criar itens da Academy
  await createDefaultAcademyItems();
}

main()
  .catch((e) => {
    console.error('Erro durante o processo de seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
