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
  precoVenda?: number;
  precoUnitario?: number;
}

interface ProductType {
  nome: string;
  codigo: string;
  setorNome: string;
  categoriaNome: string;
  permitirEditarValor?: boolean;
  permitirEditarDescricao?: boolean;
  etapasProducao: string[];
  produto: ProductItemType[];
}

export const BASE_PRODUCTS: ProductType[] = [
  {
    nome: 'Adesivo Blackout Impresso',
    codigo: 'ADBLK',
    setorNome: 'Impressão',
    categoriaNome: 'Adesivos',
    etapasProducao: ['Impressão'],
    produto: [
      {
        nome: 'Adesivo Blackout Impresso',
        unidadeMedida: 'M2',
        nomeUnidadeMedida: 'Metro Quadrado',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
      },
    ],
  },
  {
    nome: 'Adesivo Brilho Impresso',
    codigo: 'ADBRL',
    setorNome: 'Impressão',
    categoriaNome: 'Adesivos',
    etapasProducao: ['Impressão'],
    produto: [
      {
        nome: 'Adesivo Brilho Impresso',
        unidadeMedida: 'M2',
        nomeUnidadeMedida: 'Metro Quadrado',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
      },
    ],
  },
  {
    nome: 'Adesivo Fosco Impresso',
    codigo: 'ADFOS',
    setorNome: 'Impressão',
    categoriaNome: 'Adesivos',
    etapasProducao: ['Impressão'],
    produto: [
      {
        nome: 'Adesivo Fosco Impresso',
        unidadeMedida: 'M2',
        nomeUnidadeMedida: 'Metro Quadrado',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
      },
    ],
  },
  {
    nome: 'Adesivo Jateado',
    codigo: 'ADJAT',
    setorNome: 'Impressão',
    categoriaNome: 'Adesivos',
    etapasProducao: ['Impressão'],
    produto: [
      {
        nome: 'Adesivo Jateado',
        unidadeMedida: 'M2',
        nomeUnidadeMedida: 'Metro Quadrado',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
      },
    ],
  },
  {
    nome: 'Adesivo Perfurado',
    codigo: 'ADPER',
    setorNome: 'Impressão',
    categoriaNome: 'Adesivos',
    etapasProducao: ['Impressão'],
    produto: [
      {
        nome: 'Adesivo Perfurado',
        unidadeMedida: 'M2',
        nomeUnidadeMedida: 'Metro Quadrado',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
      },
    ],
  },
  {
    nome: 'Adesivo Recorte',
    codigo: 'ADREC',
    setorNome: 'Impressão',
    categoriaNome: 'Adesivos',
    etapasProducao: ['Impressão'],
    produto: [
      {
        nome: 'Adesivo Recorte',
        unidadeMedida: 'M2',
        nomeUnidadeMedida: 'Metro Quadrado',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
      },
    ],
  },
  {
    nome: 'Adesivo Refletivo',
    codigo: 'ADREF',
    setorNome: 'Impressão',
    categoriaNome: 'Adesivos',
    etapasProducao: ['Impressão'],
    produto: [
      {
        nome: 'Adesivo Refletivo',
        unidadeMedida: 'M2',
        nomeUnidadeMedida: 'Metro Quadrado',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
      },
    ],
  },
  {
    nome: 'Apostila',
    codigo: 'APOS',
    setorNome: 'Gráfica Rápida',
    categoriaNome: 'Papéis',
    etapasProducao: ['Produção'],
    produto: [
      {
        nome: 'Encadernação',
        unidadeMedida: 'UN',
        nomeUnidadeMedida: 'Unidade',
        dimensoes: null,
      },
      {
        nome: 'Impressão A4 color',
        unidadeMedida: 'UN',
        nomeUnidadeMedida: 'Unidade',
        dimensoes: null,
      },
    ],
  },
  {
    nome: 'Banner',
    codigo: 'BN001',
    setorNome: 'Impressão',
    categoriaNome: 'Lonas',
    etapasProducao: [],
    produto: [
      {
        nome: 'Banner',
        unidadeMedida: 'M2',
        nomeUnidadeMedida: 'Metro Quadrado',
        dimensoes: null,
      },
    ],
  },
  {
    nome: 'Bolsa Ac Cristal 2mm A4',
    codigo: 'BACA4',
    setorNome: 'CNC',
    categoriaNome: 'Acrlicos',
    etapasProducao: [],
    produto: [
      {
        nome: 'Bolsa Ac Cristal 2mm A4',
        unidadeMedida: 'UN',
        nomeUnidadeMedida: 'Unidade',
        dimensoes: null,
      },
    ],
  },
  {
    nome: 'Cavalete Ilhos',
    codigo: 'CAVIL',
    setorNome: 'Serralheria',
    categoriaNome: 'Estruturas',
    etapasProducao: ['Criação', 'Instalação', 'Serralheria', 'Impressão'],
    produto: [
      {
        nome: 'Cavalete Ilhos',
        unidadeMedida: 'M2',
        nomeUnidadeMedida: 'Metro Quadrado',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
      },
    ],
  },
  {
    nome: 'Criação',
    codigo: 'CRIAC',
    setorNome: 'Criação',
    categoriaNome: 'Serviço Criação',
    etapasProducao: ['Criação'],
    produto: [
      {
        nome: 'Criação',
        unidadeMedida: 'HH',
        nomeUnidadeMedida: 'Hora',
        dimensoes: {
          duracao: 64800,
        },
      },
    ],
  },
  {
    nome: 'Instalação ',
    codigo: 'INSTL',
    setorNome: 'Instalação',
    categoriaNome: 'Serviço Instalação',
    etapasProducao: ['Instalação'],
    produto: [
      {
        nome: 'Instalação',
        unidadeMedida: 'HH',
        nomeUnidadeMedida: 'Hora',
        dimensoes: null,
      },
    ],
  },
  {
    nome: 'Letra Caixa Galvanizada',
    codigo: 'LTCXG',
    setorNome: 'Serralheria',
    categoriaNome: 'Estruturas',
    etapasProducao: [],
    produto: [
      {
        nome: 'Letra Caixa Galvanizada',
        unidadeMedida: 'M2',
        nomeUnidadeMedida: 'Metro Quadrado',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
      },
    ],
  },
  {
    nome: 'Letra Caixa Inox',
    codigo: 'LTCXI',
    setorNome: 'Serralheria',
    categoriaNome: 'Letra Caixa',
    etapasProducao: [],
    produto: [
      {
        nome: 'Letra Caixa Inox',
        unidadeMedida: 'M2',
        nomeUnidadeMedida: 'Metro Quadrado',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
      },
    ],
  },
  {
    nome: 'Letra Caixa PVC 10 mm',
    codigo: 'LTP10',
    setorNome: 'CNC',
    categoriaNome: 'PVC ',
    etapasProducao: [],
    produto: [
      {
        nome: 'Letra Caixa PVC 10 mm',
        unidadeMedida: 'M2',
        nomeUnidadeMedida: 'Metro Quadrado',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
      },
    ],
  },
  {
    nome: 'Letra Caixa PVC 20 mm',
    codigo: 'LTP20',
    setorNome: 'CNC',
    categoriaNome: 'PVC ',
    etapasProducao: [],
    produto: [
      {
        nome: 'Letra Caixa PVC 20 mm',
        unidadeMedida: 'M2',
        nomeUnidadeMedida: 'Metro Quadrado',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
      },
    ],
  },
  {
    nome: 'Letra Caixa PVC 5 mm',
    codigo: 'LTP05',
    setorNome: 'CNC',
    categoriaNome: 'PVC ',
    etapasProducao: [],
    produto: [
      {
        nome: 'Letra Caixa PVC 5 mm',
        unidadeMedida: 'M2',
        nomeUnidadeMedida: 'Metro Quadrado',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
      },
    ],
  },
  {
    nome: 'Lona Impressa',
    codigo: 'LONIM',
    setorNome: 'Impressão',
    categoriaNome: 'Lonas',
    etapasProducao: [],
    produto: [
      {
        nome: 'Lona Impressa',
        unidadeMedida: 'M2',
        nomeUnidadeMedida: 'Metro Quadrado',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
      },
    ],
  },
  {
    nome: 'Lona Impressa com Bainha e Ilhós',
    codigo: 'LOBIL',
    setorNome: 'Impressão',
    categoriaNome: 'Lonas',
    etapasProducao: ['Impressão', 'Produção'],
    produto: [
      {
        nome: 'Lona Impressa com Bainha e Ilhós',
        unidadeMedida: 'M2',
        nomeUnidadeMedida: 'Metro Quadrado',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
      },
    ],
  },
  {
    nome: 'Milheiro Cartão Visita',
    codigo: 'CARTV',
    setorNome: 'Gráfica Rápida',
    categoriaNome: 'Revenda Gráfica Rápida',
    etapasProducao: [],
    produto: [
      {
        nome: 'Milheiro Cartão Visita',
        unidadeMedida: 'UN',
        nomeUnidadeMedida: 'Unidade',
        dimensoes: null,
      },
    ],
  },
  {
    nome: 'Painel ACM',
    codigo: 'PNACM',
    setorNome: 'Serralheria',
    categoriaNome: 'Estruturas',
    etapasProducao: [],
    produto: [
      {
        nome: 'Painel ACM',
        unidadeMedida: 'M2',
        nomeUnidadeMedida: 'Metro Quadrado',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
      },
    ],
  },
  {
    nome: 'Painel Back Light',
    codigo: 'PNBLH',
    setorNome: 'Serralheria',
    categoriaNome: 'Estruturas',
    etapasProducao: [],
    produto: [
      {
        nome: 'Painel Back Light',
        unidadeMedida: 'M2',
        nomeUnidadeMedida: 'Metro Quadrado',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
      },
    ],
  },
  {
    nome: 'Painel Front Light',
    codigo: 'PNFLH',
    setorNome: 'Serralheria',
    categoriaNome: 'Estruturas',
    etapasProducao: [],
    produto: [
      {
        nome: 'Painel Front Light',
        unidadeMedida: 'M2',
        nomeUnidadeMedida: 'Metro Quadrado',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
      },
    ],
  },
];
