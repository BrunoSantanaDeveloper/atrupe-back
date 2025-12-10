import { PrismaService } from 'nestjs-prisma';

export const CLIENT_IMPORT_SCHEMA = {
  fields: [
    {
      name: 'name',
      required: true,
      type: 'string',
      maxLength: 255,
      description: 'Nome do cliente',
      example: 'João Silva',
    },
    {
      name: 'email',
      required: false,
      type: 'email',
      description: 'Email do cliente',
      example: 'joao@example.com',
    },
    {
      name: 'type',
      required: true,
      type: 'string',
      description: 'Tipo: PERSON ou COMPANY (ou F/J)',
      example: 'PERSON',
      validate: async (value: string) => {
        if (!['PERSON', 'COMPANY', 'F', 'J'].includes(value.toUpperCase())) {
          return 'Tipo deve ser PERSON, COMPANY, F ou J';
        }
        return null;
      },
    },
    {
      name: 'cpf',
      required: false,
      type: 'string',
      pattern: /^\d{3}\.\d{3}\.\d{3}-\d{2}$|^\d{11}$/,
      description: 'CPF do cliente',
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
        const existing = await prisma.client.findFirst({
          where: { cpf: value, companyId },
        });

        if (existing) {
          return `CPF já existe para o cliente: ${existing.name}`;
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
        const existing = await prisma.client.findFirst({
          where: { cnpj: value, companyId },
        });

        if (existing) {
          return `CNPJ já existe para o cliente: ${existing.name}`;
        }

        return null;
      },
    },
    {
      name: 'phone',
      required: false,
      type: 'string',
      maxLength: 20,
      description: 'Telefone',
      example: '(11) 3333-4444',
    },
    {
      name: 'mobile',
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
      name: 'activity',
      required: false,
      type: 'string',
      maxLength: 255,
      description: 'Atividade/Segmento',
      example: 'Comércio',
    },
    {
      name: 'corporateName',
      required: false,
      type: 'string',
      maxLength: 255,
      description: 'Razão Social',
      example: 'Empresa ABC Ltda',
    },
    {
      name: 'notes',
      required: false,
      type: 'string',
      description: 'Observações',
      example: 'Cliente desde 2020',
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
      example: 'Sala 101',
    },
    {
      name: 'bairro',
      required: false,
      type: 'string',
      maxLength: 255,
      description: 'Bairro',
      example: 'Bela Vista',
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
