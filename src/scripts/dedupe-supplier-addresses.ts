import { PrismaClient } from '@prisma/client';
import { resolveCompanyByEmail } from './preflight-financial-import';

/**
 * Apaga as cópias de endereço que a edição de fornecedor foi acumulando.
 *
 * O endereço do fornecedor é ligado por `supplierId` — `ownerId` é do
 * cliente. A gravação do fornecedor apagava os endereços pelo `ownerId`, que
 * nele é sempre nulo: nada saía, e os endereços do formulário entravam de
 * novo. Cada vez que o cadastro era salvo o mesmo endereço aparecia uma vez
 * a mais (um fornecedor da base chegou a 32 cópias).
 *
 * Mantém uma cópia de cada endereço e apaga as iguais. Antes de apagar, leva
 * para a cópia mantida qualquer entrega que aponte para as outras, para não
 * perder o vínculo. Sem `--yes` apenas relata.
 *
 * Uso:
 *   npm run fornecedores:enderecos -- <email> [--yes]
 *   npm run fornecedores:enderecos -- --company-id=<id> [--yes]
 *   npm run fornecedores:enderecos -- --all [--yes]
 */

export interface SupplierAddress {
  id: string;
  supplierId: string | null;
  type: string | null;
  zipcode: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
}

export interface AddressGroup {
  manter: string;
  remover: string[];
}

export interface DedupeAddressSummary {
  enderecos: number;
  grupos: number;
  remover: number;
  fornecedores: number;
}

const texto = (valor: string | null | undefined) =>
  (valor ?? '').trim().toUpperCase().replace(/\s+/g, ' ');

/**
 * Chave do endereço: o fornecedor e o endereço em si. O CEP entra só com os
 * dígitos porque a base tem os dois jeitos ("13.389-200" e "13389200").
 */
function key(address: SupplierAddress): string {
  return [
    address.supplierId ?? '',
    texto(address.type),
    (address.zipcode ?? '').replace(/[^0-9]/g, ''),
    texto(address.street),
    texto(address.number),
    texto(address.complement),
    texto(address.neighborhood),
    texto(address.city),
    texto(address.state),
  ].join('|');
}

/**
 * Grupos de endereços iguais, com a cópia que fica e as que saem.
 *
 * Endereço não tem data de criação, então a cópia mantida é a de menor id —
 * escolha estável, que dá o mesmo resultado se o reparo rodar duas vezes.
 */
export function duplicateAddressGroups(
  addresses: SupplierAddress[],
): AddressGroup[] {
  const grupos = new Map<string, SupplierAddress[]>();

  for (const address of addresses) {
    const k = key(address);
    grupos.set(k, [...(grupos.get(k) ?? []), address]);
  }

  const repetidos: AddressGroup[] = [];

  for (const grupo of grupos.values()) {
    if (grupo.length < 2) continue;

    const ordenado = [...grupo].sort((a, b) => a.id.localeCompare(b.id));

    repetidos.push({
      manter: ordenado[0].id,
      remover: ordenado.slice(1).map((a) => a.id),
    });
  }

  return repetidos;
}

export async function dedupeSupplierAddresses(
  prisma: PrismaClient,
  companyId: string | null,
  options: { apply?: boolean } = {},
): Promise<DedupeAddressSummary> {
  const { apply = false } = options;

  const addresses = await prisma.address.findMany({
    where: {
      supplierId: { not: null },
      ...(companyId ? { supplier: { companyId } } : {}),
    },
    select: {
      id: true,
      supplierId: true,
      type: true,
      zipcode: true,
      street: true,
      number: true,
      complement: true,
      neighborhood: true,
      city: true,
      state: true,
    },
    orderBy: { id: 'asc' },
  });

  const grupos = duplicateAddressGroups(addresses);
  const remover = grupos.flatMap((g) => g.remover);

  if (apply) {
    for (const grupo of grupos) {
      // A entrega aponta para o endereço: antes de apagar a cópia, a entrega
      // passa para a que fica (são o mesmo endereço).
      await prisma.deliveryInfo.updateMany({
        where: { clientAddressId: { in: grupo.remover } },
        data: { clientAddressId: grupo.manter },
      });
    }

    await prisma.address.deleteMany({ where: { id: { in: remover } } });
  }

  return {
    enderecos: addresses.length,
    grupos: grupos.length,
    remover: remover.length,
    fornecedores: new Set(
      addresses
        .filter((a) => grupos.some((g) => g.remover.includes(a.id)))
        .map((a) => a.supplierId),
    ).size,
  };
}

function flagValue(args: string[], name: string): string | undefined {
  const prefixo = `--${name}=`;
  return args.find((a) => a.startsWith(prefixo))?.slice(prefixo.length);
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--yes');
  const todas = args.includes('--all');
  const companyIdFlag = flagValue(args, 'company-id');
  const [email] = args.filter((a) => !a.startsWith('--'));

  if (!todas && !companyIdFlag && !email) {
    console.error(
      'Uso: npm run fornecedores:enderecos -- <email> [--yes]\n' +
        '     npm run fornecedores:enderecos -- --company-id=<id> [--yes]\n' +
        '     npm run fornecedores:enderecos -- --all [--yes]',
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();

  try {
    let companyId: string | null = companyIdFlag ?? null;
    let companyName = companyIdFlag ?? 'todas as empresas';

    if (!todas && !companyId) {
      const resolvido = await resolveCompanyByEmail(prisma, email);
      companyId = resolvido.companyId;
      companyName = resolvido.companyName;
    }

    if (todas) {
      companyId = null;
      companyName = 'todas as empresas';
    }

    console.log(`Empresa: ${companyName}${companyId ? ` (${companyId})` : ''}`);
    console.log(
      apply
        ? 'Modo:    apagando\n'
        : 'Modo:    simulação (use --yes para apagar)\n',
    );

    const summary = await dedupeSupplierAddresses(prisma, companyId, { apply });

    console.log(`Endereços de fornecedor: ${summary.enderecos}`);
    console.log(
      `Repetidos: ${summary.grupos} endereços com cópia, ` +
        `${summary.remover} a remover, em ${summary.fornecedores} fornecedores`,
    );
    console.log(apply ? '\nCópias removidas.' : '\nNada foi apagado.');
  } catch (error: any) {
    console.error(`\nFalhou: ${error.message}`);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main();
}
