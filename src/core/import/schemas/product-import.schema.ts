export const PRODUCT_IMPORT_SCHEMA = {
  fields: [
    {
      name: 'codigo',
      required: true,
      type: 'string',
      maxLength: 100,
      description: 'Código único do produto',
      example: 'PROD-001',
      validate: async (value: string, companyId: string, prisma: any) => {
        const existing = await prisma.product.findUnique({
          where: {
            code_companyId: {
              code: value,
              companyId,
            },
          },
        });
        if (existing) {
          return 'Código já existe para outro produto';
        }
        return null;
      },
    },
    {
      name: 'nome',
      required: true,
      type: 'string',
      maxLength: 255,
      description: 'Nome do produto',
      example: 'Cartão de Visita',
    },
    {
      name: 'descricao',
      required: false,
      type: 'string',
      description: 'Descrição detalhada',
      example: 'Cartão de visita 4x4 cores em papel couché 300g',
    },
    {
      name: 'categoria',
      required: true,
      type: 'string',
      maxLength: 255,
      description: 'Nome da categoria',
      example: 'Impressos Comerciais',
      validate: async (value: string, companyId: string, prisma: any) => {
        const category = await prisma.category.findFirst({
          where: {
            name: value,
            companyId,
          },
        });
        if (!category) {
          return 'Categoria não encontrada. Cadastre a categoria antes de importar';
        }
        return null;
      },
    },
    {
      name: 'setor',
      required: true,
      type: 'string',
      maxLength: 255,
      description: 'Nome do setor',
      example: 'IMPRESSAO',
      validate: async (value: string, companyId: string, prisma: any) => {
        const sector = await prisma.companySector.findFirst({
          where: {
            name: value,
            companyId,
          },
        });
        if (!sector) {
          return 'Setor não encontrado. Cadastre o setor antes de importar';
        }
        return null;
      },
    },
    {
      name: 'servico',
      required: false,
      type: 'string',
      maxLength: 255,
      description: 'Nome do serviço',
      example: 'Impressão Offset',
    },
    {
      name: 'servicoDescricao',
      required: false,
      type: 'string',
      description: 'Descrição do serviço',
      example: 'Impressão offset 4x4 cores em papel couché',
    },
    {
      name: 'unidadeMedida',
      required: false,
      type: 'string',
      maxLength: 10,
      description: 'Unidade de medida: M2, MT, UN, etc.',
      example: 'UN',
    },
    {
      name: 'largura',
      required: false,
      type: 'decimal',
      description: 'Largura em metros',
      example: '0.09',
    },
    {
      name: 'altura',
      required: false,
      type: 'decimal',
      description: 'Altura em metros',
      example: '0.05',
    },
    {
      name: 'quantidade',
      required: false,
      type: 'decimal',
      description: 'Quantidade',
      example: '1',
    },
    {
      name: 'custo',
      required: false,
      type: 'decimal',
      description: 'Custo unitário',
      example: '45.00',
    },
    {
      name: 'preco',
      required: false,
      type: 'decimal',
      description: 'Preço de venda',
      example: '120.00',
    },
  ],
};
