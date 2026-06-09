export const FINANCIAL_IMPORT_SCHEMA = {
  fields: [
    {
      name: 'Tipo',
      required: true,
      type: 'string',
      description: 'Tipo de lançamento: RECEITA ou DESPESA',
      example: 'RECEITA',
    },
    {
      name: 'Descricao',
      required: true,
      type: 'string',
      maxLength: 255,
      description: 'Descrição do lançamento',
      example: 'Pagamento de cliente João Silva',
    },
    {
      name: 'Referencia',
      required: false,
      type: 'string',
      maxLength: 100,
      description: 'Referência externa (número de nota, pedido, etc)',
      example: 'NF-12345',
    },
    {
      name: 'DataReferencia',
      required: true,
      type: 'date',
      description: 'Data de referência do lançamento',
      example: '2024-01-15',
    },
    {
      name: 'ValorTotal',
      required: true,
      type: 'decimal',
      description: 'Valor total do lançamento',
      example: '1500.00',
    },
    {
      name: 'QuantidadeParcelas',
      required: false,
      type: 'number',
      description: 'Quantidade de parcelas (padrão: 1)',
      example: '3',
    },
    {
      name: 'ClienteCpfCnpj',
      required: false,
      type: 'string',
      maxLength: 18,
      description: 'CPF ou CNPJ do cliente (para receitas)',
      example: '12345678900',
      validate: async (value: string, companyId: string, prisma: any) => {
        if (!value || value.trim() === '') return null;

        const cleanValue = value.replace(/[^\d]/g, '');

        // Buscar cliente por CPF ou CNPJ (removendo formatação do banco também)
        const client = await prisma.client.findFirst({
          where: {
            companyId,
            OR: [
              { cpf: { contains: cleanValue } },
              { cnpj: { contains: cleanValue } },
              { cpf: value }, // Busca também pelo valor original formatado
              { cnpj: value },
            ],
          },
        });

        // Se não encontrou, tentar busca mais flexível
        if (!client) {
          const clients = await prisma.client.findMany({
            where: { companyId },
            select: { id: true, cpf: true, cnpj: true },
          });

          const found = clients.find((c: any) => {
            const cleanCpf = (c.cpf || '').replace(/[^\d]/g, '');
            const cleanCnpj = (c.cnpj || '').replace(/[^\d]/g, '');
            return cleanCpf === cleanValue || cleanCnpj === cleanValue;
          });

          if (!found) {
            return 'Cliente não encontrado. Cadastre o cliente antes de importar';
          }
        }
        return null;
      },
    },
    {
      name: 'FornecedorCpfCnpj',
      required: false,
      type: 'string',
      maxLength: 18,
      description: 'CPF ou CNPJ do fornecedor (para despesas)',
      example: '98765432100',
      validate: async (value: string, companyId: string, prisma: any) => {
        if (!value || value.trim() === '') return null;

        const cleanValue = value.replace(/[^\d]/g, '');
        const supplier = await prisma.supplier.findFirst({
          where: {
            companyId,
            OR: [
              { cpf: { contains: cleanValue } },
              { cnpj: { contains: cleanValue } },
            ],
          },
        });

        if (!supplier) {
          return 'Fornecedor não encontrado. Cadastre o fornecedor antes de importar';
        }
        return null;
      },
    },
    {
      name: 'FuncionarioEmail',
      required: false,
      type: 'string',
      maxLength: 255,
      description: 'Email do funcionário (para despesas de salário)',
      example: 'funcionario@empresa.com',
      validate: async (value: string, companyId: string, prisma: any) => {
        if (!value || value.trim() === '') return null;

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
          return 'Funcionário não encontrado. Cadastre o funcionário antes de importar';
        }
        return null;
      },
    },
    {
      name: 'Natureza',
      required: false,
      type: 'string',
      maxLength: 100,
      description: 'Nome da natureza (categoria principal)',
      example: 'Vendas',
      validate: async (value: string, companyId: string, prisma: any) => {
        if (!value || value.trim() === '') return null;

        const nature = await prisma.nature.findFirst({
          where: {
            description: value,
            companyId,
            isActive: true,
          },
        });

        if (!nature) {
          return 'Natureza não encontrada. Cadastre a natureza antes de importar';
        }
        return null;
      },
    },
    {
      name: 'SubCategoria',
      required: false,
      type: 'string',
      maxLength: 100,
      description: 'Nome da subcategoria',
      example: 'Produtos',
      validate: async (
        value: string,
        companyId: string,
        prisma: any,
        row: any,
      ) => {
        if (!value || value.trim() === '') return null;

        let natureId: string | undefined;
        if (row.Natureza && row.Natureza.trim() !== '') {
          const nature = await prisma.nature.findFirst({
            where: {
              description: row.Natureza,
              companyId,
              isActive: true,
            },
          });
          natureId = nature?.id;
        }

        const subCategory = await prisma.subCategory.findFirst({
          where: {
            description: value,
            companyId,
            isActive: true,
            ...(natureId ? { natureId } : {}),
          },
        });

        if (!subCategory) {
          return 'Subcategoria nao encontrada. Cadastre a subcategoria antes de importar';
        }
        return null;
      },
    },
    {
      name: 'CondicaoPagamento',
      required: false,
      type: 'string',
      maxLength: 100,
      description: 'Nome da condição de pagamento',
      example: 'Boleto',
      validate: async (value: string, companyId: string, prisma: any) => {
        if (!value || value.trim() === '') return null;

        const paymentCondition = await prisma.paymentCondition.findFirst({
          where: {
            name: value,
            companyId,
            isActive: true,
          },
        });

        if (!paymentCondition) {
          return 'Condição de pagamento não encontrada. Cadastre a condição antes de importar';
        }
        return null;
      },
    },
    {
      name: 'Parcela',
      required: true,
      type: 'number',
      description: 'Número da parcela (1, 2, 3...)',
      example: '1',
    },
    {
      name: 'DataVencimento',
      required: true,
      type: 'date',
      description: 'Data de vencimento da parcela',
      example: '2024-01-30',
    },
    {
      name: 'ValorParcela',
      required: true,
      type: 'decimal',
      description: 'Valor da parcela',
      example: '500.00',
    },
    {
      name: 'Status',
      required: false,
      type: 'string',
      description:
        'Status da parcela: PENDING, PAID, OVERDUE, CANCELED (padrão: PENDING)',
      example: 'PAID',
    },
    {
      name: 'DataPagamento',
      required: false,
      type: 'date',
      description: 'Data de pagamento (apenas se Status = PAID)',
      example: '2024-01-28',
    },
    {
      name: 'ValorPago',
      required: false,
      type: 'decimal',
      description: 'Valor efetivamente pago (apenas se Status = PAID)',
      example: '500.00',
    },
    {
      name: 'ContaBancaria',
      required: false,
      type: 'string',
      maxLength: 100,
      description: 'Nome da conta bancária',
      example: 'Banco do Brasil - CC 12345-6',
      validate: async (value: string, companyId: string, prisma: any) => {
        if (!value || value.trim() === '') return null;

        const bankAccount = await prisma.bankAccount.findFirst({
          where: {
            name: value,
            companyId,
            isActive: true,
          },
        });

        if (!bankAccount) {
          return 'Conta bancária não encontrada. Cadastre a conta antes de importar';
        }
        return null;
      },
    },
    {
      name: 'Observacoes',
      required: false,
      type: 'string',
      description: 'Observações adicionais',
      example: 'Pagamento recebido via PIX',
    },
  ],
};
