const liteFeatures = [
  'pdf_show_item_details',
  'sectors_configuration',
  'service_order_current_phase',
  'quotation_quick_sale',
  'quotation_rejection_reasons',
  'quotation_require_rejection_reason',
  'service_order_cancellation_reason',
  'quotation_status_configuration',
  'quotation_status_column',
  'delivery_production_tabs',
  'delivery_production_stages',
  'delivery_stage_status_change',
  'accounts_receivable',
  'accounts_payable',
  'cash_control',
  'bank_account_cash_control_switch',
  'pdv_screen',
  'bank_account_creation',
  'payment_condition_operator_fee',
  'credit_limit_configuration',
  'product_composition',
  'product_production_stages',
  'client_additional_tabs',
  'supplier_additional_tabs',
  'bank_account_delete',
  'bank_account_provision',
  'payment_difference',
];

const proFeatures = [...liteFeatures];

const eliteFeatures = [...proFeatures];

const fullFeatures = [...eliteFeatures];

export const PLAN_CONFIGURATIONS = {
  TRIAL: {
    plan: {
      planType: 'TRIAL' as const,
      name: 'Trial',
      description: '',
      basePrice: 0,
      additionalUserPrice: 1500,
      order: 0,
      isActive: true,
    },
    badge: null,
    concept: null,
    features: [],
    videoUrl: null,
    featuresList: null,
    limits: {
      max_users: 3,
      max_companies: 1,
      trial_days: 15, // 15 dias de teste trial
    },
  },

  START: {
    plan: {
      planType: 'START' as const,
      name: 'Start',
      description: '',
      basePrice: 14700, // preço start
      additionalUserPrice: 1500,
      order: 1,
      isActive: true,
    },
    badge: null,
    concept: {
      description:
        'Na jornada da excelência, tudo começa com a organização e estruturação das informações. Esse ponto de partida cria as bases para que o negócio avance de forma organizada e profissional.',
      objective:
        'Digitalizar e estruturar as informações principais, garantindo um início profissional e funcional.',
      mainActions: [
        'Cadastro de clientes, fornecedores, colaboradores e produtos.',
        'Organização financeira básica: plano de contas, despesas fixas, folha de pagamento e receitas.',
        'Implementação de um sistema simples para emissão de pedidos, controle financeiro básico e aparência profissional.',
      ],
      expectedResults: {
        text: 'A empresa sai do improviso, garantindo que nenhum trabalho seja esquecido, com informações organizadas e uma imagem mais profissional.',
      },
    },
    features: [],
    videoUrl: 'https://youtu.be/kGTQD84QJ1U',
    featuresList: [
      {
        title: 'Empresa e sistema',
        items: [
          '3 usuários',
          'Cadastro de 1 CNPJ',
          'Padrões de medida',
          'Cadastro de colaboradores',
          'Perfis de usuário',
          'Setores',
        ],
        videoUrl: '',
      },
      {
        title: 'Vendas',
        items: ['Orçamentos', 'Ordens de serviço'],
        videoUrl: '',
      },
      {
        title: 'Financeiro',
        items: [
          'Fluxo financeiro',
          'Formas de pagamento',
          'Despesas fixas',
          'Folha de pagamento (Simplificada)',
          'Plano de contas',
        ],
        videoUrl: '',
      },
      {
        title: 'Produtos',
        items: ['Produtos sem composição'],
        videoUrl: '',
      },
      {
        title: 'Cadastros',
        items: ['Clientes (Simplificado)', 'Fornecedores (Simplificado)'],
        videoUrl: '',
      },
    ],
    limits: {
      max_users: 3,
      max_companies: 1,
      trial_days: 0,
    },
  },

  LITE: {
    plan: {
      planType: 'LITE' as const,
      name: 'Lite',
      description: '',
      basePrice: 23000, // preço lite
      additionalUserPrice: 1500,
      order: 2,
      isActive: false,
    },
    badge: {
      text: 'Em breve',
      variant: 'orangeLight',
    },
    concept: {
      description:
        'Com as bases lançadas na Etapa Start, o próximo passo é fortalecer a estabilidade financeira e comercial do negócio por meio de ferramentas mais robustas.',
      objective:
        'Aprofundar o controle financeiro da empresa enquanto integra informações comerciais (CRM) para facilitar tomadas de decisão estratégicas.',
      mainActions: [
        'Cadastro de produtos com composições básicas.',
        'Controle financeiro avançado:',
        'Separação por contas bancárias.',
        'Definição de limites de crédito para clientes.',
        'Opção para repasse automático das taxas financeiras.',
        'Introdução ao CRM (Gestão Comercial):',
        'Status das negociações em andamento.',
        'Motivos dos cancelamentos registrados no sistema.',
        'Histórico completo dos clientes:',
      ],
      expectedResults: {
        text: 'A empresa ganha previsibilidade financeira:',
        list: [
          'Redução significativa nas perdas financeiras;',
          'Melhor controle sobre vendas/compras;',
          'Decisões comerciais mais assertivas graças ao CRM integrado.',
        ],
      },
      footer:
        'As informações cadastradas aqui evoluem diretamente pra próxima etapa — sem retrabalho!',
    },
    features: liteFeatures,
    videoUrl: 'https://youtu.be/phhbVqmLWdM',
    featuresList: null,
    limits: {
      max_users: 5,
      max_companies: 1,
      trial_days: 0,
    },
  },

  PRO: {
    plan: {
      planType: 'PRO' as const,
      name: 'Pro',
      description: '',
      basePrice: 0, // preço pro
      additionalUserPrice: 1500,
      order: 3,
      isActive: false,
    },
    badge: {
      text: 'Em breve',
      variant: 'orangeLight',
    },
    concept: {
      description:
        'Essa é a grande virada! Com a estabilidade financeira consolidada, é hora de aprofundar o conhecimento sobre custos e estruturar os processos para maior eficiência.',
      objective:
        'Compreender os custos reais e criar padrões para processos e orçamentos.',
      mainActions: [
        'Cadastro detalhado de custos: mão de obra, materiais e equipamentos.',
        'Identificação de trabalhos mais lucrativos e eliminação de serviços deficitários.',
        'Padronização de processos de trabalho, criando fluxos claros para orçamentos e produção.',
        'Delegação de funções antes centralizadas no dono da empresa baseada nesses processos.',
      ],
      expectedResults: {
        text: 'A empresa ganha clareza sobre sua operação, reduz sua linha de produtos para focar no que é mais lucrativo e padroniza processos, diminuindo a dependência exclusiva do dono.',
      },
    },
    features: proFeatures,
    videoUrl: 'https://youtu.be/dEn2hnlz0tk',
    featuresList: null,
    limits: {
      max_users: 10,
      max_companies: 1,
      trial_days: 0,
    },
  },

  ELITE: {
    plan: {
      planType: 'ELITE' as const,
      name: 'Elite',
      description: '',
      basePrice: 0, // preço elite
      additionalUserPrice: 1500,
      order: 4,
      isActive: false,
    },
    badge: {
      text: 'Em breve',
      variant: 'orangeLight',
    },
    concept: {
      description:
        'Nesta etapa, a empresa passa a contar com um gerenciador de produção exclusivo, desenvolvido para atender às necessidades específicas de empresas de comunicação visual e gráficas.',
      objective:
        'Integrar todos os setores ao sistema, garantindo um gerenciamento eficiente da produção com base em dados reais.',
      mainActions: [
        'Implementação do gerenciador de produção:',
        'Adaptável à estrutura específica da empresa.',
        'Baseado nas composições detalhadas dos produtos criadas na Etapa 3.',
        'Treinamento direcionado:',
        'Cada setor aprende como usar o sistema dentro das suas funções específicas.',
        'Análise avançada da produtividade:',
        'Medição precisa por setor.',
        'Avaliação individual dos colaboradores com base nos tempos estimados versus realizados.',
      ],
      expectedResults: {
        list: [
          'Produção totalmente integrada entre os setores;',
          'Redução de erros operacionais;',
          'Identificação clara de gargalos produtivos (setores ou indivíduos);',
          'Melhor aproveitamento dos recursos disponíveis (tempo, máquinas e materiais).',
        ],
      },
      footer:
        'O gerenciador foi projetado exclusivamente para empresas gráficas e de comunicação visual, oferecendo flexibilidade máxima sem complicações desnecessárias!',
    },
    features: eliteFeatures,
    videoUrl: 'https://youtu.be/Xr2Yxrsg2sw',
    featuresList: null,
    limits: {
      max_users: 20,
      max_companies: 1,
      trial_days: 0,
    },
  },

  FULL: {
    plan: {
      planType: 'FULL' as const,
      name: 'Full',
      description: '',
      basePrice: 0, // preço full
      additionalUserPrice: 1500,
      order: 5,
      isActive: false,
    },
    badge: {
      text: 'Em breve',
      variant: 'orangeLight',
    },
    concept: {
      description:
        'No ponto mais avançado da jornada, o foco é integrar todas as etapas anteriores para um gerenciamento completo e eficiente de estoque.',
      objective:
        'Garantir que o estoque seja gerido com precisão, evitando desperdícios e alinhando-o às demandas da produção.',
      mainActions: [
        'Entrada de materiais correta no sistema.',
        'Composição detalhada dos trabalhos, considerando aproveitamento e substituição de materiais na produção.',
        'Integração com o gerenciamento de produção para rastrear o uso real de materiais.',
        'Análise de custos estimados versus realizados, com ajustes nos processos para melhorias futuras.',
      ],
      expectedResults: {
        text: 'A empresa atinge excelência operacional, com controle total sobre custos, estoques e processos, resultando em mais eficiência e lucratividade.',
      },
    },
    features: fullFeatures,
    videoUrl: 'https://youtu.be/NkHw5AVLblg',
    featuresList: null,
    limits: {
      max_users: -1, // ilimitado
      max_companies: -1, // ilimitado
      trial_days: 0,
    },
  },
};

// Para compatibilidade com o código existente
export const BASE_PLANS = Object.values(PLAN_CONFIGURATIONS).map(
  (config) => config.plan,
);
