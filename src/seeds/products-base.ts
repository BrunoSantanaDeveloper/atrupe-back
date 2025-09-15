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
  etapasProducao: string[];
  produto: ProductItemType[];
  imageUrl?: string;
}

export const BASE_PRODUCTS: ProductType[] = [
  {
    nome: 'Adesivo Blackout Impresso',
    codigo: 'ADBLK',
    setorNome: 'Impressão',
    categoriaNome: 'Adesivos',
    etapasProducao: ['Impressão'],
    imageUrl:
      'https://files-atrupe.s3.us-east-1.amazonaws.com/adesivo-vinil-blockout-tamanhos-variados-vinil-0-10-impressao-solvente-sem-acabamento-4x0-1708888504106108472565db91b8e7291-0def6aab-eac2-4908-afdc-ec487a8cefcf.jpg',
    produto: [
      {
        nome: 'Adesivo Blackout Impresso',
        tipo: 'AREA',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
        precoVenda: 10000,
        precoUnitario: 0.01,
      },
    ],
  },
  {
    nome: 'Adesivo Brilho Impresso',
    codigo: 'ADBRL',
    setorNome: 'Impressão',
    categoriaNome: 'Adesivos',
    etapasProducao: ['Impressão'],
    imageUrl: '',
    produto: [
      {
        nome: 'Adesivo Brilho Impresso',
        tipo: 'AREA',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
        precoVenda: 10000,
        precoUnitario: 0.01,
      },
    ],
  },
  {
    nome: 'Adesivo Fosco Impresso',
    codigo: 'ADFOS',
    setorNome: 'Impressão',
    categoriaNome: 'Adesivos',
    etapasProducao: ['Impressão'],
    imageUrl: '',
    produto: [
      {
        nome: 'Adesivo Fosco Impresso',
        tipo: 'AREA',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
        precoVenda: 10000,
        precoUnitario: 0.01,
      },
    ],
  },
  {
    nome: 'Adesivo Jateado',
    codigo: 'ADJAT',
    setorNome: 'Impressão',
    categoriaNome: 'Adesivos',
    etapasProducao: ['Impressão'],
    imageUrl: '',
    produto: [
      {
        nome: 'Adesivo Jateado',
        tipo: 'AREA',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
        precoVenda: 10000,
        precoUnitario: 0.01,
      },
    ],
  },
  {
    nome: 'Adesivo Perfurado',
    codigo: 'ADPER',
    setorNome: 'Impressão',
    categoriaNome: 'Adesivos',
    etapasProducao: ['Impressão'],
    imageUrl: '',
    produto: [
      {
        nome: 'Adesivo Perfurado',
        tipo: 'AREA',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
        precoVenda: 10000,
        precoUnitario: 0.01,
      },
    ],
  },
  {
    nome: 'Adesivo Recorte',
    codigo: 'ADREC',
    setorNome: 'Impressão',
    categoriaNome: 'Adesivos',
    etapasProducao: ['Impressão'],
    imageUrl: '',
    produto: [
      {
        nome: 'Adesivo Recorte',
        tipo: 'AREA',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
        precoVenda: 10000,
        precoUnitario: 0.01,
      },
    ],
  },
  {
    nome: 'Adesivo Refletivo',
    codigo: 'ADREF',
    setorNome: 'Impressão',
    categoriaNome: 'Adesivos',
    etapasProducao: ['Impressão'],
    imageUrl: '',
    produto: [
      {
        nome: 'Adesivo Refletivo',
        tipo: 'AREA',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
        precoVenda: 20000,
        precoUnitario: 0.02,
      },
    ],
  },
  {
    nome: 'Apostila',
    codigo: 'APOS',
    setorNome: 'Gráfica Rápida',
    categoriaNome: 'Papéis',
    etapasProducao: ['Produção'],
    imageUrl: '',
    produto: [
      {
        nome: 'Encadernação',
        tipo: 'UNITY',
        dimensoes: null,
        precoVenda: 300,
        precoUnitario: 300,
      },
      {
        nome: 'Impressão A4 color',
        tipo: 'UNITY',
        dimensoes: null,
        precoVenda: 300,
        precoUnitario: 300,
      },
    ],
  },
  {
    nome: 'Impressão A4',
    codigo: 'APOS',
    setorNome: 'Gráfica Rápida',
    categoriaNome: 'Papéis',
    etapasProducao: ['Produção'],
    imageUrl: '',
    produto: [
      {
        nome: 'Impressão A4',
        tipo: 'UNITY',
        dimensoes: null,
        precoVenda: 300,
        precoUnitario: 300,
      },
    ],
  },
  {
    nome: 'Banner',
    codigo: 'BANER',
    setorNome: 'Impressão',
    categoriaNome: 'Lonas',
    etapasProducao: [],
    imageUrl: '',
    produto: [
      {
        nome: 'Banner',
        tipo: 'AREA',
        dimensoes: null,
        precoVenda: 10000,
        precoUnitario: 0.01,
      },
    ],
  },
  {
    nome: 'Bolsa Acrilico A4',
    codigo: 'BACA4',
    setorNome: 'CNC',
    categoriaNome: 'Acrílicos',
    etapasProducao: [],
    imageUrl: '',
    produto: [
      {
        nome: 'Bolsa Acrilico A4',
        tipo: 'UNITY',
        dimensoes: null,
        precoVenda: 10000,
        precoUnitario: 10000,
      },
    ],
  },
  {
    nome: 'Cavalete Ilhós',
    codigo: 'CAVIL',
    setorNome: 'Serralheria',
    categoriaNome: 'Estruturas',
    etapasProducao: ['Criação', 'Instalação', 'Serralheria', 'Impressão'],
    imageUrl: '',
    produto: [
      {
        nome: 'Cavalete Ilhós',
        tipo: 'AREA',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
        precoVenda: 25000,
        precoUnitario: 0.025,
      },
    ],
  },
  {
    nome: 'Criação',
    codigo: 'CRIAC',
    setorNome: 'Criação',
    categoriaNome: 'Serviço Criação',
    etapasProducao: ['Criação'],
    imageUrl: '',
    produto: [
      {
        nome: 'Criação',
        tipo: 'DURATION',
        dimensoes: {
          duracao: 64800,
        },
        precoVenda: 10000,
        precoUnitario: 2.777777777777778,
      },
    ],
  },
  {
    nome: 'Instalação',
    codigo: 'INSTL',
    setorNome: 'Instalação',
    categoriaNome: 'Serviço Instalação',
    etapasProducao: ['Instalação'],
    imageUrl: '',
    produto: [
      {
        nome: 'Instalação',
        tipo: 'DURATION',
        dimensoes: null,
        precoVenda: 10000,
        precoUnitario: 2.777777777777778,
      },
    ],
  },
  {
    nome: 'Letra Caixa Galvanizada',
    codigo: 'LTCXG',
    setorNome: 'Serralheria',
    categoriaNome: 'Estruturas',
    etapasProducao: [],
    imageUrl: '',
    produto: [
      {
        nome: 'Letra Caixa Galvanizada',
        tipo: 'AREA',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
        precoVenda: 30000,
        precoUnitario: 30,
      },
    ],
  },
  {
    nome: 'Letra Caixa Inox',
    codigo: 'LTCXI',
    setorNome: 'Serralheria',
    categoriaNome: 'Letra Caixa',
    etapasProducao: [],
    imageUrl: '',
    produto: [
      {
        nome: 'Letra Caixa Inox',
        tipo: 'AREA',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
        precoVenda: 50000,
        precoUnitario: 50,
      },
    ],
  },
  {
    nome: 'Letra Caixa PVC 10 mm',
    codigo: 'LTP10',
    setorNome: 'CNC',
    categoriaNome: 'PVC',
    etapasProducao: [],
    imageUrl: '',
    produto: [
      {
        nome: 'Letra Caixa PVC 10 mm',
        tipo: 'AREA',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
        precoVenda: 25000,
        precoUnitario: 25,
      },
    ],
  },
  {
    nome: 'Letra Caixa PVC 20 mm',
    codigo: 'LTP20',
    setorNome: 'CNC',
    categoriaNome: 'PVC',
    etapasProducao: [],
    imageUrl: '',
    produto: [
      {
        nome: 'Letra Caixa PVC 20 mm',
        tipo: 'AREA',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
        precoVenda: 30000,
        precoUnitario: 30,
      },
    ],
  },
  {
    nome: 'Letra Caixa PVC 5 mm',
    codigo: 'LTP05',
    setorNome: 'CNC',
    categoriaNome: 'PVC',
    etapasProducao: [],
    imageUrl: '',
    produto: [
      {
        nome: 'Letra Caixa PVC 5 mm',
        tipo: 'AREA',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
        precoVenda: 20000,
        precoUnitario: 20,
      },
    ],
  },
  {
    nome: 'Lona Impressa',
    codigo: 'LOIMP',
    setorNome: 'Impressão',
    categoriaNome: 'Lonas',
    etapasProducao: [],
    imageUrl: '',
    produto: [
      {
        nome: 'Lona Impressa',
        tipo: 'AREA',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
        precoVenda: 10000,
        precoUnitario: 0.01,
      },
    ],
  },
  {
    nome: 'Lona Impressa com Bainha e Ilhós',
    codigo: 'LOBIL',
    setorNome: 'Impressão',
    categoriaNome: 'Lonas',
    etapasProducao: ['Impressão', 'Produção'],
    imageUrl: '',
    produto: [
      {
        nome: 'Lona Impressa com Bainha e Ilhós',
        tipo: 'AREA',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
        precoVenda: 15000,
        precoUnitario: 15,
      },
    ],
  },
  {
    nome: 'Milheiro Cartão Visita',
    codigo: 'CARTV',
    setorNome: 'Gráfica Rápida',
    categoriaNome: 'Revenda Gráfica Rápida',
    etapasProducao: [],
    imageUrl: '',
    produto: [
      {
        nome: 'Milheiro Cartão Visita',
        tipo: 'UNITY',
        dimensoes: null,
        precoVenda: 20000,
        precoUnitario: 20000,
      },
    ],
  },
  {
    nome: 'Painel ACM',
    codigo: 'PNACM',
    setorNome: 'Serralheria',
    categoriaNome: 'Estruturas',
    etapasProducao: [],
    imageUrl: '',
    produto: [
      {
        nome: 'Painel ACM',
        tipo: 'AREA',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
        precoVenda: 40000,
        precoUnitario: 40,
      },
    ],
  },
  {
    nome: 'Painel Back Light',
    codigo: 'PNBLT',
    setorNome: 'Serralheria',
    categoriaNome: 'Estruturas',
    etapasProducao: [],
    imageUrl: '',
    produto: [
      {
        nome: 'Painel Back Light',
        tipo: 'AREA',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
        precoVenda: 50000,
        precoUnitario: 50,
      },
    ],
  },
  {
    nome: 'Painel Front Light',
    codigo: 'PNFLT',
    setorNome: 'Serralheria',
    categoriaNome: 'Estruturas',
    etapasProducao: [],
    imageUrl: '',
    produto: [
      {
        nome: 'Painel Front Light',
        tipo: 'AREA',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
        precoVenda: 20000,
        precoUnitario: 20,
      },
    ],
  },
];
