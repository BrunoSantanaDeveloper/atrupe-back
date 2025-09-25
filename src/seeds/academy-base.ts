// src/seeds/academy-base.ts

export interface AcademyItem {
  type: string[];
  section: string;
  description: string;
  order: number;
  files: string[];
  videoUrl: string;
  page: string | null;
  modal: string | null;
  buttonTitle: string;
}

export const ACADEMY_ITEMS: AcademyItem[] = [
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
