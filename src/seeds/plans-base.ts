export const BASE_PLANS = [
  {
    planType: 'TRIAL' as const,
    name: 'Trial',
    description:
      'Plano de avaliação gratuito com funcionalidades limitadas para testar o sistema por um período determinado.\n\nIncluído no Trial:\n- Até 3 usuários\n- Funcionalidades básicas\n- Acesso limitado por 7 dias\n- Suporte básico\n\nPerfeito para conhecer o sistema antes de escolher um plano pago.',
    basePrice: 0.0,
    additionalAccessPrice: 0.0,
    modules: ['basic'],
  },
  {
    planType: 'START' as const,
    name: 'Start',
    description:
      'Conceito:\nNa jornada da excelência, tudo começa com a organização e estruturação das informações. Esse ponto de partida cria as bases para que o negócio avance de forma organizada e profissional.\n\nObjetivo:\nDigitalizar e estruturar as informações principais, garantindo um início profissional e funcional.\n\nPrincipais Ações:\n- Cadastro de clientes, fornecedores, colaboradores e produtos.\n- Organização financeira básica: plano de contas, despesas fixas, folha de pagamento e receitas.\n- Implementação de um sistema simples para emissão de pedidos, controle financeiro básico e aparência profissional.\n\nResultados Esperados:\nA empresa sai do improviso, garantindo que nenhum trabalho seja esquecido, com informações organizadas e uma imagem mais profissional.',
    basePrice: 115.0,
    additionalAccessPrice: 15.0,
    modules: ['basic'],
  },
  {
    planType: 'LITE' as const,
    name: 'Lite',
    description:
      'Conceito:\nCom as bases lançadas na Etapa Start, o próximo passo é fortalecer a estabilidade financeira e comercial do negócio por meio de ferramentas mais robustas.\n\nObjetivo:\nAprofundar o controle financeiro da empresa enquanto integra informações comerciais (CRM) para facilitar tomadas de decisão estratégicas.\n\nPrincipais Ações:\n- Cadastro de produtos com composições básicas.\n- Controle financeiro avançado:\n  - Separação por contas bancárias.\n  - Definição de limites de crédito para clientes.\n  - Opção para repasse automático das taxas financeiras.\n- Introdução ao CRM (Gestão Comercial):\n  - Status das negociações em andamento.\n  - Motivos dos cancelamentos registrados no sistema.\n  - Histórico completo dos clientes.\n\nResultados Esperados:\nA empresa ganha previsibilidade financeira:\n- Redução significativa nas perdas financeiras;\n- Melhor controle sobre vendas/compras;\n- Decisões comerciais mais assertivas graças ao CRM integrado.\n\nObservação:\nAs informações cadastradas aqui evoluem diretamente pra próxima etapa — sem retrabalho!',
    basePrice: 230.0,
    additionalAccessPrice: 20.0,
    modules: ['basic', 'crm'],
  },
  {
    planType: 'PRO' as const,
    name: 'Pro',
    description:
      'Conceito:\nEssa é a grande virada! Com a estabilidade financeira consolidada, é hora de aprofundar o conhecimento sobre custos e estruturar os processos para maior eficiência.\n\nObjetivo:\nCompreender os custos reais e criar padrões para processos e orçamentos.\n\nPrincipais Ações:\n- Cadastro detalhado de custos: mão de obra, materiais e equipamentos.\n- Identificação de trabalhos mais lucrativos e eliminação de serviços deficitários.\n- Padronização de processos de trabalho, criando fluxos claros para orçamentos e produção.\n- Delegação de funções antes centralizadas no dono da empresa baseada nesses processos.\n\nResultados Esperados:\nA empresa ganha clareza sobre sua operação, reduz sua linha de produtos para focar no que é mais lucrativo e padroniza processos, diminuindo a dependência exclusiva do dono.',
    basePrice: 299.9,
    additionalAccessPrice: 25.0,
    modules: ['basic', 'crm', 'advanced_reports'],
  },
  {
    planType: 'ELITE' as const,
    name: 'Elite',
    description:
      'Conceito:\nNesta etapa, a empresa passa a contar com um gerenciador de produção exclusivo, desenvolvido para atender às necessidades específicas de empresas de comunicação visual e gráficas.\n\nEle utiliza as composições criadas na Etapa 3 (máquinas, materiais e mão-de-obra) para organizar e monitorar todo o fluxo produtivo.\n\nO grande diferencial desse gerenciador é sua capacidade de se adaptar à estrutura única de cada empresa — seja por setores ou fluxos personalizados — além de permitir análises detalhadas da produtividade por setor e por colaborador.\n\nObjetivo:\nIntegrar todos os setores ao sistema, garantindo um gerenciamento eficiente da produção com base em dados reais.\n\nPrincipais Ações:\n- Implementação do gerenciador de produção;\n- Adaptável à estrutura específica da empresa;\n- Baseado nas composições detalhadas dos produtos criadas na Etapa 3;\n- Treinamento direcionado;\n- Cada setor aprende como usar o sistema dentro das suas funções específicas;\n- Análise avançada da produtividade;\n- Medição precisa por setor;\n- Avaliação individual dos colaboradores com base nos tempos estimados versus realizados.\n\nResultados Esperados:\n- Produção totalmente integrada entre os setores;\n- Redução de erros operacionais;\n- Identificação clara de gargalos produtivos (setores ou indivíduos);\n- Melhor aproveitamento dos recursos disponíveis (tempo, máquinas e materiais).\n\nO gerenciador foi projetado exclusivamente para empresas gráficas e de comunicação visual, oferecendo flexibilidade máxima sem complicações desnecessárias!',
    basePrice: 399.9,
    additionalAccessPrice: 30.0,
    modules: ['basic', 'crm', 'advanced_reports', 'production_manager'],
  },
  {
    planType: 'FULL' as const,
    name: 'Full',
    description:
      'Conceito:\nNo ponto mais avançado da jornada, o foco é integrar todas as etapas anteriores para um gerenciamento completo e eficiente de estoque.\n\nObjetivo:\nGarantir que o estoque seja gerido com precisão, evitando desperdícios e alinhando-o às demandas da produção.\n\nPrincipais Ações:\n- Entrada de materiais correta no sistema.\n- Composição detalhada dos trabalhos, considerando aproveitamento e substituição de materiais na produção.\n- Integração com o gerenciamento de produção para rastrear o uso real de materiais.\n- Análise de custos estimados versus realizados, com ajustes nos processos para melhorias futuras.\n\nResultados Esperados:\nA empresa atinge excelência operacional, com controle total sobre custos, estoques e processos, resultando em mais eficiência e lucratividade.',
    basePrice: 499.9,
    additionalAccessPrice: 35.0,
    modules: [
      'basic',
      'crm',
      'advanced_reports',
      'production_manager',
      'inventory_management',
    ],
  },
];

export const BASE_MODULES = [
  {
    name: 'basic',
    description: 'Módulo básico com funcionalidades essenciais',
    price: 0.0,
  },
  {
    name: 'crm',
    description: 'Módulo de CRM para gestão comercial',
    price: 50.0,
  },
  {
    name: 'advanced_reports',
    description: 'Relatórios avançados e análises detalhadas',
    price: 75.0,
  },
  {
    name: 'production_manager',
    description: 'Gerenciador de produção exclusivo',
    price: 100.0,
  },
  {
    name: 'inventory_management',
    description: 'Gestão completa de estoque',
    price: 125.0,
  },
];
