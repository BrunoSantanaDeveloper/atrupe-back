interface DimensionsType {
  largura?: number;
  altura?: number;
  duracao?: number;
}

interface ProductItemType {
  nome: string;
  unidadeMedida: string;
  nomeUnidadeMedida: string;
  dimensoes: DimensionsType | null;
  precoVenda: number;
}

interface ProductType {
  nome: string;
  codigo: string;
  setorNome: string;
  categoriaNome: string;
  permitirEditarValor: boolean;
  permitirEditarDescricao: boolean;
  etapasProducao: string[];
  produto: ProductItemType[];
}

export const BASE_PRODUCTS: ProductType[] = [
  {
    nome: 'Adesivo Blackout Impresso',
    codigo: 'ADBLK',
    setorNome: 'Impressão',
    categoriaNome: 'Adesivos',
    permitirEditarValor: true,
    permitirEditarDescricao: true,
    etapasProducao: ['Impressão'],
    produto: [
      {
        nome: 'Adesivo Blackout Impresso',
        unidadeMedida: 'M²',
        nomeUnidadeMedida: 'Metro Quadrado',
        dimensoes: {
          largura: 1,
          altura: 1,
        },
        precoVenda: 0,
      },
    ],
  },
  {
    nome: 'Adesivo Brilho Impresso',
    codigo: 'ADBRL',
    setorNome: 'Impressão',
    categoriaNome: 'Adesivos',
    permitirEditarValor: true,
    permitirEditarDescricao: true,
    etapasProducao: ['Impressão'],
    produto: [
      {
        nome: 'Adesivo Brilho Impresso',
        unidadeMedida: 'M²',
        nomeUnidadeMedida: 'Metro Quadrado',
        dimensoes: {
          largura: 1,
          altura: 1,
        },
        precoVenda: 0,
      },
    ],
  },
  {
    nome: 'Adesivo Fosco Impresso',
    codigo: 'ADFOS',
    setorNome: 'Impressão',
    categoriaNome: 'Adesivos',
    permitirEditarValor: true,
    permitirEditarDescricao: true,
    etapasProducao: ['Impressão'],
    produto: [
      {
        nome: 'Adesivo Fosco Impresso',
        unidadeMedida: 'M²',
        nomeUnidadeMedida: 'Metro Quadrado',
        dimensoes: {
          largura: 1,
          altura: 1,
        },
        precoVenda: 0,
      },
    ],
  },
  {
    nome: 'Adesivo Jateado',
    codigo: 'ADJAT',
    setorNome: 'Impressão',
    categoriaNome: 'Adesivos',
    permitirEditarValor: true,
    permitirEditarDescricao: true,
    etapasProducao: ['Impressão'],
    produto: [
      {
        nome: 'Adesivo Jateado',
        unidadeMedida: 'M²',
        nomeUnidadeMedida: 'Metro Quadrado',
        dimensoes: {
          largura: 1,
          altura: 1,
        },
        precoVenda: 0,
      },
    ],
  },
  {
    nome: 'Adesivo Perfurado',
    codigo: 'ADPER',
    setorNome: 'Impressão',
    categoriaNome: 'Adesivos',
    permitirEditarValor: true,
    permitirEditarDescricao: true,
    etapasProducao: ['Impressão'],
    produto: [
      {
        nome: 'Adesivo Perfurado',
        unidadeMedida: 'M²',
        nomeUnidadeMedida: 'Metro Quadrado',
        dimensoes: {
          largura: 1,
          altura: 1,
        },
        precoVenda: 0,
      },
    ],
  },
  {
    nome: 'Adesivo Recorte',
    codigo: 'ADREC',
    setorNome: 'Impressão',
    categoriaNome: 'Adesivos',
    permitirEditarValor: true,
    permitirEditarDescricao: true,
    etapasProducao: ['Impressão'],
    produto: [
      {
        nome: 'Adesivo Recorte',
        unidadeMedida: 'M²',
        nomeUnidadeMedida: 'Metro Quadrado',
        dimensoes: {
          largura: 1,
          altura: 1,
        },
        precoVenda: 0,
      },
    ],
  },
  {
    nome: 'Adesivo Refletivo',
    codigo: 'ADREF',
    setorNome: 'Impressão',
    categoriaNome: 'Adesivos',
    permitirEditarValor: true,
    permitirEditarDescricao: true,
    etapasProducao: ['Impressão'],
    produto: [
      {
        nome: 'Adesivo Refletivo',
        unidadeMedida: 'M²',
        nomeUnidadeMedida: 'Metro Quadrado',
        dimensoes: {
          largura: 1,
          altura: 1,
        },
        precoVenda: 0,
      },
    ],
  },
  {
    nome: 'Apostila',
    codigo: 'APOS',
    setorNome: 'Gráfica Rápida',
    categoriaNome: 'Papéis',
    permitirEditarValor: true,
    permitirEditarDescricao: true,
    etapasProducao: ['Produção'],
    produto: [
      {
        nome: 'Encadernação',
        unidadeMedida: 'UN',
        nomeUnidadeMedida: 'Unidade',
        dimensoes: null,
        precoVenda: 0,
      },
      {
        nome: 'Impressão A4 color',
        unidadeMedida: 'UN',
        nomeUnidadeMedida: 'Unidade',
        dimensoes: null,
        precoVenda: 0,
      },
    ],
  },
  {
    nome: 'Banner',
    codigo: 'BN001',
    setorNome: 'Impressão',
    categoriaNome: 'Lonas',
    permitirEditarValor: true,
    permitirEditarDescricao: true,
    etapasProducao: [],
    produto: [
      {
        nome: 'Banner',
        unidadeMedida: 'M²',
        nomeUnidadeMedida: 'Metro Quadrado',
        dimensoes: null,
        precoVenda: 0,
      },
    ],
  },
  {
    nome: 'Bolsa Ac Cristal 2mm A4',
    codigo: 'BACA4',
    setorNome: 'CNC',
    categoriaNome: 'Acrlicos',
    permitirEditarValor: true,
    permitirEditarDescricao: true,
    etapasProducao: [],
    produto: [
      {
        nome: 'Bolsa Ac Cristal 2mm A4',
        unidadeMedida: 'UN',
        nomeUnidadeMedida: 'Unidade',
        dimensoes: null,
        precoVenda: 0,
      },
    ],
  },
  {
    nome: 'Cavalete Ilhos',
    codigo: 'CAVIL',
    setorNome: 'Serralheria',
    categoriaNome: 'Estruturas',
    permitirEditarValor: true,
    permitirEditarDescricao: true,
    etapasProducao: ['Criação', 'Instalação', 'Serralheria', 'Impressão'],
    produto: [
      {
        nome: 'Cavalete Ilhos',
        unidadeMedida: 'M²',
        nomeUnidadeMedida: 'Metro Quadrado',
        dimensoes: {
          largura: 1,
          altura: 1,
        },
        precoVenda: 0,
      },
    ],
  },
  {
    nome: 'Criação',
    codigo: 'CRIAC',
    setorNome: 'Criação',
    categoriaNome: 'Serviço Criação',
    permitirEditarValor: true,
    permitirEditarDescricao: true,
    etapasProducao: ['Criação'],
    produto: [
      {
        nome: 'Criação',
        unidadeMedida: 'HH',
        nomeUnidadeMedida: 'Hora',
        dimensoes: {
          duracao: 0.3,
        },
        precoVenda: 0,
      },
    ],
  },
  {
    nome: 'Instalação ',
    codigo: 'INSTL',
    setorNome: 'Instalação',
    categoriaNome: 'Serviço Instalação',
    permitirEditarValor: true,
    permitirEditarDescricao: true,
    etapasProducao: ['Instalação'],
    produto: [
      {
        nome: 'Instalação',
        unidadeMedida: 'HH',
        nomeUnidadeMedida: 'Hora',
        dimensoes: null,
        precoVenda: 0,
      },
    ],
  },
  {
    nome: 'Letra Caixa Galvanizada',
    codigo: 'LTCXG',
    setorNome: 'Serralheria',
    categoriaNome: 'Estruturas',
    permitirEditarValor: true,
    permitirEditarDescricao: true,
    etapasProducao: [],
    produto: [
      {
        nome: 'Letra Caixa Galvanizada',
        unidadeMedida: 'M²',
        nomeUnidadeMedida: 'Metro Quadrado',
        dimensoes: {
          largura: 1,
          altura: 1,
        },
        precoVenda: 0,
      },
    ],
  },
  {
    nome: 'Letra Caixa Inox',
    codigo: 'LTCXI',
    setorNome: 'Serralheria',
    categoriaNome: 'Letra Caixa',
    permitirEditarValor: true,
    permitirEditarDescricao: true,
    etapasProducao: [],
    produto: [
      {
        nome: 'Letra Caixa Inox',
        unidadeMedida: 'M²',
        nomeUnidadeMedida: 'Metro Quadrado',
        dimensoes: {
          largura: 1,
          altura: 1,
        },
        precoVenda: 0,
      },
    ],
  },
  {
    nome: 'Letra Caixa PVC 10 mm',
    codigo: 'LTP10',
    setorNome: 'CNC',
    categoriaNome: 'PVC ',
    permitirEditarValor: true,
    permitirEditarDescricao: true,
    etapasProducao: [],
    produto: [
      {
        nome: 'Letra Caixa PVC 10 mm',
        unidadeMedida: 'M²',
        nomeUnidadeMedida: 'Metro Quadrado',
        dimensoes: {
          largura: 1,
          altura: 1,
        },
        precoVenda: 0,
      },
    ],
  },
  {
    nome: 'Letra Caixa PVC 20 mm',
    codigo: 'LTP20',
    setorNome: 'CNC',
    categoriaNome: 'PVC ',
    permitirEditarValor: true,
    permitirEditarDescricao: true,
    etapasProducao: [],
    produto: [
      {
        nome: 'Letra Caixa PVC 20 mm',
        unidadeMedida: 'M²',
        nomeUnidadeMedida: 'Metro Quadrado',
        dimensoes: {
          largura: 1,
          altura: 1,
        },
        precoVenda: 0,
      },
    ],
  },
  {
    nome: 'Letra Caixa PVC 5 mm',
    codigo: 'LTP05',
    setorNome: 'CNC',
    categoriaNome: 'PVC ',
    permitirEditarValor: true,
    permitirEditarDescricao: true,
    etapasProducao: [],
    produto: [
      {
        nome: 'Letra Caixa PVC 5 mm',
        unidadeMedida: 'M²',
        nomeUnidadeMedida: 'Metro Quadrado',
        dimensoes: {
          largura: 1,
          altura: 1,
        },
        precoVenda: 0,
      },
    ],
  },
  {
    nome: 'Lona Impressa',
    codigo: 'LONIM',
    setorNome: 'Impressão',
    categoriaNome: 'Lonas',
    permitirEditarValor: true,
    permitirEditarDescricao: true,
    etapasProducao: [],
    produto: [
      {
        nome: 'Lona Impressa',
        unidadeMedida: 'M²',
        nomeUnidadeMedida: 'Metro Quadrado',
        dimensoes: {
          largura: 1,
          altura: 1,
        },
        precoVenda: 0,
      },
    ],
  },
  {
    nome: 'Lona Impressa com Bainha e Ilhós',
    codigo: 'LOBIL',
    setorNome: 'Impressão',
    categoriaNome: 'Lonas',
    permitirEditarValor: true,
    permitirEditarDescricao: true,
    etapasProducao: ['Impressão', 'Produção'],
    produto: [
      {
        nome: 'Lona Impressa com Bainha e Ilhós',
        unidadeMedida: 'M²',
        nomeUnidadeMedida: 'Metro Quadrado',
        dimensoes: {
          largura: 1,
          altura: 1,
        },
        precoVenda: 0,
      },
    ],
  },
  {
    nome: 'Milheiro Cartão Visita',
    codigo: 'CARTV',
    setorNome: 'Gráfica Rápida',
    categoriaNome: 'Revenda Gráfica Rápida',
    permitirEditarValor: true,
    permitirEditarDescricao: true,
    etapasProducao: [],
    produto: [
      {
        nome: 'Milheiro Cartão Visita',
        unidadeMedida: 'UN',
        nomeUnidadeMedida: 'Unidade',
        dimensoes: null,
        precoVenda: 0,
      },
    ],
  },
  {
    nome: 'Painel ACM',
    codigo: 'PNACM',
    setorNome: 'Serralheria',
    categoriaNome: 'Estruturas',
    permitirEditarValor: true,
    permitirEditarDescricao: true,
    etapasProducao: [],
    produto: [
      {
        nome: 'Painel ACM',
        unidadeMedida: 'M²',
        nomeUnidadeMedida: 'Metro Quadrado',
        dimensoes: {
          largura: 1,
          altura: 1,
        },
        precoVenda: 0,
      },
    ],
  },
  {
    nome: 'Painel Back Light',
    codigo: 'PNBLH',
    setorNome: 'Serralheria',
    categoriaNome: 'Estruturas',
    permitirEditarValor: true,
    permitirEditarDescricao: true,
    etapasProducao: [],
    produto: [
      {
        nome: 'Painel Back Light',
        unidadeMedida: 'M²',
        nomeUnidadeMedida: 'Metro Quadrado',
        dimensoes: {
          largura: 1,
          altura: 1,
        },
        precoVenda: 0,
      },
    ],
  },
  {
    nome: 'Painel Front Light',
    codigo: 'PNFLH',
    setorNome: 'Serralheria',
    categoriaNome: 'Estruturas',
    permitirEditarValor: true,
    permitirEditarDescricao: true,
    etapasProducao: [],
    produto: [
      {
        nome: 'Painel Front Light',
        unidadeMedida: 'M²',
        nomeUnidadeMedida: 'Metro Quadrado',
        dimensoes: {
          largura: 1,
          altura: 1,
        },
        precoVenda: 0,
      },
    ],
  },
];

