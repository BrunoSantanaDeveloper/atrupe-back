export const BASE_NATURES = [
  // RECEITAS
  {
    description: 'Vendas',
    level1: '01',
    level2: '02',
    code: '01',
    isActive: true,
    subCategories: [
      {
        description: 'Prestação de Serviços',
        code: '01',
        isActive: true,
      },
      {
        description: 'Venda de Mercadorias',
        code: '02',
        isActive: true,
      },
      {
        description: 'Receita de Aluguéis',
        code: '03',
        isActive: true,
      },
      {
        description: 'Receita Diversas',
        code: '04',
        isActive: true,
      },
    ],
  },
  {
    description: 'Sócios',
    level1: '01',
    level2: '03',
    code: '01',
    isActive: true,
    subCategories: [
      {
        description: 'Aporte Sócios',
        code: '01',
        isActive: true,
      },
    ],
  },
  {
    description: 'Empréstimos e Financiamentos',
    level1: '01',
    level2: '03',
    code: '02',
    isActive: true,
    subCategories: [
      {
        description: 'Entrada Empréstimo / Financiamento',
        code: '01',
        isActive: true,
      },
    ],
  },
  {
    description: 'Investimentos',
    level1: '01',
    level2: '03',
    code: '03',
    isActive: true,
    subCategories: [
      {
        description: 'Juros recebidos de aplicaçoões / investimentos',
        code: '01',
        isActive: true,
      },
      {
        description: 'Venda de Ativo Imobilizado (Bens)',
        code: '02',
        isActive: true,
      },
    ],
  },

  // DESPESAS
  {
    description: 'Administrativo',
    level1: '02',
    level2: '01',
    code: '01',
    isActive: true,
    subCategories: [
      {
        description: 'Material de Limpeza',
        code: '09',
        isActive: true,
      },
      {
        description: 'Água',
        code: '01',
        isActive: true,
      },
      {
        description: 'Contabilidade',
        code: '06',
        isActive: true,
      },
      {
        description: 'Internet',
        code: '07',
        isActive: true,
      },
      {
        description: 'Material de Escritório',
        code: '08',
        isActive: true,
      },
      {
        description: 'Aluguel',
        code: '02',
        isActive: true,
      },
      {
        description: 'Alvará / IPTU',
        code: '03',
        isActive: true,
      },
      {
        description: 'Energia Elétrica',
        code: '05',
        isActive: true,
      },
      {
        description: 'Copa Cozinha',
        code: '04',
        isActive: true,
      },
      {
        description: 'Marketing',
        code: '10',
        isActive: true,
      },
      {
        description: 'Sistemas / Softwares',
        code: '11',
        isActive: true,
      },
      {
        description: 'Manutenção e Conservação Predial',
        code: '14',
        isActive: true,
      },
      {
        description: 'Manutenção de Máquinas',
        code: '15',
        isActive: true,
      },
      {
        description: 'Telefone',
        code: '12',
        isActive: true,
      },
    ],
  },
  {
    description: 'Operacional',
    level1: '02',
    level2: '02',
    code: '01',
    isActive: true,
    subCategories: [
      {
        description: 'Matéria Prima',
        code: '01',
        isActive: true,
      },
      {
        description: 'Produtos para Revenda',
        code: '02',
        isActive: true,
      },
      {
        description: 'Terceirizados de O.S.',
        code: '03',
        isActive: true,
      },
      {
        description: 'Aluguel de Máquinas e Equipamentos',
        code: '04',
        isActive: true,
      },
      {
        description: 'Despesas de Viagem',
        code: '05',
        isActive: true,
      },
      {
        description: 'Comissão de Venda',
        code: '06',
        isActive: true,
      },
      {
        description: 'Frete de Compra',
        code: '07',
        isActive: true,
      },
      {
        description: 'Frete de Venda',
        code: '08',
        isActive: true,
      },
      {
        description: 'DAS - Simples Nacional',
        code: '09',
        isActive: true,
      },
      {
        description: 'Dare - Documento de Arrecadação Receitas Estaduais',
        code: '10',
        isActive: true,
      },
    ],
  },
  {
    description: 'Frota',
    level1: '02',
    level2: '02',
    code: '02',
    isActive: true,
    subCategories: [
      {
        description: 'Combustível',
        code: '01',
        isActive: true,
      },
      {
        description: 'Estacionamento',
        code: '10',
        isActive: true,
      },
      {
        description: 'Lavação',
        code: '02',
        isActive: true,
      },
      {
        description: 'Multas',
        code: '03',
        isActive: true,
      },
      {
        description: 'Manutenção',
        code: '04',
        isActive: true,
      },
      {
        description: 'Revisão',
        code: '05',
        isActive: true,
      },
      {
        description: 'Seguro',
        code: '06',
        isActive: true,
      },
      {
        description: 'Emplacamento',
        code: '07',
        isActive: true,
      },
      {
        description: 'Pneus',
        code: '08',
        isActive: true,
      },
      {
        description: 'Pedágio',
        code: '09',
        isActive: true,
      },
      {
        description: 'Veículos de Colaboradores',
        code: '11',
        isActive: true,
      },
    ],
  },
  {
    description: 'Colaboradores / RH',
    level1: '02',
    level2: '02',
    code: '03',
    isActive: true,
    subCategories: [
      {
        description: 'Salários',
        code: '01',
        isActive: true,
      },
      {
        description: 'Horas Extras',
        code: '02',
        isActive: true,
      },
      {
        description: 'Ajuda de Custo',
        code: '03',
        isActive: true,
      },
      {
        description: 'Vale Transporte',
        code: '04',
        isActive: true,
      },
      {
        description: 'Alimentação',
        code: '05',
        isActive: true,
      },
      {
        description: 'INSS - Instituto Nacional do Seguro Social',
        code: '06',
        isActive: true,
      },
      {
        description: 'FGTS - Fundo de Garantia Tempo de Serviço',
        code: '07',
        isActive: true,
      },
      {
        description: 'GPS - Guia Previdência Social',
        code: '08',
        isActive: true,
      },
      {
        description: 'Férias',
        code: '09',
        isActive: true,
      },
      {
        description: '13°  Salário',
        code: '10',
        isActive: true,
      },
      {
        description: 'Atestados e Taxas',
        code: '11',
        isActive: true,
      },
      {
        description: 'Cursos e Treinamentos',
        code: '12',
        isActive: true,
      },
      {
        description: 'Rescisão',
        code: '13',
        isActive: true,
      },
      {
        description: 'Pró-Labore',
        code: '14',
        isActive: true,
      },
    ],
  },
  {
    description: 'Despesas Financeiras',
    level1: '02',
    level2: '02',
    code: '04',
    isActive: true,
    subCategories: [
      {
        description: 'Tarifas Bancárias',
        code: '01',
        isActive: true,
      },
      {
        description: 'Tarifa de Cartão de Crédito',
        code: '02',
        isActive: true,
      },
      {
        description: 'Juros',
        code: '03',
        isActive: true,
      },
      {
        description: 'IOF - Imposto de Operações de Crédito',
        code: '04',
        isActive: true,
      },
    ],
  },
  {
    description: 'Sócios',
    level1: '02',
    level2: '03',
    code: '01',
    isActive: true,
    subCategories: [
      {
        description: 'Retirada de Lucro',
        code: '01',
        isActive: true,
      },
    ],
  },
  {
    description: 'Investimentos',
    level1: '02',
    level2: '03',
    code: '02',
    isActive: true,
    subCategories: [
      {
        description: 'Equipamentos de Escritório',
        code: '01',
        isActive: true,
      },
      {
        description: 'Equipamentos de Produção',
        code: '02',
        isActive: true,
      },
      {
        description: 'Outros',
        code: '03',
        isActive: true,
      },
    ],
  },
  {
    description: 'Empréstimos e Financiamentos',
    level1: '02',
    level2: '03',
    code: '03',
    isActive: true,
    subCategories: [
      {
        description: 'Amortização de Empréstimo e Financiamento',
        code: '01',
        isActive: true,
      },
    ],
  },
];
