// src/seeds/academy-base.ts

export interface AcademyFile {
  url: string;
  name: string;
}

export interface AcademyItem {
  type: string[];
  section: string;
  title: string;
  description: string;
  order: number;
  files: AcademyFile[];
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
    title: 'Apresentação Atrupe Start',
    description:
      'Visão geral do Atrupe Start e dos primeiros passos para organizar a empresa.',
    order: 1,
    files: [
      {
        url: 'https://files-atrupe.s3.us-east-1.amazonaws.com/apresentacao_atrupe_start-ece6eb20-2ace-496a-8f2b-b07002af2e7b.pdf',
        name: 'Apresentação Atrupe Start',
      },
    ],
    videoUrl: 'https://vimeo.com/38382575',
    page: null,
    modal: null,
    buttonTitle: null,
  },

  // --- Empresa e Sistema ---
  {
    type: ['START'],
    section: 'Empresa e Sistema',
    title: 'Configurações da empresa',
    description: 'Cadastro das informações principais da empresa no sistema.',
    order: 2,
    files: [
      {
        url: 'https://files-atrupe.s3.us-east-1.amazonaws.com/configuracao_da_empresa_pg_7_a_9-6d775f53-3370-48e4-b32a-9e5c6e5b8d4a.pdf',
        name: 'Configuração da Empresa',
      },
    ],
    videoUrl: 'https://vimeo.com/1140143779',
    page: null,
    modal: 'CompanyConfigModal',
    buttonTitle: 'Configurações da empresa',
  },
  {
    type: ['START'],
    section: 'Empresa e Sistema',
    title: 'Setores',
    description: 'Criação e organização dos setores da empresa.',
    order: 3,
    files: [
      {
        url: 'https://files-atrupe.s3.us-east-1.amazonaws.com/setores-ee25e4dc-81d8-4883-b4b8-84142968abaa.pdf',
        name: 'Setores',
      },
    ],
    videoUrl: 'https://vimeo.com/1140144204',
    page: '/configuracoes/empresa-e-sistema/setores',
    modal: null,
    buttonTitle: 'Setores',
  },
  {
    type: ['START'],
    section: 'Empresa e Sistema',
    title: 'Padrão de medida',
    description:
      'Definição das unidades de medida usadas nos produtos e serviços.',
    order: 4,
    files: [
      {
        url: 'https://files-atrupe.s3.us-east-1.amazonaws.com/padroes_de_medida-bb5d2c64-3e33-49b6-9a73-47b0de630d4c.pdf',
        name: 'Padrões de Medida',
      },
    ],
    videoUrl: 'https://vimeo.com/1140147584',
    page: null,
    modal: 'UnitOfMeasureModal',
    buttonTitle: 'Padrão de medida',
  },
  {
    type: ['START'],
    section: 'Empresa e Sistema',
    title: 'Colaboradores e usuários',
    description:
      'Cadastro da equipe e definição dos níveis de acesso ao sistema.',
    order: 5,
    files: [
      {
        url: 'https://files-atrupe.s3.us-east-1.amazonaws.com/colaboradores_e_usuarios-26845085-879e-484b-a096-04f7613acd95.pdf',
        name: 'Colaboradores e Usuários',
      },
    ],
    videoUrl: 'https://vimeo.com/1140154101',
    page: '/configuracoes/empresa-e-sistema/colaboradores-e-usuarios',
    modal: null,
    buttonTitle: 'Colaboradores e usuários',
  },

  // --- Produtos ---
  {
    type: ['START'],
    section: 'Produtos',
    title: 'Produtos',
    description: 'Cadastro dos produtos e serviços comercializados.',
    order: 6,
    files: [
      {
        url: 'https://files-atrupe.s3.us-east-1.amazonaws.com/produtos-4d545f46-e5b3-4444-8a01-1354c16fbc4d.pdf',
        name: 'Produtos',
      },
    ],
    videoUrl: 'https://vimeo.com/38382575',
    page: '/configuracoes/produtos',
    modal: null,
    buttonTitle: 'Produtos',
  },

  // --- Cadastros ---
  {
    type: ['START'],
    section: 'Cadastros',
    title: 'Clientes',
    description:
      'Cadastro e organização dos clientes para orçamentos e vendas.',
    order: 7,
    files: [
      {
        url: 'https://files-atrupe.s3.us-east-1.amazonaws.com/clientes-b754a32a-301e-48db-a1fb-e2d2fc525d2f.pdf',
        name: 'Clientes',
      },
    ],
    videoUrl: 'https://vimeo.com/38382575',
    page: '/cadastros/clientes',
    modal: null,
    buttonTitle: 'Clientes',
  },
  {
    type: ['START'],
    section: 'Cadastros',
    title: 'Fornecedores',
    description:
      'Cadastro dos fornecedores para controle de compras e serviços.',
    order: 8,
    files: [
      {
        url: 'https://files-atrupe.s3.us-east-1.amazonaws.com/fornecedores-b8cc392c-4e43-4fb0-b6c6-1d4f39f67136.pdf',
        name: 'Fornecedores',
      },
    ],
    videoUrl: 'https://vimeo.com/38382575',
    page: '/cadastros/fornecedores',
    modal: null,
    buttonTitle: 'Fornecedores',
  },

  // --- Configurações / Vendas ---
  {
    type: ['START'],
    section: 'Configurações / Vendas',
    title: 'Série de vendas',
    description: 'Configuração da numeração e prazos padrões dos orçamentos.',
    order: 9,
    files: [
      {
        url: 'https://files-atrupe.s3.us-east-1.amazonaws.com/serie_de_vendas-6141765b-5096-44c8-a56c-4f22ed1196e8.pdf',
        name: 'Série de Vendas',
      },
    ],
    videoUrl: 'https://vimeo.com/38382575',
    page: '/configuracoes/vendas/series-de-venda',
    modal: null,
    buttonTitle: 'Série de vendas',
  },
  {
    type: ['START'],
    section: 'Configurações / Vendas',
    title: 'Perfil de vendedor',
    description: 'Definição de permissões e limites de atuação dos vendedores.',
    order: 10,
    files: [
      {
        url: 'https://files-atrupe.s3.us-east-1.amazonaws.com/perfil_de_vendedor-c104acdf-15a2-4d8c-8360-7a84e893180d.pdf',
        name: 'Perfil de Vendedor',
      },
    ],
    videoUrl: 'https://vimeo.com/38382575',
    page: '/configuracoes/vendas/perfil-de-vendedor',
    modal: null,
    buttonTitle: 'Perfil de vendedor',
  },

  // --- Vendas ---
  {
    type: ['START'],
    section: 'Vendas',
    title: 'Orçamentos',
    description: 'Criação, envio e acompanhamento dos orçamentos.',
    order: 11,
    files: [
      {
        url: 'https://files-atrupe.s3.us-east-1.amazonaws.com/orcamento-8732b22b-ce57-4d8a-b001-6375100295ff.pdf',
        name: 'Orçamentos',
      },
    ],
    videoUrl: 'https://vimeo.com/38382575',
    page: '/vendas/orcamentos',
    modal: null,
    buttonTitle: 'Orçamentos',
  },
  {
    type: ['START'],
    section: 'Vendas',
    title: 'Boas práticas em orçamentos',
    description: 'Acompanhamento de oportunidades de venda.',
    order: 12,
    files: [
      {
        url: 'https://files-atrupe.s3.us-east-1.amazonaws.com/boas_praticas_orcamento-1b0a9eb5-31a0-4727-b99c-f467079c07e5.pdf',
        name: 'Boas Práticas de Orçamento',
      },
    ],
    videoUrl: 'https://vimeo.com/38382575',
    page: null,
    modal: null,
    buttonTitle: null,
  },
  {
    type: ['START'],
    section: 'Vendas',
    title: 'Ordens de serviço',
    description:
      'Geração das ordens de produção a partir dos orçamentos aprovados.',
    order: 13,
    files: [
      {
        url: 'https://files-atrupe.s3.us-east-1.amazonaws.com/ordens_de_servico-628390c9-1678-43cb-bd5e-51ff7514d4d9.pdf',
        name: 'Ordens de Serviço',
      },
    ],
    videoUrl: 'https://vimeo.com/38382575',
    page: '/vendas/ordens-de-servico',
    modal: null,
    buttonTitle: 'Ordens de serviço',
  },

  // --- Configurações / Financeiro ---
  {
    type: ['START'],
    section: 'Configurações / Financeiro',
    title: 'Configuração de bancos e contas',
    description: 'Definição das formas de pagamento utilizadas nas vendas.',
    order: 14,
    files: [
      {
        url: 'https://files-atrupe.s3.us-east-1.amazonaws.com/configuracao_de_bancos_e_contas-b0e7058c-7db3-4405-b180-6b7575d9efaa.pdf',
        name: 'Configuração de Bancos e Contas',
      },
    ],
    videoUrl: 'https://vimeo.com/38382575',
    page: '/configuracoes/financeiro/contas-bancarias',
    modal: null,
    buttonTitle: 'Configuração de bancos e contas',
  },
  {
    type: ['START'],
    section: 'Configurações / Financeiro',
    title: 'Configuração de pagamentos',
    description: 'Definição das formas de pagamento utilizadas nas vendas.',
    order: 15,
    files: [
      {
        url: 'https://files-atrupe.s3.us-east-1.amazonaws.com/configuracao_de_pagamento-c39f1f98-880d-4cc9-953c-5fd69f615210.pdf',
        name: 'Configuração de Pagamentos',
      },
    ],
    videoUrl: 'https://vimeo.com/38382575',
    page: '/configuracoes/financeiro/configuracoes-de-pagamento/condicoes-de-pagamento',
    modal: null,
    buttonTitle: 'Configuração de pagamentos',
  },
  {
    type: ['START'],
    section: 'Configurações / Financeiro',
    title: 'Configuração do plano de contas',
    description: 'Configure ou crie novas formas de pagamento para a empresa.',
    order: 16,
    files: [
      {
        url: 'https://files-atrupe.s3.us-east-1.amazonaws.com/configuracao_do_plano_de_contas-80bccb62-3c98-428d-86da-07a5bc509900.pdf',
        name: 'Configuração do Plano de Contas',
      },
    ],
    videoUrl: 'https://vimeo.com/38382575',
    page: '/configuracoes/financeiro/plano-de-contas',
    modal: null,
    buttonTitle: 'Configuração do plano de contas',
  },
  {
    type: ['START'],
    section: 'Configurações / Financeiro',
    title: 'Cadastro das despesas fixas',
    description: 'Registro das despesas fixas da empresa.',
    order: 17,
    files: [
      {
        url: 'https://files-atrupe.s3.us-east-1.amazonaws.com/cadastro_das_despesas_fixas-26ef1eb1-f514-4624-8cae-2c521bd744b7.pdf',
        name: 'Cadastro das Despesas Fixas',
      },
    ],
    videoUrl: 'https://vimeo.com/38382575',
    page: '/configuracoes/financeiro/config-despesas-fixas',
    modal: null,
    buttonTitle: 'Cadastro das despesas fixas',
  },
  {
    type: ['START'],
    section: 'Configurações / Financeiro',
    title: 'Configuração da folha de pagamento',
    description: 'Definição da estrutura básica da folha de pagamento.',
    order: 18,
    files: [
      {
        url: 'https://files-atrupe.s3.us-east-1.amazonaws.com/configuracao_da_folha_de_pagamento-cd52de13-2856-4a30-ae51-6cc3d26ce42b.pdf',
        name: 'Configuração da Folha de Pagamento',
      },
    ],
    videoUrl: 'https://vimeo.com/38382575',
    page: '/configuracoes/financeiro/folhas-de-pagamento',
    modal: null,
    buttonTitle: 'Configuração da folha de pagamento',
  },

  // --- Financeiro ---
  {
    type: ['START'],
    section: 'Financeiro',
    title: 'Fluxo financeiro',
    description: 'Acompanhamento das entradas e saídas financeiras.',
    order: 19,
    files: [],
    videoUrl: 'https://vimeo.com/38382575',
    page: '/financeiro/fluxo-financeiro',
    modal: null,
    buttonTitle: 'Fluxo financeiro',
  },
  {
    type: ['START'],
    section: 'Financeiro',
    title: 'Despesas fixas',
    description: 'Controle mensal dos custos fixos da operação.',
    order: 20,
    files: [],
    videoUrl: 'https://vimeo.com/38382575',
    page: '/financeiro/despesas-fixas',
    modal: null,
    buttonTitle: 'Despesas fixas',
  },
  {
    type: ['START'],
    section: 'Financeiro',
    title: 'Folha de pagamento',
    description: 'Gestão dos gastos com colaboradores.',
    order: 21,
    files: [],
    videoUrl: 'https://vimeo.com/38382575',
    page: '/financeiro/folha-de-pagamento',
    modal: null,
    buttonTitle: 'Folha de pagamento',
  },

  // --- Relatórios ---
  {
    type: ['START'],
    section: 'Relatórios',
    title: 'Relatórios',
    description:
      'Acesse relatórios completos sobre vendas, financeiro, estoque e desempenho da sua empresa.',
    order: 22,
    files: [],
    videoUrl: 'https://vimeo.com/38382575',
    page: null,
    modal: null,
    buttonTitle: null,
  },
];