// Unidades de medida necessárias que podem não existir no sistema
export const BASE_UNITS_OF_MEASURE = [
  {
    name: 'Metro Quadrado',
    code: 'M²',
    description: 'Unidade de medida para área',
    kind: 'LENGTH',
  },
  {
    name: 'Unidade',
    code: 'UN',
    description: 'Unidade de medida para itens unitários',
    kind: null,
  },
  {
    name: 'Hora',
    code: 'HH',
    description: 'Unidade de medida para tempo em horas',
    kind: null,
  },
];

// Categorias necessárias que podem não existir no sistema
export const ADDITIONAL_CATEGORIES = [
  {
    name: 'Papéis',
    kind: 'PRODUCT',
    isActive: true,
    isStandard: false,
    sector: {
      name: 'Gráfica Rápida',
      icon: 'printer',
      isActive: true,
      kind: 'PRODUCTION',
      isProductionStage: true,
      isSystem: false,
    },
  },
  {
    name: 'Revenda Gráfica Rápida',
    kind: 'PRODUCT',
    isActive: true,
    isStandard: false,
    sector: {
      name: 'Gráfica Rápida',
      icon: 'printer',
      isActive: true,
      kind: 'PRODUCTION',
      isProductionStage: true,
      isSystem: false,
    },
  },
  {
    name: 'Letra Caixa',
    kind: 'PRODUCT',
    isActive: true,
    isStandard: false,
    sector: {
      name: 'Serralheria',
      icon: 'metalwork',
      isActive: true,
      kind: 'PRODUCTION',
      isProductionStage: true,
      isSystem: false,
    },
  },
];

// Setores necessários que podem não existir no sistema
export const ADDITIONAL_SECTORS = [
  {
    name: 'Gráfica Rápida',
    icon: 'printer',
    isActive: true,
    kind: 'PRODUCTION',
    isProductionStage: true,
    isSystem: false,
  },
];
