// prisma/seed.ts
import { PrismaClient } from '@prisma/client';
import { BASE_UNIT_OF_MEASURES } from '../src/seeds/units-base';
import { BASE_BANKS } from '../src/seeds/banks-base';
import { BASE_FEATURES } from '../src/seeds/features-base';
import { BASE_LIMITS } from '../src/seeds/limits-base';
import { PLAN_CONFIGURATIONS } from '../src/seeds/plans-complete';

const prisma = new PrismaClient();

async function createDefaultUnitsOfMeasure() {
  console.log('Criando unidades de medida padrão...');

  for (const unitData of BASE_UNIT_OF_MEASURES) {
    try {
      const existingUnit = await prisma.defaultUnitOfMeasure.findUnique({
        where: { code: unitData.code },
      });

      if (!existingUnit) {
        await prisma.defaultUnitOfMeasure.create({
          data: {
            id: unitData.id,
            name: unitData.name,
            code: unitData.code,
            description: unitData.description,
            isActive: unitData.isActive,
            kind: unitData.kind as any,
            variant: unitData.variant as any,
          },
        });
        console.log(`Unidade de medida criada: ${unitData.name}`);
      } else {
        console.log(`Unidade de medida já existe: ${unitData.name}`);
      }
    } catch (error) {
      console.error(`Erro ao criar unidade de medida ${unitData.name}:`, error);
    }
  }
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
  console.log('Criando features padrão...');

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
  console.log('Criando limits padrão...');

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
          isActive: config.plan.isActive,
        },
        create: config.plan,
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

async function main() {
  console.log('Iniciando o processo de seeding...');

  // Criar bancos padrão
  await createDefaultBanks();

  // Criar unidades de medida padrão
  await createDefaultUnitsOfMeasure();

  // Criar features, limits e planos
  await createDefaultFeatures();
  await createDefaultLimits();
  await createDefaultPlans();

  // Opcional: Limpar dados existentes para garantir um seed limpo
  try {
    await prisma.academySystem.deleteMany({});
    console.log('Registros existentes na tabela "academy" foram deletados.');
  } catch (e) {
    console.error(
      'Erro ao deletar registros existentes, pode ser que a tabela esteja vazia ou não exista:',
      e,
    );
  }

  // Dados para a tabela AcademySystem
  const academyItems = [
    // --- Seção "Apresentação" (para o tipo "Start") ---
    {
      type: ['START'], // Indica que este item pertence à Academy "Start"
      section: 'Apresentação',
      description:
        'Bem-vindo à Academy Atrupe! Assista a este vídeo para uma introdução completa ao sistema e suas funcionalidades.',
      order: 0,
      files: [],
      videoUrl: 'https://vimeo.com/43652787', // URL padrão fornecida no modelo
      page: '/academy/start/apresentacao',
      modal: null, // Não há modal específico para a apresentação
      buttonTitle: 'Apresentação',
    },
    // --- Seção "Configurações" (para o tipo "Start" ) ---
    {
      type: ['START'],
      section: 'Configurações',
      description:
        'Cadastre os dados essenciais da sua empresa para começar a usar o sistema Atrupe.',
      order: 1,
      files: [],
      videoUrl: 'https://vimeo.com/43652787', // URL de vídeo inventada
      page: null,
      modal: 'CompanyInfoModal', // Nome de modal inventado
      buttonTitle: 'Cadastrar dados',
    },
    {
      type: ['START'],
      section: 'Configurações',
      description:
        'Defina os setores da sua empresa para organizar melhor suas operações e permissões de acesso.',
      order: 2,
      files: [],
      videoUrl: 'https://vimeo.com/43652787', // URL de vídeo inventada
      page: null,
      modal: 'SectorInfoModal', // Nome de modal inventado
      buttonTitle: 'Informar os setores',
    },
    {
      type: ['START'],
      section: 'Configurações',
      description:
        'Configure os padrões de medidas (unidades de medida ) utilizados pela sua empresa para produtos e estoque.',
      order: 3,
      files: [],
      videoUrl: 'https://vimeo.com/43652787', // URL de vídeo inventada
      page: '/configuracoes/medidas',
      modal: null, // Nome de modal inventado
      buttonTitle: 'Definir padrões',
    },
    {
      type: ['START'],
      section: 'Configurações',
      description:
        'Adicione e gerencie os colaboradores que terão acesso ao sistema, definindo seus perfis e permissões.',
      order: 4,
      files: [],
      videoUrl: 'https://vimeo.com/43652787', // URL de vídeo inventada
      page: '/configuracoes/colaboradores',
      modal: null, // Nome de modal inventado
      buttonTitle: 'Cadastrar colaboradores',
    },
    {
      type: ['START'],
      section: 'Configurações',
      description:
        'Gerencie seus produtos: edite os existentes ou cadastre novos itens para o seu catálogo.',
      order: 5,
      files: [
        'https://eppg.fgv.br/sites/default/files/teste.pdf',
        'https://eppg.fgv.br/sites/default/files/teste.pdf',
      ],
      videoUrl: 'https://vimeo.com/43652787', // URL de vídeo inventada
      page: null,
      modal: 'ProductManagementModal', // Nome de modal inventado
      buttonTitle: 'Editar produtos',
    },
    // --- Recursos/Downloads (para o tipo "Start" ) ---

    // --- Entradas de placeholder para outros tipos de Academy ---
    {
      type: ['START', 'LITE'],
      section: 'Introdução Lite',
      description:
        'Conteúdo introdutório para o nível Lite da Academy, focado em funcionalidades intermediárias.',
      order: 0,
      files: ['https://eppg.fgv.br/sites/default/files/teste.pdf'],
      videoUrl: 'https://vimeo.com/43652787',
      page: '/academy/lite/intro',
      modal: null,
      buttonTitle: 'Introdução Lite',
    },
    {
      type: ['START', 'PRO'],
      section: 'Introdução Pro',
      description:
        'Conteúdo introdutório para o nível Pro da Academy, com foco em recursos avançados e otimização.',
      order: 0,
      files: [],
      videoUrl: 'https://vimeo.com/43652787',
      page: '/academy/pro/intro',
      modal: null,
      buttonTitle: 'Introdução Pro',
    },
    {
      type: ['START', 'ELITE'],
      section: 'Introdução Elite',
      description:
        'Conteúdo introdutório para o nível Elite da Academy, para usuários que buscam maestria no sistema.',
      order: 0,
      files: [],
      videoUrl: 'https://vimeo.com/43652787',
      page: '/academy/elite/intro',
      modal: null,
      buttonTitle: 'Introdução Elite',
    },
    {
      type: ['START', 'FULL'],
      section: 'Introdução Full',
      description:
        'Conteúdo introdutório para o nível Full da Academy, abrangendo todas as funcionalidades e integrações.',
      order: 0,
      files: [],
      videoUrl: 'https://vimeo.com/43652787',
      page: '/academy/full/intro',
      modal: null,
      buttonTitle: 'Introdução Full',
    },
  ];

  // Criar os registros no banco de dados
  for (const item of academyItems) {
    await prisma.academySystem.create({
      data: item,
    });
  }

  console.log(
    `Seeding concluído! ${academyItems.length} registros criados na tabela "academy".`,
  );
}

main()
  .catch((e) => {
    console.error('Erro durante o processo de seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
