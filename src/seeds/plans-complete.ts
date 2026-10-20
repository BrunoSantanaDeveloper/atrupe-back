/**
 * Composição PADRÃO de cada plano ("padrão de fábrica").
 *
 * Desde 29/09/2026 a composição real mora no banco (`plan_features` e
 * `plan_limits`) e é o superadmin quem a altera, em Super Admin › Sistema ›
 * Planos. O seed só CRIA o que falta — uma chave nova listada aqui entra
 * ligada no próximo deploy —, nunca desliga nem sobrescreve o que o painel
 * decidiu. Estas listas também são o alvo do "Restaurar padrão" do painel.
 */
// Faturar na entrega acompanha a Agenda de entrega, aberta no Start (PO,
// 14/10/2026); faturar na frente de caixa continua pedindo a frente de caixa.
const startFeatures = [
  'sectors_configuration',
  'can_bill_on_delivery_and_checkout',
];

const liteFeatures = [
  ...startFeatures,
  'pdf_show_item_details',
  'service_order_current_phase',
  'quotation_quick_sale',
  'quotation_rejection_reasons',
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
  'client_responsible_management',
  'bank_account_delete',
  'bank_account_provision',
  'payment_difference',
  'multiple_companies',
  'transaction_cancel_reasons',
  'credit_limit_enforcement',
  // Papéis e contagem de folhas, sem custo (PO, 13/10/2026)
  'paper_register',
];

// Cada plano tem tudo o que o anterior tem (regra cumulativa, 10/10/2026).
const proFeatures = [...liteFeatures, 'cost_base', 'pricing_center'];

const eliteFeatures = [
  ...proFeatures,
  'production_manager',
  'productivity_tracking',
];

const fullFeatures = [...eliteFeatures, 'stock_control', 'invoice_entry'];

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
    // O teste gratuito começa com o que o Start tem; o superadmin pode
    // incluir outros recursos na coluna Trial da matriz.
    features: startFeatures,
    videoUrl: null,
    featuresList: null,
    // O Trial não aparece na trilha de contratação.
    presentation: null,
    limits: {
      max_users: 3,
      max_companies: 1,
      trial_days: 7, // 7 dias de teste trial
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
    features: startFeatures,
    videoUrl: 'https://youtu.be/kGTQD84QJ1U',
    // Card do plano na trilha de contratação (editável no painel de planos).
    presentation: {
      pitch: 'Para quem precisa sair do improviso.',
      actions: [
        'Cadastro inicial de clientes, fornecedores, colaboradores e produtos',
        'Organização financeira básica',
        'Criação do plano de contas',
        'Controle de despesas, folha de pagamento e receitas',
        'Vendas realizadas',
        'Orçamentos enviados',
        'Pagamentos recebidos/pendências financeiras',
      ],
    },
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
      // Estado inicial na criação. A ativação para contratação é feita pelo
      // SystemAdmin no painel de planos (não é sobrescrita em re-seeds).
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
    // Card do plano na trilha de contratação (editável no painel de planos).
    presentation: {
      pitch: 'Para quem quer previsibilidade financeira.',
      actions: [
        'Cadastro de produtos com composições básicas',
        'Controle financeiro avançado',
        'Separação por contas bancárias',
        'Definição de limites de crédito para clientes',
        'Opção para repasse automático das taxas financeiras',
        'Introdução ao CRM (Gestão Comercial)',
        'Status das negociações em andamento',
        'Motivos dos cancelamentos registrados no sistema',
        'Gerenciador de Produção e Entrega',
        'Histórico completo dos clientes',
      ],
    },
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
        items: [
          'Orçamentos',
          'Ordens de serviço',
          'Venda rápida',
          'Status de orçamento personalizados',
          'Coluna de status nos orçamentos',
          'Motivos de rejeição e cancelamento',
          'Detalhes de itens no PDF',
        ],
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
          'Contas a receber',
          'Contas a pagar',
          'Controle de caixa',
          'Frente de caixa (PDV)',
          'Contas bancárias',
          'Limite de crédito de clientes',
          'Repasse de taxa da operadora',
          'Diferença de pagamento',
        ],
        videoUrl: '',
      },
      {
        title: 'Produtos',
        items: ['Produtos com composição', 'Etapas de produção nos produtos'],
        videoUrl: '',
      },
      {
        title: 'Produção',
        items: [
          'Agenda de entrega com abas de produção',
          'Etapas de produção na agenda',
          'Fase atual nas ordens de serviço',
        ],
        videoUrl: '',
      },
      {
        title: 'Cadastros',
        items: ['Clientes (Completo)', 'Fornecedores (Completo)'],
        videoUrl: '',
      },
    ],
    // 3 usuários em todos os planos (10/10/2026); mais que isso, só com
    // usuários adicionais.
    limits: {
      max_users: 3,
      max_companies: 1,
      trial_days: 0,
    },
  },

  PRO: {
    plan: {
      planType: 'PRO' as const,
      name: 'Pro',
      description: '',
      // Valores do protótipo. O plano segue desabilitado (isActive: false):
      // o seed não sobrescreve a disponibilidade, que é do admin do sistema.
      basePrice: 37000, // preço pro
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
    // Card do plano na trilha de contratação (editável no painel de planos).
    presentation: {
      pitch: 'Para quem precisa conhecer os custos.',
      actions: [
        'Cadastro detalhado de custos: mão de obra, materiais e equipamentos',
        'Identificação de trabalhos mais lucrativos e eliminação de serviços deficitários',
        'Padronização de processos de trabalho, criando fluxos claros para orçamentos e produção',
        'Delegação de funções antes centralizadas no dono da empresa baseada nesses processos',
      ],
    },
    featuresList: null,
    limits: {
      max_users: 3,
      max_companies: 1,
      trial_days: 0,
    },
  },

  ELITE: {
    plan: {
      planType: 'ELITE' as const,
      name: 'Elite',
      description: '',
      basePrice: 59000, // preço elite (valor do protótipo; plano desabilitado)
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
    // Card do plano na trilha de contratação (editável no painel de planos).
    presentation: {
      pitch: 'Para quem precisa integrar a produção.',
      actions: [
        'Implementação do gerenciador de produção, adaptável à estrutura específica da empresa',
        'Gerenciador baseado nas composições detalhadas dos produtos criadas na Etapa 3',
        'Treinamento direcionado: cada setor aprende como usar o sistema dentro das suas funções específicas',
        'Análise avançada da produtividade, com medição precisa por setor',
        'Avaliação individual dos colaboradores com base nos tempos estimados versus realizados',
      ],
    },
    featuresList: null,
    limits: {
      max_users: 3,
      max_companies: 1,
      trial_days: 0,
    },
  },

  FULL: {
    plan: {
      planType: 'FULL' as const,
      name: 'Full',
      description: '',
      basePrice: 89000, // preço full (valor do protótipo; plano desabilitado)
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
    // Card do plano na trilha de contratação (editável no painel de planos).
    presentation: {
      pitch: 'Para quem quer controlar o estoque.',
      actions: [
        'Entrada de materiais correta no sistema',
        'Composição detalhada dos trabalhos, considerando aproveitamento e substituição de materiais na produção',
        'Integração com o gerenciamento de produção para rastrear o uso real de materiais',
        'Análise de custos estimados versus realizados, com ajustes nos processos para melhorias futuras',
      ],
    },
    featuresList: null,
    limits: {
      max_users: 3,
      max_companies: -1, // ilimitado
      trial_days: 0,
    },
  },
};

// Para compatibilidade com o código existente
export const BASE_PLANS = Object.values(PLAN_CONFIGURATIONS).map(
  (config) => config.plan,
);
