import { PrismaService } from 'nestjs-prisma';

export const SUPPLIER_IMPORT_SCHEMA = {
  fields: [
    {
      name: 'nome',
      required: true,
      type: 'string',
      maxLength: 255,
      description: 'Nome do fornecedor',
      example: 'Fornecedor ABC',
    },
    {
      name: 'email',
      required: false,
      type: 'email',
      description: 'Email do fornecedor',
      example: 'contato@fornecedor.com',
    },
    {
      name: 'tipo',
      required: true,
      type: 'string',
      description: 'Tipo: PESSOA ou EMPRESA (ou F/J)',
      example: 'EMPRESA',
      validate: async (value: string) => {
        if (
          !['PESSOA', 'EMPRESA', 'PERSON', 'COMPANY', 'F', 'J'].includes(
            value.toUpperCase(),
          )
        ) {
          return 'Tipo deve ser PESSOA, EMPRESA, F ou J';
        }
        return null;
      },
    },
    {
      name: 'cpf',
      required: false,
      type: 'string',
      pattern: /^\d{3}\.\d{3}\.\d{3}-\d{2}$|^\d{11}$/,
      description: 'CPF do fornecedor (pessoa física)',
      example: '123.456.789-00',
      validate: async (
        value: string,
        companyId: string,
        prisma: PrismaService,
      ) => {
        if (!value) return null;

        // Validar CPF
        const cpfClean = value.replace(/\D/g, '');
        if (cpfClean.length !== 11) {
          return 'Formato de CPF inválido';
        }

        // Verificar duplicata
        const existing = await prisma.supplier.findFirst({
          where: { cpf: value, companyId },
        });

        if (existing) {
          return `CPF já existe para o fornecedor: ${existing.name}`;
        }

        return null;
      },
    },
    {
      name: 'cnpj',
      required: false,
      type: 'string',
      pattern: /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$|^\d{14}$/,
      description: 'CNPJ da empresa',
      example: '12.345.678/0001-90',
      validate: async (
        value: string,
        companyId: string,
        prisma: PrismaService,
      ) => {
        if (!value) return null;

        // Validar CNPJ
        const cnpjClean = value.replace(/\D/g, '');
        if (cnpjClean.length !== 14) {
          return 'Formato de CNPJ inválido';
        }

        // Verificar duplicata
        const existing = await prisma.supplier.findFirst({
          where: { cnpj: value, companyId },
        });

        if (existing) {
          return `CNPJ já existe para o fornecedor: ${existing.name}`;
        }

        return null;
      },
    },
    {
      name: 'telefone',
      required: false,
      type: 'string',
      maxLength: 20,
      description: 'Telefone',
      example: '(11) 3333-4444',
    },
    {
      name: 'celular',
      required: false,
      type: 'string',
      maxLength: 20,
      description: 'Celular',
      example: '(11) 99999-8888',
    },
    {
      name: 'rg',
      required: false,
      type: 'string',
      maxLength: 20,
      description: 'RG',
      example: '12.345.678-9',
    },
    {
      name: 'razaoSocial',
      required: false,
      type: 'string',
      maxLength: 255,
      description: 'Razão Social',
      example: 'Fornecedor ABC Ltda',
    },
    {
      name: 'categoria',
      required: false,
      type: 'string',
      maxLength: 255,
      description: 'Categoria do fornecedor (será criada se não existir)',
      example: 'Matéria Prima',
    },
    {
      name: 'filial',
      required: false,
      type: 'string',
      description: 'Se é filial (SIM/NAO, S/N, TRUE/FALSE, 1/0)',
      example: 'NAO',
    },
    {
      name: 'responsavelNome',
      required: false,
      type: 'string',
      maxLength: 255,
      description: 'Nome do responsável/contato',
      example: 'Maria Santos',
    },
    {
      name: 'responsavelEmail',
      required: false,
      type: 'email',
      description: 'Email do responsável',
      example: 'maria@empresa.com',
    },
    {
      name: 'responsavelTelefone',
      required: false,
      type: 'string',
      maxLength: 20,
      description: 'Telefone do responsável',
      example: '(11) 3333-4444',
    },
    {
      name: 'responsavelCelular',
      required: false,
      type: 'string',
      maxLength: 20,
      description: 'Celular do responsável',
      example: '(11) 99999-8888',
    },
    {
      name: 'observacoes',
      required: false,
      type: 'string',
      description: 'Observações',
      example: 'Fornecedor desde 2020',
    },
    {
      name: 'cep',
      required: false,
      type: 'string',
      maxLength: 10,
      description: 'CEP',
      example: '01310-100',
    },
    {
      name: 'rua',
      required: false,
      type: 'string',
      maxLength: 255,
      description: 'Logradouro',
      example: 'Av Paulista',
    },
    {
      name: 'numero',
      required: false,
      type: 'string',
      maxLength: 20,
      description: 'Número',
      example: '1000',
    },
    {
      name: 'complemento',
      required: false,
      type: 'string',
      maxLength: 255,
      description: 'Complemento',
      example: 'Galpão 5',
    },
    {
      name: 'bairro',
      required: false,
      type: 'string',
      maxLength: 255,
      description: 'Bairro',
      example: 'Centro',
    },
    {
      name: 'cidade',
      required: false,
      type: 'string',
      maxLength: 255,
      description: 'Cidade',
      example: 'São Paulo',
    },
    {
      name: 'uf',
      required: false,
      type: 'string',
      maxLength: 2,
      description: 'Estado (sigla)',
      example: 'SP',
    },
  ],
};
