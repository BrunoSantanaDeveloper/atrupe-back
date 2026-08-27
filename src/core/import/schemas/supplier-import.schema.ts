export const SUPPLIER_IMPORT_SCHEMA = {
  fields: [
    {
      name: 'codigoLegado',
      required: false,
      type: 'string',
      maxLength: 60,
      description:
        'Identificador do fornecedor no sistema legado. Na migração é o que evita duplicar a base ao reprocessar, já que boa parte dos fornecedores não tem CPF/CNPJ.',
      example: '12',
    },
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
          ![
            'PESSOA',
            'EMPRESA',
            'PERSON',
            'COMPANY',
            'F',
            'J',
            'CPF',
            'CNPJ',
          ].includes(value.toUpperCase())
        ) {
          return 'Tipo deve ser PESSOA, EMPRESA, F, J, CPF ou CNPJ';
        }
        return null;
      },
    },
    {
      name: 'cpf',
      required: false,
      type: 'string',
      description: 'CPF do fornecedor (com ou sem pontuação)',
      example: '123.456.789-00',
      validate: async (value: string) => {
        if (!value) return null;

        // Limpar e completar zeros (Excel remove zeros à esquerda)
        let cpfClean = value.replace(/\D/g, '');
        if (cpfClean.length < 11 && cpfClean.length >= 9) {
          cpfClean = cpfClean.padStart(11, '0');
        }
        if (cpfClean.length !== 11) {
          return 'Formato de CPF inválido (deve ter 11 dígitos)';
        }

        return null;
      },
    },
    {
      name: 'cnpj',
      required: false,
      type: 'string',
      description: 'CNPJ da empresa (com ou sem pontuação)',
      example: '12.345.678/0001-90',
      validate: async (value: string) => {
        if (!value) return null;

        // Limpar e completar zeros (Excel remove zeros à esquerda)
        let cnpjClean = value.replace(/\D/g, '');
        if (cnpjClean.length < 14 && cnpjClean.length >= 12) {
          cnpjClean = cnpjClean.padStart(14, '0');
        }
        if (cnpjClean.length !== 14) {
          return 'Formato de CNPJ inválido (deve ter 14 dígitos)';
        }

        return null;
      },
    },
    {
      name: 'telefone',
      required: false,
      type: 'string',
      maxLength: 100,
      description: 'Telefone (múltiplos números separados por /)',
      example: '(11) 3333-4444 / (11) 3333-5555',
    },
    {
      name: 'celular',
      required: false,
      type: 'string',
      maxLength: 100,
      description: 'Celular (múltiplos números separados por /)',
      example: '(11) 99999-8888 / (11) 98888-7777',
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
      name: 'grupo',
      required: false,
      type: 'string',
      maxLength: 255,
      description: 'Grupo do fornecedor (será criado se não existir)',
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
      maxLength: 100,
      description: 'Telefone do responsável',
      example: '(11) 3333-4444',
    },
    {
      name: 'responsavelCelular',
      required: false,
      type: 'string',
      maxLength: 100,
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
