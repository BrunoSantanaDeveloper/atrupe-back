export const PRODUCT_IMPORT_SCHEMA = {
  fields: [
    {
      name: 'codigo',
      required: true,
      type: 'string',
      maxLength: 100,
      description: 'Código único do produto',
      example: 'PROD-001',
      validate: async (
        value: string,
        companyId: string,
        prisma: any,
        row: any,
        allowOverride: boolean = false,
      ) => {
        if (allowOverride) return null; // Ignora bloqueio de duplicadas
        const existing = await prisma.product.findFirst({
          where: {
            code: { equals: value, mode: 'insensitive' },
            companyId,
          },
        });
        if (existing) {
          return `Já existe um produto com este código: "${existing.name}"`;
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
      name: 'grupo',
      required: false,
      type: 'string',
      maxLength: 255,
      description:
        'Nome do grupo de produtos (será criado se não existir). Se vazio, usa o primeiro grupo do setor.',
      example: 'Impressos Comerciais',
    },
    {
      name: 'setor',
      required: true,
      type: 'string',
      maxLength: 255,
      description: 'Nome do setor',
      example: 'IMPRESSAO',
      validate: async (value: string, companyId: string, prisma: any) => {
        // Busca case-insensitive direta
        let sector = await prisma.companySector.findFirst({
          where: {
            name: { equals: value, mode: 'insensitive' },
            companyId,
          },
        });
        // Fallback: busca sem acentos (ex: "Impressao" → "Impressão")
        if (!sector) {
          const normalize = (s: string) =>
            s
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .toLowerCase();
          const sectors = await prisma.companySector.findMany({
            where: { companyId },
          });
          sector = sectors.find(
            (s: any) => normalize(s.name) === normalize(value),
          );
        }
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
      name: 'permitirEditarValor',
      required: false,
      type: 'string',
      description: 'Permitir editar valor (SIM/NAO)',
      example: 'SIM',
    },
    {
      name: 'permitirEditarDescricao',
      required: false,
      type: 'string',
      description: 'Permitir editar descrição (SIM/NAO)',
      example: 'SIM',
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
