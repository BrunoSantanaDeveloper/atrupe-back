export const ORDER_IMPORT_SCHEMA = {
  fields: [
    {
      name: 'ItemLargura',
      required: false,
      type: 'string',
      description:
        'Largura da linha, em metros. Quando vazia, usa a dimensão cadastrada no produto.',
      example: '10,71',
      validate: async (value: string) => {
        if (!value) return null;

        const meters = Number(
          value.trim().replace(/\s/g, '').replace(',', '.'),
        );
        if (isNaN(meters)) return 'Medida inválida';

        // Guarda de sanidade. Uma peça com mais de 100 m de lado é implausível
        // no ramo, e uma medida fora de escala não gera erro em lugar nenhum:
        // entra como número válido e distorce área e preço em silêncio. Foi
        // assim que 3,5 m virou 3,5 km numa carga inteira.
        if (meters > 100) {
          return {
            error: `Medida de ${meters} m parece fora de escala; confira a unidade da origem`,
            severity: 'warning',
          };
        }
        return null;
      },
    },
    {
      name: 'ItemComprimento',
      required: false,
      type: 'string',
      description:
        'Comprimento da linha, em metros. Quando vazio, usa a dimensão cadastrada no produto.',
      example: '1,90',
      validate: async (value: string) => {
        if (!value) return null;

        const meters = Number(
          value.trim().replace(/\s/g, '').replace(',', '.'),
        );
        if (isNaN(meters)) return 'Medida inválida';

        // Guarda de sanidade. Uma peça com mais de 100 m de lado é implausível
        // no ramo, e uma medida fora de escala não gera erro em lugar nenhum:
        // entra como número válido e distorce área e preço em silêncio. Foi
        // assim que 3,5 m virou 3,5 km numa carga inteira.
        if (meters > 100) {
          return {
            error: `Medida de ${meters} m parece fora de escala; confira a unidade da origem`,
            severity: 'warning',
          };
        }
        return null;
      },
    },
    {
      name: 'VendaCodigoLegado',
      required: false,
      type: 'string',
      maxLength: 60,
      description:
        'Identificador da venda no sistema legado. É o que torna a importação repetível: com ele, reprocessar reconhece o documento já migrado em vez de duplicá-lo.',
      example: '2154',
    },
    {
      name: 'ReferenciaVenda',
      required: false,
      type: 'string',
      maxLength: 255,
      description:
        'Texto que identifica a venda para o usuário. Aparece como "Referência" no resumo do documento.',
      example: 'ADESIVOS FACHADA',
    },
    {
      name: 'ComissaoVendedorCodigoLegado',
      required: false,
      type: 'string',
      maxLength: 60,
      description:
        'Código do colaborador que recebe a comissão, no legado. Use quando a comissão é do vendedor da casa; tem precedência sobre ComissaoFornecedorCpfCnpj, que vale para comissionado externo.',
      example: '15',
      validate: async (value: string, companyId: string, prisma: any) => {
        if (!value || value.trim() === '') return null;

        const employee = await prisma.employee.findFirst({
          where: { companyId, legacyId: value.trim() },
        });
        if (!employee) {
          return 'Comissionado não encontrado pelo código do legado. Importe os colaboradores antes das vendas';
        }
        return null;
      },
    },
    {
      name: 'CondicaoPagamentoCodigoLegado',
      required: false,
      type: 'string',
      maxLength: 60,
      description:
        'Código da condição de pagamento no legado. Tem precedência sobre CondicaoPagamento e é obrigatório quando o nome se repete no cadastro.',
      example: '3',
      validate: async (value: string, companyId: string, prisma: any) => {
        if (!value || value.trim() === '') return null;

        const condition = await prisma.paymentCondition.findFirst({
          where: { companyId, legacyId: value.trim() },
        });
        if (!condition) {
          return 'Condição de pagamento não encontrada pelo código do legado';
        }
        return null;
      },
    },
    {
      name: 'ClienteCodigoLegado',
      required: false,
      type: 'string',
      maxLength: 60,
      description:
        'Código do cliente no sistema legado. Tem precedência sobre ClienteCpfCnpj e é o único caminho para clientes sem documento.',
      example: '482',
      validate: async (value: string, companyId: string, prisma: any) => {
        if (!value || value.trim() === '') return null;

        const client = await prisma.client.findFirst({
          where: { companyId, legacyId: value.trim() },
        });
        if (!client) {
          return 'Cliente não encontrado pelo código do legado. Importe os clientes antes das vendas';
        }
        return null;
      },
    },
    {
      name: 'NumeroVenda',
      required: true,
      type: 'number',
      description: 'Número único da ordem de serviço',
      example: '1',
    },
    {
      name: 'Serie',
      required: true,
      type: 'string',
      maxLength: 10,
      description: 'Série da ordem de serviço',
      example: 'V1',
      validate: async (
        value: string,
        companyId: string,
        prisma: any,
        row: any,
        allowOverride: boolean = false,
      ) => {
        const series = await prisma.saleSeries.findFirst({
          where: {
            code: value,
            companyId,
            isActive: true,
          },
        });
        if (!series) {
          // Na migração a série é criada pela carga: o documento antigo
          // precisa manter o número que tinha no legado.
          if (allowOverride) {
            return {
              error: `Série '${value}' não existe na conta: a carga vai criá-la`,
              severity: 'warning',
            };
          }
          return 'Série não encontrada. Cadastre a série antes de importar';
        }
        return null;
      },
    },
    {
      name: 'StatusOrdem',
      required: true,
      type: 'string',
      maxLength: 50,
      description: 'Status da ordem: IN_PRODUCTION, FINISHED, CANCELED',
      example: 'IN_PRODUCTION',
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
      name: 'DataEntrega',
      required: false,
      type: 'date',
      description: 'Data de entrega prevista',
      example: '2024-02-20',
    },
    {
      name: 'ClienteCpfCnpj',
      required: false,
      type: 'string',
      maxLength: 18,
      description: 'CPF ou CNPJ do cliente (apenas números ou formatado)',
      example: '12345678900 ou 12.345.678/0001-90',
      validate: async (
        value: string,
        companyId: string,
        prisma: any,
        row: any,
      ) => {
        // Quando a linha traz o codigo do legado, e ele quem identifica o
        // cliente - inclusive os 29% que nao tem documento nenhum.
        if (row?.ClienteCodigoLegado?.trim()) return null;

        // Remover formatação
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
          // Buscar todos os clientes da empresa e comparar CPF/CNPJ limpo
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
      name: 'ClienteNome',
      required: false,
      type: 'string',
      maxLength: 255,
      description: 'Nome do cliente (opcional, usado apenas para referência)',
      example: 'João Silva',
    },
    {
      name: 'VendedorEmail',
      required: false,
      type: 'string',
      maxLength: 255,
      description:
        'Email do vendedor. Se ficar vazio, usa um vendedor ativo da empresa',
      example: 'vendedor@empresa.com',
      validate: async (
        value: string,
        companyId: string,
        prisma: any,
        row: any,
      ) => {
        if (!value || value.trim() === '') return null;
        // Quando a linha traz o código do legado, é ele quem manda.
        if (row?.VendedorCodigoLegado?.trim()) return null;

        // Sem filtro de ativo: vendedor desligado continua respondendo pelo
        // histórico que ele fez enquanto estava na empresa.
        const employee = await prisma.employee.findFirst({
          where: {
            user: {
              email: value,
            },
            companyId,
          },
        });
        if (!employee) {
          return 'Vendedor não encontrado. Cadastre o vendedor antes de importar';
        }
        return null;
      },
    },
    {
      name: 'VendedorCodigoLegado',
      required: false,
      type: 'string',
      maxLength: 60,
      description:
        'Código do vendedor no sistema legado. Tem precedência sobre VendedorEmail e é o caminho usado na migração, porque não depende de conta de usuário.',
      example: '15',
      validate: async (value: string, companyId: string, prisma: any) => {
        if (!value || value.trim() === '') return null;

        const employee = await prisma.employee.findFirst({
          where: { companyId, legacyId: value.trim() },
        });
        if (!employee) {
          return 'Vendedor não encontrado pelo código do legado. Importe os colaboradores antes das vendas';
        }
        return null;
      },
    },
    {
      name: 'ResponsavelNome',
      required: false,
      type: 'string',
      maxLength: 255,
      description: 'Nome do contato/responsável do cliente',
      example: 'Maria Santos',
      validate: async (
        value: string,
        companyId: string,
        prisma: any,
        row: any,
      ) => {
        if (!value) return null;

        const cleanCpfCnpj = (row.ClienteCpfCnpj || '').replace(/[^\d]/g, '');
        const client = await prisma.client.findFirst({
          where: {
            companyId,
            OR: [
              { cpf: { contains: cleanCpfCnpj } },
              { cnpj: { contains: cleanCpfCnpj } },
            ],
          },
        });

        if (!client) return null;

        const contact = await prisma.contact.findFirst({
          where: {
            name: value,
            clientId: client.id,
          },
        });

        if (!contact) {
          return `Contato '${value}' não encontrado para este cliente`;
        }
        return null;
      },
    },
    {
      name: 'ResponsavelEmail',
      required: false,
      type: 'string',
      maxLength: 255,
      description:
        'Email do contato/responsável do cliente (alternativo ao nome)',
      example: 'maria@empresa.com',
      validate: async (
        value: string,
        companyId: string,
        prisma: any,
        row: any,
      ) => {
        if (!value) return null;

        const cleanCpfCnpj = (row.ClienteCpfCnpj || '').replace(/[^\d]/g, '');
        const client = await prisma.client.findFirst({
          where: {
            companyId,
            OR: [
              { cpf: { contains: cleanCpfCnpj } },
              { cnpj: { contains: cleanCpfCnpj } },
            ],
          },
        });

        if (!client) return null;

        const contact = await prisma.contact.findFirst({
          where: {
            email: value,
            clientId: client.id,
          },
        });

        if (!contact) {
          return `Contato com email '${value}' não encontrado para este cliente`;
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
    // === CAMPOS FINANCEIROS (opcionais, apenas na primeira linha de cada ordem) ===
    {
      name: 'CondicaoPagamento',
      required: false,
      type: 'string',
      maxLength: 100,
      description: 'Nome da condição de pagamento',
      example: 'Boleto',
      validate: async (value: string, companyId: string, prisma: any) => {
        if (!value) return null;
        const paymentCondition = await prisma.paymentCondition.findFirst({
          where: {
            name: value,
            companyId,
            isActive: true,
          },
        });
        if (!paymentCondition) {
          return 'Condição de pagamento não encontrada';
        }
        return null;
      },
    },
    {
      name: 'QtdParcelas',
      required: false,
      type: 'number',
      description: 'Quantidade de parcelas',
      example: '3',
    },
    {
      name: 'Parcela1Valor',
      required: false,
      type: 'decimal',
      description: 'Valor da 1ª parcela',
      example: '400.00',
    },
    {
      name: 'Parcela1Vencimento',
      required: false,
      type: 'date',
      description: 'Vencimento da 1ª parcela',
      example: '2024-02-15',
    },
    {
      name: 'Parcela2Valor',
      required: false,
      type: 'decimal',
      description: 'Valor da 2ª parcela',
      example: '400.00',
    },
    {
      name: 'Parcela2Vencimento',
      required: false,
      type: 'date',
      description: 'Vencimento da 2ª parcela',
      example: '2024-03-15',
    },
    {
      name: 'Parcela3Valor',
      required: false,
      type: 'decimal',
      description: 'Valor da 3ª parcela',
      example: '350.00',
    },
    {
      name: 'Parcela3Vencimento',
      required: false,
      type: 'date',
      description: 'Vencimento da 3ª parcela',
      example: '2024-04-15',
    },
    {
      name: 'EntradaValor',
      required: false,
      type: 'decimal',
      description: 'Valor da entrada',
      example: '200.00',
    },
    {
      name: 'EntradaVencimento',
      required: false,
      type: 'date',
      description: 'Vencimento da entrada',
      example: '2024-01-15',
    },
    // === CAMPOS DE FRETE ===
    {
      name: 'TipoEntrega',
      required: false,
      type: 'string',
      maxLength: 20,
      description: 'Tipo de entrega: PICKUP (retira) ou CARRIER (entrega)',
      example: 'CARRIER',
    },
    {
      name: 'FreteCusto',
      required: false,
      type: 'decimal',
      description: 'Custo do frete (despesa)',
      example: '150.00',
    },
    {
      name: 'FreteValor',
      required: false,
      type: 'decimal',
      description: 'Valor do frete cobrado do cliente',
      example: '200.00',
    },
    {
      name: 'FreteFornecedorCpfCnpj',
      required: false,
      type: 'string',
      maxLength: 18,
      description: 'CPF/CNPJ do transportador',
      example: '12345678000190',
      validate: async (value: string, companyId: string, prisma: any) => {
        if (!value) return null;
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
          return 'Transportador não encontrado. Cadastre o fornecedor antes de importar';
        }
        return null;
      },
    },
    // === CAMPOS DE COMISSÃO ===
    {
      name: 'ComissaoValor',
      required: false,
      type: 'decimal',
      description: 'Valor total da comissão',
      example: '100.00',
    },
    {
      name: 'ComissaoFornecedorCpfCnpj',
      required: false,
      type: 'string',
      maxLength: 18,
      description: 'CPF/CNPJ do comissionado',
      example: '12345678900',
      validate: async (value: string, companyId: string, prisma: any) => {
        if (!value) return null;
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
          return 'Comissionado não encontrado. Cadastre o fornecedor antes de importar';
        }
        return null;
      },
    },
    {
      name: 'ComissaoRepasse',
      required: false,
      type: 'string',
      maxLength: 20,
      description:
        'Forma de repasse: SINGLE (única) ou PAYMENT_BASED (por parcela)',
      example: 'SINGLE',
    },
  ],

  /**
   * O cliente precisa de pelo menos um identificador. Como as duas colunas
   * sao opcionais isoladamente, a regra so pode ser avaliada na linha inteira.
   */
  validateRow: async (row: any) => {
    const hasLegacyId = row.ClienteCodigoLegado?.trim();
    const hasDocument = row.ClienteCpfCnpj?.trim();

    if (!hasLegacyId && !hasDocument) {
      return "Informe 'ClienteCodigoLegado' ou 'ClienteCpfCnpj' para identificar o cliente";
    }
    return null;
  },
};
