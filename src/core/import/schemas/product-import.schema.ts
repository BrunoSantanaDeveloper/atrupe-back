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
      example: 'Porta de Madeira',
    },
    {
      name: 'descricao',
      required: false,
      type: 'string',
      description: 'Descrição detalhada',
      example: 'Porta em madeira maciça',
    },
    {
      name: 'categoria',
      required: true,
      type: 'string',
      maxLength: 255,
      description: 'Nome da categoria',
      example: 'Portas',
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
      example: 'MARCENARIA',
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
      name: 'servico1',
      required: false,
      type: 'string',
      maxLength: 255,
      description: 'Nome do serviço 1',
      example: 'Fabricação',
    },
    {
      name: 'servico1Descricao',
      required: false,
      type: 'string',
      description: 'Descrição do serviço 1',
      example: 'Fabricação de porta em madeira',
    },
    {
      name: 'servico1UnidadeMedida',
      required: false,
      type: 'string',
      maxLength: 10,
      description: 'Unidade de medida: M2, MT, UN, etc.',
      example: 'M2',
    },
    {
      name: 'servico1Largura',
      required: false,
      type: 'decimal',
      description: 'Largura em metros',
      example: '0.80',
    },
    {
      name: 'servico1Altura',
      required: false,
      type: 'decimal',
      description: 'Altura em metros',
      example: '2.10',
    },
    {
      name: 'servico1Qtd',
      required: false,
      type: 'decimal',
      description: 'Quantidade',
      example: '1',
    },
    {
      name: 'servico1Custo',
      required: false,
      type: 'decimal',
      description: 'Custo unitário',
      example: '150.00',
    },
    {
      name: 'servico1Preco',
      required: false,
      type: 'decimal',
      description: 'Preço de venda',
      example: '350.00',
    },
  ],
};
