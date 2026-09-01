/**
 * Normaliza para comparação: sem acento, sem caixa, sem espaço nas pontas.
 * Ex.: "Impressao" casa com "Impressão", "  vendedor " casa com "Vendedor".
 */
const normalizeName = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

/**
 * Busca por nome tolerante a caixa e acento, sempre restrita à empresa.
 *
 * A validação e a importação precisam usar exatamente a mesma regra: se
 * divergirem, o CSV passa na validação e a linha entra sem o vínculo — o tipo
 * de perda silenciosa que a migração não pode ter.
 */
export async function findCompanyRecordByName(
  prisma: any,
  model: 'companySector' | 'role' | 'sellerProfile',
  companyId: string,
  value: string,
) {
  const name = value?.trim();
  if (!name) return null;

  const direct = await prisma[model].findFirst({
    where: { name: { equals: name, mode: 'insensitive' }, companyId },
  });
  if (direct) return direct;

  const all = await prisma[model].findMany({ where: { companyId } });
  return (
    all.find((r: any) => normalizeName(r.name) === normalizeName(name)) || null
  );
}

const requireExisting =
  (
    model: 'companySector' | 'role' | 'sellerProfile',
    label: string,
    hint: string,
  ) =>
  async (value: string, companyId: string, prisma: any) => {
    if (!value) return null;
    const found = await findCompanyRecordByName(
      prisma,
      model,
      companyId,
      value,
    );
    if (found) return null;

    // Aviso, não reprovação: a migração traz o colaborador, mas não cria cargo,
    // setor nem perfil de vendedor. Barrar a pessoa por causa de um vínculo que
    // decidimos não importar perderia o colaborador — e com ele o histórico de
    // vendas, que depende dele obrigatoriamente.
    return { error: `${label} não encontrado. ${hint}`, severity: 'warning' };
  };

export const EMPLOYEE_IMPORT_SCHEMA = {
  fields: [
    {
      name: 'codigoLegado',
      required: true,
      type: 'string',
      maxLength: 60,
      description:
        'Identificador do colaborador no sistema legado. É a chave que liga as vendas ao vendedor — sem ela o histórico não encontra quem vendeu.',
      example: '15',
    },
    {
      name: 'nome',
      required: true,
      type: 'string',
      maxLength: 255,
      description: 'Nome do colaborador',
      example: 'ANA VENDEDORA',
    },
    {
      name: 'cpf',
      required: false,
      type: 'string',
      description: 'CPF (com ou sem pontuação)',
      example: '123.456.789-09',
      validate: async (value: string) => {
        if (!value) return null;
        let cpf = value.replace(/\D/g, '');
        // Excel remove zeros à esquerda ao abrir o CSV
        if (cpf.length < 11 && cpf.length >= 9) cpf = cpf.padStart(11, '0');
        if (cpf.length !== 11) {
          return 'Formato de CPF inválido (deve ter 11 dígitos)';
        }
        return null;
      },
    },
    {
      name: 'rg',
      required: false,
      type: 'string',
      maxLength: 25,
      description: 'RG do colaborador',
      example: '1234567',
    },
    {
      name: 'telefone',
      required: false,
      type: 'string',
      maxLength: 20,
      description: 'Telefone fixo',
      example: '(11) 3333-4444',
    },
    {
      name: 'celular',
      required: false,
      type: 'string',
      maxLength: 20,
      description: 'Celular',
      example: '(11) 98888-7777',
    },
    {
      name: 'setor',
      required: false,
      type: 'string',
      maxLength: 255,
      description:
        'Nome do setor. Precisa já existir na empresa — deixe vazio se não quiser vincular.',
      example: 'Comercial',
      validate: requireExisting(
        'companySector',
        'Setor',
        'O colaborador entra sem setor.',
      ),
    },
    {
      name: 'cargo',
      required: false,
      type: 'string',
      maxLength: 255,
      description:
        'Nome do cargo. Precisa já existir na empresa — deixe vazio se não quiser vincular.',
      example: 'Vendedor',
      validate: requireExisting(
        'role',
        'Cargo',
        'O colaborador entra sem cargo.',
      ),
    },
    {
      name: 'perfilVendedor',
      required: false,
      type: 'string',
      maxLength: 255,
      description:
        'Nome do perfil de vendedor. Precisa já existir na empresa. É onde ficam comissão, desconto máximo e valor mínimo de venda.',
      example: 'Vendedor Comissionado',
      validate: requireExisting(
        'sellerProfile',
        'Perfil de vendedor',
        'O colaborador entra sem perfil de vendedor, e portanto sem comissão.',
      ),
    },
    {
      name: 'salario',
      required: false,
      type: 'string',
      description: 'Salário base em reais',
      example: '1697,00',
      validate: async (value: string) => {
        if (!value) return null;
        const parsed = Number(
          value
            .trim()
            .replace(/\s/g, '')
            .replace(/\.(?=\d{3}(?:\D|$))/g, '')
            .replace(',', '.'),
        );
        if (isNaN(parsed)) return 'Salário inválido';
        if (parsed < 0) return 'Salário não pode ser negativo';
        return null;
      },
    },
    {
      name: 'ativo',
      required: false,
      type: 'string',
      description:
        'SIM ou NAO. Colaboradores desligados devem vir como NAO e ainda assim ser importados: eles aparecem no histórico de vendas.',
      example: 'SIM',
      validate: async (value: string) => {
        if (!value) return null;
        const v = value.trim().toUpperCase();
        const accepted = [
          'SIM',
          'S',
          'TRUE',
          '1',
          'YES',
          'NAO',
          'NÃO',
          'N',
          'FALSE',
          '0',
          'NO',
        ];
        if (!accepted.includes(v)) {
          return 'Valor deve ser SIM ou NAO';
        }
        return null;
      },
    },
  ],
};
