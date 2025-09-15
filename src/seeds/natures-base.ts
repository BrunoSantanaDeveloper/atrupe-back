export const BASE_NATURES = [
  // RECEITAS
  {
    description: 'Vendas',
    level1: '01',
    level2: '02',
    code: '01',
    subCategories: [
      {
        description: 'Prestação de Serviços',
        code: '01',
      },
      {
        description: 'Venda de Mercadorias',
        code: '02',
      },
      {
        description: 'Receita de Aluguéis',
        code: '03',
      },
      {
        description: 'Receita Diversas',
        code: '04',
      },
      {
        description: 'Descontos Recebidos',
        code: '05',
      },
      {
        description: 'Juros Recebidos',
        code: '06',
      },
    ],
  },
  {
    description: 'Sócios',
    level1: '01',
    level2: '03',
    code: '01',
    subCategories: [
      {
        description: 'Aporte Sócios',
        code: '01',
      },
    ],
  },
  {
    description: 'Empréstimos e Financiamentos',
    level1: '01',
    level2: '03',
    code: '02',
    subCategories: [
      {
        description: 'Entrada Empréstimo / Financiamento',
        code: '01',
      },
    ],
  },
  {
    description: 'Investimentos',
    level1: '01',
    level2: '03',
    code: '03',
    subCategories: [
      {
        description: 'Juros recebidos de aplicaçoões / investimentos',
        code: '01',
      },
      {
        description: 'Venda de Ativo Imobilizado (Bens)',
        code: '02',
      },
    ],
  },
  // DESPESAS
  {
    description: 'Administrativo',
    level1: '02',
    level2: '01',
    code: '01',
    subCategories: [
      {
        description: 'Água',
        code: '01',
      },
      {
        description: 'Aluguel',
        code: '02',
      },
      {
        description: 'Alvará / IPTU',
        code: '03',
      },
      {
        description: 'Copa Cozinha',
        code: '04',
      },
      {
        description: 'Energia Elétrica',
        code: '05',
      },
      {
        description: 'Contabilidade',
        code: '06',
      },
      {
        description: 'Internet',
        code: '07',
      },
      {
        description: 'Material de Escritório',
        code: '08',
      },
      {
        description: 'Material de Limpeza',
        code: '09',
      },
      {
        description: 'Marketing',
        code: '10',
      },
      {
        description: 'Sistemas / Softwares',
        code: '11',
      },
      {
        description: 'Telefone',
        code: '12',
      },
      {
        description: 'Manutenção e Conservação Predial',
        code: '13',
      },
      {
        description: 'Manutenção de Máquinas',
        code: '14',
      },
    ],
  },
  {
    description: 'Operacional',
    level1: '02',
    level2: '02',
    code: '01',
    subCategories: [
      {
        description: 'Matéria Prima',
        code: '01',
      },
      {
        description: 'Produtos para Revenda',
        code: '02',
      },
      {
        description: 'Terceirizados de O.S.',
        code: '03',
      },
      {
        description: 'Aluguel de Máquinas e Equipamentos',
        code: '04',
      },
      {
        description: 'Despesas de Viagem',
        code: '05',
      },
      {
        description: 'Comissão de Venda',
        code: '06',
      },
      {
        description: 'Frete de Compra',
        code: '07',
      },
      {
        description: 'Frete de Venda',
        code: '08',
      },
      {
        description: 'DAS - Simples Nacional',
        code: '09',
      },
      {
        description: 'Dare - Documento de Arrecadação Receitas Estaduais',
        code: '10',
      },
      {
        description: 'Descontos Concedidos',
        code: '11',
      },
    ],
  },
  {
    description: 'Frota',
    level1: '02',
    level2: '02',
    code: '02',
    subCategories: [
      {
        description: 'Combustível',
        code: '01',
      },
      {
        description: 'Lavação',
        code: '02',
      },
      {
        description: 'Multas',
        code: '03',
      },
      {
        description: 'Manutenção',
        code: '04',
      },
      {
        description: 'Revisão',
        code: '05',
      },
      {
        description: 'Seguro',
        code: '06',
      },
      {
        description: 'Emplacamento',
        code: '07',
      },
      {
        description: 'Pneus',
        code: '08',
      },
      {
        description: 'Pedágio',
        code: '09',
      },
      {
        description: 'Estacionamento',
        code: '10',
      },
      {
        description: 'Veículos de Colaboradores',
        code: '11',
      },
    ],
  },
  {
    description: 'Colaboradores / RH',
    level1: '02',
    level2: '02',
    code: '03',
    subCategories: [
      {
        description: 'Salários',
        code: '01',
      },
      {
        description: 'Horas Extras',
        code: '02',
      },
      {
        description: 'Ajuda de Custo',
        code: '03',
      },
      {
        description: 'Vale Transporte',
        code: '04',
      },
      {
        description: 'Alimentação',
        code: '05',
      },
      {
        description: 'INSS - Instituto Nacional do Seguro Social',
        code: '06',
      },
      {
        description: 'FGTS - Fundo de Garantia Tempo de Serviço',
        code: '07',
      },
      {
        description: 'GPS - Guia Previdência Social',
        code: '08',
      },
      {
        description: 'Férias',
        code: '09',
      },
      {
        description: '13°  Salário',
        code: '10',
      },
      {
        description: 'Atestados e Taxas',
        code: '11',
      },
      {
        description: 'Cursos e Treinamentos',
        code: '12',
      },
      {
        description: 'Rescisão',
        code: '13',
      },
      {
        description: 'Pró-Labore',
        code: '14',
      },
    ],
  },
  {
    description: 'Despesas Financeiras',
    level1: '02',
    level2: '02',
    code: '04',
    subCategories: [
      {
        description: 'Tarifas Bancárias',
        code: '01',
      },
      {
        description: 'Tarifa de Cartão de Crédito',
        code: '02',
      },
      {
        description: 'Juros Pagos',
        code: '03',
      },
      {
        description: 'IOF - Imposto de Operações de Crédito',
        code: '04',
      },
    ],
  },
  {
    description: 'Sócios',
    level1: '02',
    level2: '03',
    code: '01',
    subCategories: [
      {
        description: 'Retirada de Lucro',
        code: '01',
      },
    ],
  },
  {
    description: 'Investimentos',
    level1: '02',
    level2: '03',
    code: '02',
    subCategories: [
      {
        description: 'Equipamentos de Escritório',
        code: '01',
      },
      {
        description: 'Equipamentos de Produção',
        code: '02',
      },
      {
        description: 'Outros',
        code: '03',
      },
    ],
  },
  {
    description: 'Empréstimos e Financiamentos',
    level1: '02',
    level2: '03',
    code: '03',
    subCategories: [
      {
        description: 'Amortização de Empréstimo e Financiamento',
        code: '01',
      },
    ],
  },
];
