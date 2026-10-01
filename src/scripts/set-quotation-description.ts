import { PrismaClient } from '@prisma/client';

/**
 * Escreve a descrição de um orçamento ou ordem de serviço direto no banco.
 *
 * É a saída para o documento que a tela não consegue salvar. A edição na tela
 * reenvia o documento inteiro — itens, pagamento, entrega — e um dado antigo
 * em qualquer uma dessas partes derruba a gravação toda, mesmo quando a única
 * mudança é na descrição. Em vez de prender o suporte nesse caso, este script
 * grava só o campo pedido e não toca em mais nada.
 *
 * Simula por padrão; grava com --yes.
 *
 * Uso:
 *   npx ts-node src/scripts/set-quotation-description.ts \
 *     --id=<uuid> --description="23-09" [--yes]
 *
 *   npx ts-node src/scripts/set-quotation-description.ts \
 *     --company-id=<uuid> --number=9162 --series=LEG-V1 \
 *     --description="23-09" [--yes]
 *
 * No servidor, dentro do contêiner da API:
 *   node dist/scripts/set-quotation-description.js --id=<uuid> \
 *     --description="23-09" --yes
 */

export interface Selector {
  id?: string;
  companyId?: string;
  number?: number;
  series?: string;
}

export interface DescriptionChange {
  id: string;
  documento: string;
  antes: string | null;
  depois: string;
  alterado: boolean;
}

/**
 * Por id, ou pelo número do documento dentro da empresa.
 *
 * O número se repete entre as séries — a migração cria uma série própria para
 * o histórico do legado —, então sem a série a busca pode trazer dois.
 */
export function quotationWhere(selector: Selector): Record<string, unknown> {
  if (selector.id) return { id: selector.id };

  if (!selector.companyId || !selector.number) {
    throw new Error('Informe --id, ou --company-id com --number.');
  }

  return {
    companyId: selector.companyId,
    quotationNumber: selector.number,
    ...(selector.series ? { series: { code: selector.series } } : {}),
  };
}

/** Rótulo do documento como a tela mostra: número e série. */
export function documentLabel(doc: {
  quotationNumber: number | null;
  series: { code: string } | null;
}): string {
  const numero = doc.quotationNumber ?? '?';
  return doc.series?.code ? `${numero}-${doc.series.code}` : `${numero}`;
}

export async function setQuotationDescription(
  prisma: PrismaClient,
  selector: Selector,
  description: string,
  options: { apply?: boolean } = {},
): Promise<DescriptionChange> {
  const { apply = false } = options;

  const encontrados = await prisma.quotation.findMany({
    where: quotationWhere(selector) as any,
    select: {
      id: true,
      description: true,
      quotationNumber: true,
      series: { select: { code: true } },
    },
  });

  if (!encontrados.length) {
    throw new Error('Nenhum documento encontrado com esses dados.');
  }

  if (encontrados.length > 1) {
    const lista = encontrados
      .map((doc) => `${documentLabel(doc)} (${doc.id})`)
      .join(', ');

    throw new Error(
      `${encontrados.length} documentos atendem à busca: ${lista}. ` +
        'Informe --series ou --id.',
    );
  }

  const doc = encontrados[0];
  const alterado = (doc.description ?? '') !== description;

  if (alterado && apply) {
    await prisma.quotation.update({
      where: { id: doc.id },
      data: { description },
    });
  }

  return {
    id: doc.id,
    documento: documentLabel(doc),
    antes: doc.description,
    depois: description,
    alterado,
  };
}

function flagValue(args: string[], name: string): string | undefined {
  const prefixo = `--${name}=`;
  return args.find((a) => a.startsWith(prefixo))?.slice(prefixo.length);
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--yes');
  const description = flagValue(args, 'description');
  const numero = flagValue(args, 'number');

  const selector: Selector = {
    id: flagValue(args, 'id'),
    companyId: flagValue(args, 'company-id'),
    number: numero ? Number(numero) : undefined,
    series: flagValue(args, 'series'),
  };

  if (description === undefined) {
    console.error(
      'Uso: ts-node src/scripts/set-quotation-description.ts --id=<uuid> ' +
        '--description="texto" [--yes]\n' +
        '     ou --company-id=<uuid> --number=<n> [--series=<codigo>] ' +
        '--description="texto" [--yes]',
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();

  try {
    const mudanca = await setQuotationDescription(
      prisma,
      selector,
      description,
      { apply },
    );

    console.log(`Documento: ${mudanca.documento} (${mudanca.id})`);
    console.log(`Antes:     ${mudanca.antes ?? '(vazio)'}`);
    console.log(`Depois:    ${mudanca.depois || '(vazio)'}`);

    if (!mudanca.alterado) {
      console.log('\nA descrição já é essa. Nada a fazer.');
      return;
    }

    console.log(apply ? '\nGravado.' : '\nSimulação: use --yes para gravar.');
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
