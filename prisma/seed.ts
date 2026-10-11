import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { BASE_BANKS } from '../src/seeds/banks-base';
import { BASE_FEATURES } from '../src/seeds/features-base';
import { BASE_LIMITS } from '../src/seeds/limits-base';
import { PLAN_CONFIGURATIONS } from '../src/seeds/plans-complete';
import {
  applyPlanDefaults,
  describePlanDefaultsResult,
} from '../src/seeds/apply-plan-config';
import { ACADEMY_ITEMS } from '../src/seeds/academy-base';
import { BASE_PAYMENT_METHODS } from '../src/seeds/payment-methods-base';
import { BASE_CONTACT_SOURCES } from '../src/seeds/contact-sources-base';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

/**
 * Senha de uma conta criada pelo seed, lida do ambiente.
 *
 * O seed roda em todo ambiente a cada subida (start.sh), então a senha não
 * pode morar no código: cada ambiente define a sua ou não define nenhuma, e
 * aí a conta não é criada. O valor nunca vai para o log.
 */
function passwordFromEnv(variable: string): string | null {
  const value = process.env[variable];
  return value && value.trim() !== '' ? value : null;
}

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

  // Não destrutivo: cria o recurso/limite que falta e nunca desliga nem
  // sobrescreve o que o superadmin configurou no painel de planos.
  const result = await applyPlanDefaults(prisma, PLAN_CONFIGURATIONS as any);
  console.log(describePlanDefaultsResult(result));
  for (const error of result.errors) {
    console.error(`Erro ao criar plano ${error.planType}: ${error.message}`);
  }
  if (result.errors.length > 0) {
    // O start.sh só avisa quando o seed falha; o código de saída deixa o
    // erro visível no log sem impedir a subida da API.
    process.exitCode = 1;
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

  try {
    // Verifica se o usuário já existe
    let adminUser = await prisma.user.findUnique({
      where: { email: adminEmail },
    });

    if (adminUser) {
      // A senha de quem já existe não é regravada: trocá-la é pelo sistema.
      console.log(`Usuário administrador já existe: ${adminEmail}`);
    } else {
      const adminPassword = passwordFromEnv('SEED_SYSTEM_ADMIN_PASSWORD');
      if (!adminPassword) {
        console.log(
          `SEED_SYSTEM_ADMIN_PASSWORD não definida: o administrador do sistema (${adminEmail}) não foi criado.`,
        );
        return;
      }

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

async function createCommonUser() {
  const commonEmail = 'bruno@atrupe.com.br';

  // A conta de teste inteira (empresa, cliente e assinatura
  // sub_local_test_bruno) só existe onde o ambiente define a senha dela.
  const commonPassword = passwordFromEnv('SEED_TEST_USER_PASSWORD');
  if (!commonPassword) {
    console.log(
      `SEED_TEST_USER_PASSWORD não definida: o usuário comum de testes (${commonEmail}), a empresa e a assinatura dele não foram criados.`,
    );
    return;
  }

  console.log('Criando usuário comum para testes...');

  try {
    // 1. Criar Empresa
    let company = await prisma.company.findFirst({
      where: { name: 'Bruno Digital S.A.' },
    });

    if (!company) {
      company = await prisma.company.create({
        data: {
          name: 'Bruno Digital S.A.',
          cnpj: '12.345.678/0001-90',
          legalName: 'Bruno Digital Tecnologia S.A.',
          email: commonEmail,
          isActive: true,
        },
      });
      console.log('Empresa comum criada com sucesso');
    }

    // 2. Criar Role de administrador da empresa
    let adminRole = await prisma.role.findFirst({
      where: {
        name: 'Administrador',
        companyId: company.id,
      },
    });

    if (!adminRole) {
      adminRole = await prisma.role.create({
        data: {
          name: 'Administrador',
          companyId: company.id,
          isAdmin: true,
          isActive: true,
          permissions: ['*'],
        },
      });
      console.log('Role de administrador da empresa criado com sucesso');
    }

    // 3. Criar Usuário
    let user = await prisma.user.findUnique({
      where: { email: commonEmail },
    });

    if (!user) {
      const hashedPassword = await argon2.hash(commonPassword);
      user = await prisma.user.create({
        data: {
          email: commonEmail,
          password: hashedPassword,
          name: 'Bruno Usuário',
          isActive: true,
          isVerified: true,
          phone: '+55 (11) 99999-9999',
        },
      });
      console.log(`Usuário comum criado: ${commonEmail}`);
    }

    // 4. Vincular Usuário à Empresa e Role
    const existingUserRole = await prisma.userRole.findUnique({
      where: {
        userId_roleId: {
          userId: user.id,
          roleId: adminRole.id,
        },
      },
    });

    if (!existingUserRole) {
      await prisma.userRole.create({
        data: {
          userId: user.id,
          roleId: adminRole.id,
          isSystemAdmin: false,
        },
      });
      console.log('UserRole vinculado com sucesso');
    }

    // 5. Criar Customer (Asaas) para a empresa/usuário
    let customer = await prisma.customer.findFirst({
      where: { email: commonEmail, companyId: company.id },
    });

    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          name: 'Bruno Usuário',
          email: commonEmail,
          document: '12345678901',
          asaasCustomerId: 'cus_local_test_bruno',
          companyId: company.id,
        },
      });
      console.log('Customer criado com sucesso');
    }

    // 6. Criar Subscription (para passar nas travas do middleware)
    const fullPlan = await prisma.plan.findUnique({
      where: { name: 'Full' },
    });

    if (fullPlan) {
      const existingSub = await prisma.subscription.findFirst({
        where: { companyId: company.id },
      });

      if (!existingSub) {
        await prisma.subscription.create({
          data: {
            companyId: company.id,
            customerId: customer.id,
            planId: fullPlan.id,
            asaasSubscriptionId: 'sub_local_test_bruno',
            nextDueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // +30 dias
            value: 497.0,
            status: 'ACTIVE',
            billingType: 'CREDIT_CARD',
            cycle: 'MONTHLY',
          },
        });
        console.log('Assinatura Full criada com sucesso');
      }
    }
  } catch (error) {
    console.error('Erro ao criar usuário comum:', error);
  }
}

async function main() {
  console.log('Iniciando o processo de seeding...');

  // Criar usuário administrador do sistema
  await createSystemAdminUser();

  // Criar usuário comum
  await createCommonUser();

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
