interface DimensionsType {
  largura?: number;
  altura?: number;
  duracao?: number;
}

interface ProductItemType {
  nome: string;
  tipo:
    | 'AREA'
    | 'UNITY'
    | 'DURATION'
    | 'LENGTH'
    | 'WEIGHT'
    | 'CAPACITY'
    | 'DISTANCE';
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
        tipo: 'AREA',
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
        tipo: 'AREA',
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
        tipo: 'AREA',
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
        tipo: 'AREA',
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
        tipo: 'AREA',
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
        tipo: 'AREA',
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
        tipo: 'AREA',
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
        tipo: 'UNITY',
        dimensoes: null,
      },
      {
        nome: 'Impressão A4 color',
        tipo: 'UNITY',
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
        tipo: 'AREA',
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
        tipo: 'UNITY',
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
        tipo: 'AREA',
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
        tipo: 'DURATION',
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
        tipo: 'DURATION',
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
        tipo: 'AREA',
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
        tipo: 'AREA',
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
        tipo: 'AREA',
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
        tipo: 'AREA',
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
        tipo: 'AREA',
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
        tipo: 'AREA',
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
        tipo: 'AREA',
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
        tipo: 'UNITY',
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
        tipo: 'AREA',
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
        tipo: 'AREA',
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
        tipo: 'AREA',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
      },
    ],
  },
];
