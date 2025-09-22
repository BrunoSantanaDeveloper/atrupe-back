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
      'https://files-atrupe.s3.us-east-1.amazonaws.com/adesivo-branco-backlight-vinil-branco-backlight-sem-acabamento-4x0-16492417851524456276624d6eb91daf5-5776bb6d-2a74-4cd1-a236-3efcfbbb533a.png',
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
    imageUrl:
      'https://files-atrupe.s3.us-east-1.amazonaws.com/brilho-ba36a417-59ae-4ee9-9a1d-9bdd76d3b599.jpg',
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
    imageUrl:
      'https://files-atrupe.s3.us-east-1.amazonaws.com/Fosco-27c8344e-207b-4d57-8a70-a7a2ebc7c3b6.jpg',
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
    imageUrl:
      'https://files-atrupe.s3.us-east-1.amazonaws.com/jateado-c2ff2c7c-6365-4127-add9-c44f327eb0a7.jpg',
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
    imageUrl:
      'https://files-atrupe.s3.us-east-1.amazonaws.com/perfurado-a7c91637-d22d-4c12-9a70-aeda3f6f5711.jpeg',
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
    imageUrl:
      'https://files-atrupe.s3.us-east-1.amazonaws.com/8c2592fba1-a3e95633-7ac0-4770-926a-eaf08f833e87.webp',
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
    imageUrl:
      'https://files-atrupe.s3.us-east-1.amazonaws.com/refletivo-8494e9ca-4b4f-46a3-9659-e3b928856804.jpg',
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
    nome: 'Adesivo Transparente Impresso',
    codigo: 'ADTIM',
    setorNome: 'Impressão',
    categoriaNome: 'Adesivos',
    etapasProducao: ['Impressão'],
    imageUrl:
      'https://files-atrupe.s3.us-east-1.amazonaws.com/whatsapp-image-2023-02-06-at-13-56-221-79d718dd384d0dd1ef16757028500224-640-0-a3f4addd-1c2f-4d7c-80a9-810f483f4582.jpeg',
    produto: [
      {
        nome: 'Adesivo Transparente Impresso',
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
    nome: 'Impressão A4',
    codigo: 'APOS',
    setorNome: 'Gráfica Rápida',
    categoriaNome: 'Papéis',
    etapasProducao: ['Produção'],
    imageUrl:
      'https://files-atrupe.s3.us-east-1.amazonaws.com/ima4-017c40f2-1352-47fa-8149-e63f466c8f1f.jpg',
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
    imageUrl:
      'https://files-atrupe.s3.us-east-1.amazonaws.com/banner-e06b1689-72fa-4cfb-834c-e60f0ab6af23.jpg',
    produto: [
      {
        nome: 'Banner',
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
    nome: 'Bolsa Acrilico A4',
    codigo: 'BACA4',
    setorNome: 'CNC',
    categoriaNome: 'Acrílicos',
    etapasProducao: [],
    imageUrl:
      'https://files-atrupe.s3.us-east-1.amazonaws.com/bolsaacrilico-ca511ccc-be5d-4699-bebc-518f103cf711.png',
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
    nome: 'Cavalete',
    codigo: 'CAVIL',
    setorNome: 'Serralheria',
    categoriaNome: 'Estruturas',
    etapasProducao: ['Criação', 'Instalação', 'Serralheria', 'Impressão'],
    imageUrl:
      'https://files-atrupe.s3.us-east-1.amazonaws.com/cavalete-b47e9b03-f1f8-4332-aecd-f336507f6036.png',
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
    imageUrl:
      'https://files-atrupe.s3.us-east-1.amazonaws.com/criacao-510dbfbb-973f-4f70-9fba-1c429acfd65f.jpg',
    produto: [
      {
        nome: 'Criação',
        tipo: 'DURATION',
        dimensoes: {
          duracao: 3600,
        },
        precoVenda: 10000,
        precoUnitario: 2.777777777777778,
      },
    ],
  },
  {
    nome: 'Display A6',
    codigo: 'DISA6',
    setorNome: 'CNC',
    categoriaNome: 'Acrílicos',
    etapasProducao: [],
    imageUrl:
      'https://files-atrupe.s3.us-east-1.amazonaws.com/displayacrilicoa6-02a76e42-6d4b-4c23-8cc8-ebb9d4ae6b73.jpg',
    produto: [
      {
        nome: 'Display A6',
        tipo: 'UNITY',
        dimensoes: null,
        precoVenda: 5000,
        precoUnitario: 5000,
      },
    ],
  },
  {
    nome: 'Instalação',
    codigo: 'INSTL',
    setorNome: 'Instalação',
    categoriaNome: 'Serviço Instalação',
    etapasProducao: ['Instalação'],
    imageUrl:
      'https://files-atrupe.s3.us-east-1.amazonaws.com/instalac%C3%83%C2%8C%C3%82%C2%A7ao-e808ca5a-0f05-4db9-a843-c7b9ec900657.jpg',
    produto: [
      {
        nome: 'Instalação',
        tipo: 'DURATION',
        dimensoes: {
          duracao: 3600,
        },
        precoVenda: 10000,
        precoUnitario: 2.777777777777778,
      },
    ],
  },
  {
    nome: 'Letra Caixa Galvanizada com Pintura',
    codigo: 'LTCXG',
    setorNome: 'Serralheria',
    categoriaNome: 'Estruturas',
    etapasProducao: [],
    imageUrl:
      'https://files-atrupe.s3.us-east-1.amazonaws.com/letragalva-d9865673-0095-4778-ae87-3e579896c269.jpg',
    produto: [
      {
        nome: 'Letra Caixa Galvanizada com Pintura',
        tipo: 'AREA',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
        precoVenda: 30000,
        precoUnitario: 0.03,
      },
    ],
  },
  {
    nome: 'Letra Caixa Inox',
    codigo: 'LTCXI',
    setorNome: 'Serralheria',
    categoriaNome: 'Letra Caixa',
    etapasProducao: [],
    imageUrl:
      'https://files-atrupe.s3.us-east-1.amazonaws.com/inox-6d077247-5a8c-4351-a2d3-fb06742ead03.webp',
    produto: [
      {
        nome: 'Letra Caixa Inox',
        tipo: 'AREA',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
        precoVenda: 50000,
        precoUnitario: 0.05,
      },
    ],
  },
  {
    nome: 'Letra Caixa PVC 5mm',
    codigo: 'LTP05',
    setorNome: 'CNC',
    categoriaNome: 'PVC',
    etapasProducao: [],
    imageUrl: '',
    produto: [
      {
        nome: 'Letra Caixa PVC 5mm',
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
    nome: 'Letra Caixa PVC 10mm',
    codigo: 'LTP10',
    setorNome: 'CNC',
    categoriaNome: 'PVC',
    etapasProducao: [],
    imageUrl:
      'https://files-atrupe.s3.us-east-1.amazonaws.com/pvc-82118e5e-6fc9-491c-a81d-b4e01f2bee94.jpg',
    produto: [
      {
        nome: 'Letra Caixa PVC 10mm',
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
    nome: 'Letra Caixa PVC 20mm',
    codigo: 'LTP20',
    setorNome: 'CNC',
    categoriaNome: 'PVC',
    etapasProducao: [],
    imageUrl:
      'https://files-atrupe.s3.us-east-1.amazonaws.com/D_NQ_NP_2X_738108-MLB88638185903_072025-F-980137e6-80bd-42ab-86a8-3f0f5236d5cd.webp',
    produto: [
      {
        nome: 'Letra Caixa PVC 20mm',
        tipo: 'AREA',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
        precoVenda: 30000,
        precoUnitario: 0.03,
      },
    ],
  },
  {
    nome: 'Lona Impressa',
    codigo: 'LOIMP',
    setorNome: 'Impressão',
    categoriaNome: 'Lonas',
    etapasProducao: [],
    imageUrl:
      'https://files-atrupe.s3.us-east-1.amazonaws.com/lona-impressa-com-verniz-m-lona-brilho-sem-acabamento-4x0-16053619178456226045fafe0fd2cb3a-1e1a3b4c-7e69-40ec-adab-3e0e9a4098ae.jpg',
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
    imageUrl:
      'https://files-atrupe.s3.us-east-1.amazonaws.com/D_NQ_NP_2X_865246-MLB77648176491_072024-F-5c45fc85-043d-49b1-b2ec-493220619cce.webp',
    produto: [
      {
        nome: 'Lona Impressa com Bainha e Ilhós',
        tipo: 'AREA',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
        precoVenda: 15000,
        precoUnitario: 0.015,
      },
    ],
  },
  {
    nome: 'Milheiro Cartão Visita',
    codigo: 'CARTV',
    setorNome: 'Gráfica Rápida',
    categoriaNome: 'Revenda Gráfica Rápida',
    etapasProducao: [],
    imageUrl:
      'https://files-atrupe.s3.us-east-1.amazonaws.com/card1-099ea8cf-9651-46b8-b9f6-98aaf5dbad57.jpg',
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
    imageUrl:
      'https://files-atrupe.s3.us-east-1.amazonaws.com/acm-aa066330-260f-4c7a-bedb-1a151cfb1f4a.jpg',
    produto: [
      {
        nome: 'Painel ACM',
        tipo: 'AREA',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
        precoVenda: 40000,
        precoUnitario: 0.04,
      },
    ],
  },
  {
    nome: 'Painel Back Light',
    codigo: 'PNBLT',
    setorNome: 'Serralheria',
    categoriaNome: 'Estruturas',
    etapasProducao: [],
    imageUrl:
      'https://files-atrupe.s3.us-east-1.amazonaws.com/back-f5d79c2e-f1c5-458c-9541-6b312310bcb6.jpg',
    produto: [
      {
        nome: 'Painel Back Light',
        tipo: 'AREA',
        dimensoes: {
          largura: 1000,
          altura: 1000,
        },
        precoVenda: 50000,
        precoUnitario: 0.05,
      },
    ],
  },
  {
    nome: 'Painel Front Light',
    codigo: 'PNFLT',
    setorNome: 'Serralheria',
    categoriaNome: 'Estruturas',
    etapasProducao: [],
    imageUrl:
      'https://files-atrupe.s3.us-east-1.amazonaws.com/FRONT-f1cb6574-89d3-4aeb-9d3e-e71162cf401b.jpg',
    produto: [
      {
        nome: 'Painel Front Light',
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
];
