// src/seeds/academy-base.ts

export interface AcademyItem {
  type: string[];
  section: string;
  description: string;
  order: number;
  files: string[];
  videoUrl: string;
  page?: string | null;
  modal?: string | null;
  buttonTitle?: string;
}

export const ACADEMY_ITEMS: AcademyItem[] = [
  // ========================================
  // ATRUPE START
  // ========================================

  // --- Apresentação Atrupe Start ---
  {
    type: ['START'],
    section: 'Apresentação Atrupe Start',
    description:
      'Bem-vindo à Atrupe! Assista a este vídeo para uma introdução completa ao sistema e suas funcionalidades.',
    order: 1,
    files: [
      'https://files-atrupe.s3.us-east-1.amazonaws.com/apresentacao_atrupe_start-ece6eb20-2ace-496a-8f2b-b07002af2e7b.pdf',
      'https://files-atrupe.s3.us-east-1.amazonaws.com/atrupe_academy_start-35b123aa-c87f-437b-8f14-5ad20967c89d.pdf',
    ],
    videoUrl: '',
  },

  // --- Empresa e Sistema ---
  {
    type: ['START'],
    section: 'Empresa e Sistema',
    description:
      'Configure os dados essenciais da sua empresa no sistema Atrupe.',
    order: 2,
    files: [
      'https://files-atrupe.s3.us-east-1.amazonaws.com/configuracao_da_empresa_pg_7_a_9-6d775f53-3370-48e4-b32a-9e5c6e5b8d4a.pdf',
    ],
    videoUrl: '',
    page: null,
    modal: 'CompanyConfigModal',
    buttonTitle: 'Configurações da empresa',
  },
  {
    type: ['START'],
    section: 'Empresa e Sistema',
    description:
      'Defina os setores da sua empresa para organizar melhor suas operações.',
    order: 3,
    files: [
      'https://files-atrupe.s3.us-east-1.amazonaws.com/setores-ee25e4dc-81d8-4883-b4b8-84142968abaa.pdf',
    ],
    videoUrl: '',
    page: null,
    modal: 'SectorsModal',
    buttonTitle: 'Setores',
  },
  {
    type: ['START'],
    section: 'Empresa e Sistema',
    description:
      'Configure os padrões de unidades de medida utilizados pela sua empresa para os produtos.',
    order: 4,
    files: [
      'https://files-atrupe.s3.us-east-1.amazonaws.com/padroes_de_medida-bb5d2c64-3e33-49b6-9a73-47b0de630d4c.pdf',
    ],
    videoUrl: 'https://vimeo.com/1140147584',
    page: '/configuracoes/medidas',
    modal: null,
    buttonTitle: 'Padrão de medida',
  },
  {
    type: ['START'],
    section: 'Empresa e Sistema',
    description:
      'Adicione e gerencie os colaboradores que terão acesso ao sistema, definindo seus perfis e permissões.',
    order: 5,
    files: [
      'https://files-atrupe.s3.us-east-1.amazonaws.com/colaboradores_e_usuarios-26845085-879e-484b-a096-04f7613acd95.pdf',
    ],
    videoUrl: 'https://vimeo.com/1140154101',
    page: '/configuracoes/colaboradores',
    modal: null,
    buttonTitle: 'Colaboradores e usuários',
  },

  // --- Produtos ---
  {
    type: ['START'],
    section: 'Produtos',
    description:
      'Gerencie seus produtos: cadastre novos itens, edite os existentes e organize seu catálogo.',
    order: 6,
    files: [
      'https://files-atrupe.s3.us-east-1.amazonaws.com/produtos-4d545f46-e5b3-4444-8a01-1354c16fbc4d.pdf',
    ],
    videoUrl: '',
    page: '/produtos',
    modal: null,
    buttonTitle: 'Produtos',
  },

  // --- Cadastros ---
  {
    type: ['START'],
    section: 'Cadastros',
    description:
      'Cadastre e gerencie seus clientes para facilitar o processo de vendas e atendimento.',
    order: 7,
    files: [
      'https://files-atrupe.s3.us-east-1.amazonaws.com/clientes-b754a32a-301e-48db-a1fb-e2d2fc525d2f.pdf',
    ],
    videoUrl: '',
    page: '/clientes',
    modal: null,
    buttonTitle: 'Clientes',
  },
  {
    type: ['START'],
    section: 'Cadastros',
    description:
      'Cadastre e gerencie seus fornecedores para controlar melhor suas compras e estoque.',
    order: 8,
    files: [
      'https://files-atrupe.s3.us-east-1.amazonaws.com/fornecedores-b8cc392c-4e43-4fb0-b6c6-1d4f39f67136.pdf',
    ],
    videoUrl: '',
    page: '/fornecedores',
    modal: null,
    buttonTitle: 'Fornecedores',
  },

  // --- Configurações / Vendas ---
  {
    type: ['START'],
    section: 'Configurações / Vendas',
    description:
      'Configure as séries de vendas para organizar e numerar seus documentos de vendas (orçamentos, pedidos, notas fiscais).',
    order: 9,
    files: [
      'https://files-atrupe.s3.us-east-1.amazonaws.com/serie_de_vendas-6141765b-5096-44c8-a56c-4f22ed1196e8.pdf',
    ],
    videoUrl: '',
    page: null,
    modal: 'SalesSeriesModal',
    buttonTitle: 'Série de vendas',
  },
  {
    type: ['START'],
    section: 'Configurações / Vendas',
    description:
      'Defina os perfis de vendedor para estabelecer permissões, metas e comissões da equipe de vendas.',
    order: 10,
    files: [
      'https://files-atrupe.s3.us-east-1.amazonaws.com/perfil_de_vendedor-c104acdf-15a2-4d8c-8360-7a84e893180d.pdf',
    ],
    videoUrl: '',
    page: null,
    modal: 'SalesProfileModal',
    buttonTitle: 'Perfil de vendedor',
  },

  // --- Vendas ---
  {
    type: ['START'],
    section: 'Vendas',
    description:
      'Aprenda a criar e gerenciar orçamentos para seus clientes de forma eficiente.',
    order: 11,
    files: [
      'https://files-atrupe.s3.us-east-1.amazonaws.com/orcamento-8732b22b-ce57-4d8a-b001-6375100295ff.pdf',
    ],
    videoUrl: '',
    page: '/vendas/orcamentos',
    modal: null,
    buttonTitle: 'Orçamentos',
  },
  {
    type: ['START'],
    section: 'Vendas',
    description:
      'Conheça as melhores práticas para criar orçamentos assertivos e aumentar suas conversões em vendas.',
    order: 12,
    files: [
      'https://files-atrupe.s3.us-east-1.amazonaws.com/boas_praticas_orcamento-1b0a9eb5-31a0-4727-b99c-f467079c07e5.pdf',
    ],
    videoUrl: '',
    page: '/academy/start/boas-praticas-orcamentos',
    modal: null,
    buttonTitle: 'Boas práticas orçamentos',
  },
  {
    type: ['START'],
    section: 'Vendas',
    description:
      'Gerencie ordens de serviço para controlar a execução de serviços e manutenções.',
    order: 13,
    files: [
      'https://files-atrupe.s3.us-east-1.amazonaws.com/ordens_de_servico-628390c9-1678-43cb-bd5e-51ff7514d4d9.pdf',
    ],
    videoUrl: '',
    page: '/vendas/ordens-servico',
    modal: null,
    buttonTitle: 'Ordens de serviço',
  },

  // --- Configurações / Financeiro ---
  {
    type: ['START'],
    section: 'Configurações / Financeiro',
    description:
      'Configure as contas bancárias da sua empresa para controle financeiro.',
    order: 14,
    files: [
      'https://files-atrupe.s3.us-east-1.amazonaws.com/configuracao_de_bancos_e_contas-b0e7058c-7db3-4405-b180-6b7575d9efaa.pdf',
    ],
    videoUrl: '',
    page: null,
    modal: 'BankAccountsModal',
    buttonTitle: 'Configuração de bancos e contas',
  },
  {
    type: ['START'],
    section: 'Configurações / Financeiro',
    description:
      'Defina as formas de pagamento aceitas pela sua empresa (dinheiro, cartão, PIX, boleto, etc).',
    order: 15,
    files: [
      'https://files-atrupe.s3.us-east-1.amazonaws.com/configuracao_de_pagamento-c39f1f98-880d-4cc9-953c-5fd69f615210.pdf',
    ],
    videoUrl: '',
    page: null,
    modal: 'PaymentMethodsModal',
    buttonTitle: 'Configuração de pagamentos',
  },
  {
    type: ['START'],
    section: 'Configurações / Financeiro',
    description:
      'Configure o plano de contas para categorizar receitas e despesas da sua empresa.',
    order: 16,
    files: [
      'https://files-atrupe.s3.us-east-1.amazonaws.com/configuracao_do_plano_de_contas-80bccb62-3c98-428d-86da-07a5bc509900.pdf',
    ],
    videoUrl: '',
    page: null,
    modal: 'ChartOfAccountsModal',
    buttonTitle: 'Configuração do plano de contas',
  },
  {
    type: ['START'],
    section: 'Configurações / Financeiro',
    description:
      'Cadastre as despesas fixas mensais da sua empresa (aluguel, energia, internet, etc).',
    order: 17,
    files: [
      'https://files-atrupe.s3.us-east-1.amazonaws.com/cadastro_das_despesas_fixas-26ef1eb1-f514-4624-8cae-2c521bd744b7.pdf',
    ],
    videoUrl: '',
    page: null,
    modal: 'FixedExpensesModal',
    buttonTitle: 'Cadastro das despesas fixas',
  },
  {
    type: ['START'],
    section: 'Configurações / Financeiro',
    description:
      'Configure os parâmetros da folha de pagamento para gerenciar salários e encargos dos colaboradores.',
    order: 18,
    files: [
      'https://files-atrupe.s3.us-east-1.amazonaws.com/configuracao_da_folha_de_pagamento-cd52de13-2856-4a30-ae51-6cc3d26ce42b.pdf',
    ],
    videoUrl: '',
    page: null,
    modal: 'PayrollConfigModal',
    buttonTitle: 'Configuração da folha de pagamento',
  },

  // --- Financeiro ---
  {
    type: ['START'],
    section: 'Financeiro',
    description:
      'Acompanhe o fluxo financeiro da sua empresa: receitas, despesas e saldo disponível.',
    order: 19,
    files: [],
    videoUrl: '',
    page: '/financeiro/fluxo',
    modal: null,
    buttonTitle: 'Fluxo financeiro',
  },
  {
    type: ['START'],
    section: 'Financeiro',
    description:
      'Gerencie e acompanhe as despesas fixas cadastradas da sua empresa.',
    order: 20,
    files: [],
    videoUrl: '',
    page: '/financeiro/despesas-fixas',
    modal: null,
    buttonTitle: 'Despesas fixas',
  },
  {
    type: ['START'],
    section: 'Financeiro',
    description:
      'Acesse e gerencie a folha de pagamento dos colaboradores da sua empresa.',
    order: 21,
    files: [],
    videoUrl: '',
    page: '/financeiro/folha-pagamento',
    modal: null,
    buttonTitle: 'Folha de pagamento',
  },

  // --- Relatórios ---
  {
    type: ['START'],
    section: 'Relatórios',
    description:
      'Acesse relatórios completos sobre vendas, financeiro, estoque e desempenho da sua empresa.',
    order: 22,
    files: [],
    videoUrl: '',
    page: '/relatorios',
    modal: null,
    buttonTitle: 'Relatórios',
  },
];
