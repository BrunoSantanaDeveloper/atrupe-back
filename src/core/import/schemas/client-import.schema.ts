import { PrismaService } from 'nestjs-prisma';

/**
 * Documento repetido: erro no CSV, aviso na migração.
 *
 * Na migração o cadastro que a conta já tem é adotado — recebe o vínculo com o
 * legado em vez de virar uma segunda ficha da mesma pessoa. Só continua sendo
 * erro quando a ficha existente já pertence a outro registro do legado, porque
 * aí a carga criaria mesmo uma duplicata.
 */
function duplicateIssue(
  label: string,
  existing: { name: string; legacyId?: string | null },
  row: any,
  allowOverride: boolean,
) {
  const mesmaOrigem =
    !existing.legacyId || existing.legacyId === row?.codigoLegado?.trim();

  if (allowOverride && mesmaOrigem) {
    return {
      error: `${label} já cadastrado em '${existing.name}': a carga vai usar essa ficha em vez de criar outra`,
      severity: 'warning',
    };
  }

  return `${label} já existe para o cliente: ${existing.name}`;
}

export const CLIENT_IMPORT_SCHEMA = {
  fields: [
    {
      name: 'codigoLegado',
      required: false,
      type: 'string',
      maxLength: 60,
      description:
        'Identificador do cliente no sistema legado. Na migração é obrigatório na prática: é a chave que liga as vendas a clientes sem CPF/CNPJ, e o que evita duplicar a base ao reprocessar o arquivo.',
      example: '482',
    },
    {
      name: 'nome',
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
      name: 'tipo',
      required: true,
      type: 'string',
      description: 'Tipo: PESSOA ou EMPRESA (ou F/J)',
      example: 'PESSOA',
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
      description: 'CPF do cliente (com ou sem pontuação)',
      example: '123.456.789-00',
      validate: async (
        value: string,
        companyId: string,
        prisma: PrismaService,
        row: any,
        allowOverride: boolean = false,
      ) => {
        if (!value) return null;

        // Limpar e completar zeros (Excel remove zeros à esquerda)
        let cpfClean = value.replace(/\D/g, '');
        if (cpfClean.length < 11 && cpfClean.length >= 9) {
          cpfClean = cpfClean.padStart(11, '0');
        }
        if (cpfClean.length !== 11) {
          return 'Formato de CPF inválido (deve ter 11 dígitos)';
        }

        // Verificar duplicata
        const existing = await prisma.client.findFirst({
          where: { cpf: value, companyId },
          select: { name: true, legacyId: true },
        });

        if (existing) {
          return duplicateIssue('CPF', existing, row, allowOverride);
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
      validate: async (
        value: string,
        companyId: string,
        prisma: PrismaService,
        row: any,
        allowOverride: boolean = false,
      ) => {
        if (!value) return null;

        // Limpar e completar zeros (Excel remove zeros à esquerda)
        let cnpjClean = value.replace(/\D/g, '');
        if (cnpjClean.length < 14 && cnpjClean.length >= 12) {
          cnpjClean = cnpjClean.padStart(14, '0');
        }
        if (cnpjClean.length !== 14) {
          return 'Formato de CNPJ inválido (deve ter 14 dígitos)';
        }

        // Verificar duplicata
        const existing = await prisma.client.findFirst({
          where: { cnpj: value, companyId },
          select: { name: true, legacyId: true },
        });

        if (existing) {
          return duplicateIssue('CNPJ', existing, row, allowOverride);
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
      name: 'grupo',
      required: false,
      type: 'string',
      maxLength: 255,
      description: 'Grupo/Categoria do cliente (será criado se não existir)',
      example: 'Varejo',
    },
    {
      name: 'dataNascimento',
      required: false,
      type: 'string',
      description: 'Data de nascimento (formato: DD/MM/AAAA ou AAAA-MM-DD)',
      example: '15/03/1990',
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
      name: 'razaoSocial',
      required: false,
      type: 'string',
      maxLength: 255,
      description: 'Razão Social',
      example: 'Empresa ABC Ltda',
    },
    {
      name: 'observacoes',
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
