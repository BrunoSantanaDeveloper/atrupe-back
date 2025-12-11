export const QUOTATION_IMPORT_SCHEMA = {
  fields: [
    {
      name: 'NumeroVenda',
      required: true,
      type: 'number',
      description: 'Número único do orçamento',
      example: '1',
    },
    {
      name: 'Serie',
      required: true,
      type: 'string',
      maxLength: 10,
      description: 'Série do orçamento',
      example: 'V1',
      validate: async (value: string, companyId: string, prisma: any) => {
        const series = await prisma.saleSeries.findFirst({
          where: {
            code: value,
            companyId,
            isActive: true,
          },
        });
        if (!series) {
          return 'Série não encontrada. Cadastre a série antes de importar';
        }
        return null;
      },
    },
    {
      name: 'Status',
      required: true,
      type: 'string',
      maxLength: 50,
      description: 'Status do orçamento: OPEN, DONE, REJECTED',
      example: 'OPEN',
    },
    {
      name: 'DataVenda',
      required: true,
      type: 'date',
      description: 'Data de criação',
      example: '2024-01-15',
    },
    {
      name: 'DataValidade',
      required: false,
      type: 'date',
      description: 'Data de validade',
      example: '2024-02-15',
    },
    {
      name: 'ClienteCpfCnpj',
      required: true,
      type: 'string',
      maxLength: 18,
      description: 'CPF ou CNPJ do cliente (apenas números ou formatado)',
      example: '12345678900 ou 12.345.678/0001-90',
      validate: async (value: string, companyId: string, prisma: any) => {
        // Remover formatação
        const cleanValue = value.replace(/[^\d]/g, '');

        // Buscar cliente por CPF ou CNPJ
        const client = await prisma.client.findFirst({
          where: {
            companyId,
            OR: [
              { cpf: { contains: cleanValue } },
              { cnpj: { contains: cleanValue } },
            ],
          },
        });

        if (!client) {
          return 'Cliente não encontrado. Cadastre o cliente antes de importar';
        }
        return null;
      },
    },
    {
      name: 'ClienteNome',
      required: false,
      type: 'string',
      maxLength: 255,
      description: 'Nome do cliente (opcional, usado apenas para referência)',
      example: 'João Silva',
    },
    {
      name: 'VendedorEmail',
      required: true,
      type: 'string',
      maxLength: 255,
      description: 'Email do vendedor',
      example: 'vendedor@empresa.com',
      validate: async (value: string, companyId: string, prisma: any) => {
        const employee = await prisma.employee.findFirst({
          where: {
            user: {
              email: value,
            },
            companyId,
            isActive: true,
          },
        });
        if (!employee) {
          return 'Vendedor não encontrado. Cadastre o vendedor antes de importar';
        }
        return null;
      },
    },
    {
      name: 'ItemID',
      required: true,
      type: 'number',
      description: 'Sequência do item (1, 2, 3...)',
      example: '1',
    },
    {
      name: 'ProdutoCodigo',
      required: true,
      type: 'string',
      maxLength: 100,
      description: 'Código do produto',
      example: 'PROD-001',
      validate: async (value: string, companyId: string, prisma: any) => {
        const product = await prisma.product.findUnique({
          where: {
            code_companyId: {
              code: value,
              companyId,
            },
          },
        });
        if (!product) {
          return 'Produto não encontrado. Cadastre o produto antes de importar';
        }
        return null;
      },
    },
    {
      name: 'ProdutoNome',
      required: true,
      type: 'string',
      maxLength: 255,
      description: 'Nome do produto',
      example: 'Porta de Madeira',
    },
    {
      name: 'Quantidade',
      required: true,
      type: 'decimal',
      description: 'Quantidade',
      example: '2',
    },
    {
      name: 'ValorUnitario',
      required: true,
      type: 'decimal',
      description: 'Valor unitário',
      example: '350.00',
    },
    {
      name: 'ValorTotal',
      required: true,
      type: 'decimal',
      description: 'Valor total do item',
      example: '700.00',
    },
    {
      name: 'Desconto',
      required: false,
      type: 'decimal',
      description: 'Desconto aplicado',
      example: '0',
    },
    {
      name: 'ObservacaoItem',
      required: false,
      type: 'string',
      description: 'Observação do item',
      example: 'Entrega em 15 dias',
    },
  ],
};
