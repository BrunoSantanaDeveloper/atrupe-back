import { PrismaClient } from '@prisma/client';
import * as mysql from 'mysql2/promise';
import { ImportService } from '../core/import/import.service';
import { ProductFiscalService } from '../core/fiscal/product-fiscal/product-fiscal.service';
import { resolveCompanyByEmail } from './preflight-financial-import';
import {
  EXTRACTORS,
  LEGACY_COMPANY_SQL,
  LegacyExtractor,
} from './legacy-extractors';
import { GENERIC_BANK_CODE } from '../core/import/import-references';
import {
  assertSameCompany,
  assertSingleDestination,
  onlyDigits,
} from './legacy-destination-guard';

// Reexportados: a regra mora no módulo compartilhado com a API.
export { assertSameCompany, onlyDigits } from './legacy-destination-guard';

/**
 * Migra um cliente da versão legada para o Atrupe novo.
 *
 * O fluxo pensado para a operação é: um dev cria a conta do cliente no app
 * novo pelo cadastro normal (que já provisiona empresa e configurações base),
 * passa o e-mail dessa conta e o nome da base legada, e este script preenche
 * o resto.
 *
 * Roda fora do ciclo de requisição HTTP de propósito: não há limite de tempo
 * de request nem o teto de memória do contêiner da API, então o histórico
 * completo cabe sem depender de fila.
 *
 * É idempotente. Todo registro é gravado com o código do legado, então rodar
 * de novo atualiza em vez de duplicar — dá para migrar em partes, conferir, e
 * repetir sem limpar nada.
 *
 * Uso:
 *   npx ts-node src/scripts/migrate-legacy-tenant.ts <email> <base> [--dry-run]
 *
 * Exemplo:
 *   npx ts-node src/scripts/migrate-legacy-tenant.ts importacao@atrupe.com acn_001676 --dry-run
 *
 * Conexão com o legado (variáveis de ambiente):
 *   LEGACY_DB_HOST      padrão 127.0.0.1 (túnel SSH até o RDS)
 *   LEGACY_DB_PORT      padrão 13306
 *   LEGACY_DB_USER      obrigatória
 *   LEGACY_DB_PASSWORD  obrigatória
 */

/**
 * Chaves que cada etapa criaria, para a simulação saber que uma referência
 * "não encontrada" hoje será satisfeita pela etapa anterior na execução real.
 */
export interface SimulatedKeys {
  client: Set<string>;
  employee: Set<string>;
  product: Set<string>;
  paymentCondition: Set<string>;
  /** Cadastros de apoio que a preparação da etapa cria antes da carga. */
  reference: Set<string>;
}

/**
 * Erros cuja causa é apenas a ordem de carga: o campo aponta para um registro
 * que ainda não existe no banco, mas que a etapa anterior vai criar. Casamos
 * pelo nome do campo, não pelo texto da mensagem.
 */
const RESOLVED_BY_LOAD_ORDER: Record<string, keyof SimulatedKeys> = {
  ClienteCodigoLegado: 'client',
  VendedorCodigoLegado: 'employee',
  ProdutoCodigo: 'product',
  CondicaoPagamentoCodigoLegado: 'paymentCondition',
};

/**
 * Campos que apontam para cadastro de apoio criado na preparação da etapa —
 * setor do produto, natureza, subcategoria e conta bancária do financeiro.
 */
const RESOLVED_BY_PREPARATION = new Set([
  'setor',
  'Natureza',
  'SubCategoria',
  'ContaBancaria',
]);

/** Nome comparável: sem acento, sem caixa e sem espaço nas pontas. */
const comparableName = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

/** Campos de documento por etapa, para achar quem a conta já tem cadastrado. */
const ADOPTION_DOCUMENTS: Record<string, (row: any) => any[]> = {
  client: (row) => [row.cnpj, row.cpf],
  supplier: (row) => [row.cnpj, row.cpf],
  employee: (row) => [row.cpf],
};

export interface StepPreparation {
  /** Cadastros de apoio criados, ou a criar quando é simulação. */
  created: string[];
  /** Registros que a conta já tinha e a carga aproveita. */
  adopted: number;
  /** Decisões da etapa que mudam o resultado. */
  notes: string[];
  /** Linhas a processar, quando a etapa descarta alguma. */
  rows: any[];
  /** Cadastros por documento, para a carga adotar em vez de duplicar. */
  adoptionIndex?: Map<string, string>;
  /** A conta já tem documentos próprios: o histórico vai para série separada. */
  historySeries?: boolean;
}

const dataBr = (iso: string) => iso.split('-').reverse().join('/');

/**
 * Decide o que a etapa faz antes de gravar, numa conta que pode não estar
 * vazia: quais cadastros de apoio criar, quais registros existentes aproveitar,
 * em que série o histórico entra e até onde o financeiro vem.
 *
 * Roda igual na simulação e na carga, menos pelo que grava: é o que permite ao
 * relatório da simulação dizer de antemão o que a carga vai fazer.
 */
export async function prepareStep(
  internals: any,
  extractor: LegacyExtractor,
  rows: any[],
  companyId: string,
  dryRun: boolean,
  /** Conta criada só para a migração: traz o histórico inteiro, sem corte. */
  fullHistory = false,
): Promise<StepPreparation> {
  const prep: StepPreparation = {
    created: [],
    adopted: 0,
    notes: [],
    rows,
  };

  const documents = ADOPTION_DOCUMENTS[extractor.entity];
  if (documents) {
    // Quem o cliente cadastrou à mão não tem código do legado: sem adoção, o
    // mesmo cliente entraria de novo e a base ficaria com duas fichas.
    const index = await internals.buildAdoptionIndex(
      extractor.entity,
      companyId,
    );
    prep.adoptionIndex = index;

    const alvos = new Set<string>();
    for (const row of rows) {
      for (const value of documents(row)) {
        const document = onlyDigits(value);
        if (document && index.has(document)) {
          alvos.add(index.get(document));
          break;
        }
      }
    }
    prep.adopted = alvos.size;
  }

  if (extractor.entity === 'product') {
    const { adopted, withoutItem } = await internals.findProductAdoptions(
      rows,
      companyId,
    );
    prep.adopted = adopted.length;

    if (withoutItem.length > 0) {
      prep.notes.push(
        `${withoutItem.length} produto(s) da conta com o mesmo código não têm ` +
          `item cadastrado, e a venda que os usa vai falhar: ` +
          `${withoutItem.slice(0, 10).join(', ')}`,
      );
    }
  }

  if (extractor.entity === 'quotation' || extractor.entity === 'order') {
    prep.historySeries = await internals.hasOwnDocuments(companyId);
    if (prep.historySeries) {
      prep.notes.push(
        'A conta já tem documentos próprios: os migrados entram em série ' +
          'separada (LEG-), com o número original do legado.',
      );
    }

    // A série que o legado indica pode não existir na conta. A carga cria, em
    // vez de recusar a venda: o documento antigo precisa manter o número.
    prep.created.push(
      ...(await internals.findMissingImportSeries(
        rows,
        companyId,
        prep.historySeries,
      )),
    );
  }

  if (extractor.entity === 'financial') {
    const inicio = fullHistory
      ? null
      : await internals.firstNonImportedActivity(companyId);

    if (fullHistory) {
      prep.notes.push(
        'Corte por data desligado: o histórico financeiro entra inteiro, ' +
          'porque a conta foi marcada como não usada pelo cliente.',
      );
    }

    if (inicio) {
      const limite = inicio.toISOString().slice(0, 10);
      const anteriores = rows.filter(
        (row) => !row.DataReferencia || row.DataReferencia < limite,
      );
      const descartadas = rows.length - anteriores.length;

      if (descartadas > 0) {
        prep.rows = anteriores;
        prep.notes.push(
          `${descartadas} lançamento(s) de ${dataBr(limite)} em diante não ` +
            `migrados: a conta já estava em uso nessa data e eles duplicariam ` +
            `o que o cliente lançou.`,
        );
      }
    }
  }

  prep.created.push(
    ...(await prepareReferences(
      internals,
      extractor,
      prep.rows,
      companyId,
      dryRun,
    )),
  );

  return prep;
}

/**
 * Garante os cadastros de apoio de que a etapa depende.
 *
 * A carga não recusa a linha quando o cadastro falta: grava o vínculo vazio, e
 * o produto fica sem setor, a parcela sem conta bancária. Criar aqui, a partir
 * dos nomes que a própria carga traz, é o que preserva esses vínculos.
 *
 * Na simulação nada é gravado — devolve o que seria criado, para a validação
 * não acusar como erro o que a carga real resolve sozinha.
 */
export async function prepareReferences(
  internals: any,
  extractor: LegacyExtractor,
  rows: any[],
  companyId: string,
  dryRun: boolean,
): Promise<string[]> {
  if (extractor.entity === 'product') {
    return dryRun
      ? internals.findMissingSectors(rows, companyId)
      : internals.ensureProductSectors(rows, companyId);
  }

  if (extractor.entity !== 'financial') return [];

  if (!dryRun) {
    const { created, reactivated } = await internals.ensureFinancialReferences(
      rows,
      companyId,
    );
    return [...created, ...reactivated].map((ref: any) => ref.name);
  }

  const missing = await internals.findMissingReferences(rows, companyId);

  // A conta bancária nasce vinculada ao banco genérico. Sem ele, a criação
  // falharia só na carga real, depois de a simulação ter aprovado.
  if (missing.some((ref: any) => ref.type === 'bankAccount')) {
    const bank = await internals.findGenericBank();
    if (!bank) {
      throw new Error(
        `Banco de código ${GENERIC_BANK_CODE} não encontrado: sem ele não dá ` +
          'para criar as contas bancárias que o financeiro do legado cita.',
      );
    }
  }

  return missing.map((ref: any) => ref.name);
}

export interface StepResult {
  label: string;
  extracted: number;
  imported: number;
  failed: number;
  /** Divergências relatadas que não impedem a importação. */
  warnings?: number;
  /** Erros que somem sozinhos na execução real, por causa da ordem de carga. */
  pending?: number;
  /** Documentos já migrados numa execução anterior. */
  skipped?: number;
  /** Cadastros de apoio criados na etapa, ou a criar quando é simulação. */
  created?: string[];
  /** Registros que a conta já tinha e a carga aproveita em vez de duplicar. */
  adopted?: number;
  /** Decisões da etapa: série do histórico, corte por data, riscos. */
  notes?: string[];
  /** Documentos na origem, quando o extrator sabe contar. */
  expected?: number;
  /** Documentos distintos extraídos, quando uma linha não é um documento. */
  documents?: number;
  errors: { row: number; codigoLegado: string; error: string }[];
}

async function runStep(
  service: ImportService,
  legacy: mysql.Connection,
  base: string,
  extractor: LegacyExtractor,
  companyId: string,
  userId: string,
  dryRun: boolean,
  simulated: SimulatedKeys,
  fullHistory: boolean,
): Promise<StepResult> {
  const [rawRows] = await legacy.query(extractor.sql(base));
  const rows = (rawRows as any[]).map(extractor.map);

  const result: StepResult = {
    label: extractor.label,
    extracted: rows.length,
    imported: 0,
    failed: 0,
    errors: [],
  };

  if (extractor.documentKey) {
    result.documents = new Set(rows.map(extractor.documentKey)).size;
  }

  if (extractor.expectedSql) {
    const [countRows] = await legacy.query(extractor.expectedSql(base));
    result.expected = Number((countRows as any[])[0]?.total ?? 0);
  }

  // Registra o que esta etapa disponibiliza para as seguintes.
  if (extractor.entity === 'client') {
    rows.forEach((r) => simulated.client.add(r.codigoLegado));
  } else if (extractor.entity === 'employee') {
    rows.forEach((r) => simulated.employee.add(r.codigoLegado));
  } else if (extractor.entity === 'product') {
    rows.forEach((r) => simulated.product.add(r.codigo));
  } else if (extractor.entity === 'paymentCondition') {
    rows.forEach((r) => simulated.paymentCondition.add(r.codigoLegado));
  }

  const internals = service as any;

  const prep = await prepareStep(
    internals,
    extractor,
    rows,
    companyId,
    dryRun,
    fullHistory,
  );
  if (prep.created.length > 0) {
    result.created = prep.created;
    prep.created.forEach((name) =>
      simulated.reference.add(comparableName(name)),
    );
  }
  if (prep.adopted > 0) result.adopted = prep.adopted;
  if (prep.notes.length > 0) result.notes = prep.notes;

  // O financeiro pode ter descartado linhas pelo corte por data.
  const linhas = prep.rows;

  // Vendas e financeiro são processados em lote: o importador agrupa várias
  // linhas no mesmo documento, então não dá para tratar linha a linha.
  const BATCH_ENTITIES: Record<string, string> = {
    quotation: 'importQuotations',
    order: 'importOrders',
    financial: 'importFinancial',
  };

  if (!dryRun && BATCH_ENTITIES[extractor.entity]) {
    const method = BATCH_ENTITIES[extractor.entity];
    // O contas a receber vem do financeiro do legado, com as parcelas reais.
    const args =
      extractor.entity === 'order'
        ? [
            linhas,
            companyId,
            { skipReceivable: true, historySeries: prep.historySeries },
          ]
        : extractor.entity === 'quotation'
          ? [linhas, companyId, { historySeries: prep.historySeries }]
          : [linhas, companyId];

    const batch = await internals[method](...args);

    result.imported = batch.successCount;
    result.failed = batch.failedCount;
    result.skipped = batch.skippedCount ?? 0;
    result.errors = (batch.errors || []).map((e: any) => ({
      row: e.row,
      codigoLegado: '',
      error: e.error,
    }));
    return result;
  }

  for (let i = 0; i < linhas.length; i++) {
    const row = linhas[i];

    try {
      if (dryRun) {
        // Roda a mesma validação do servidor, sem gravar. `allowOverride` fica
        // ligado porque a migração atualiza o registro existente em vez de
        // recusá-lo como duplicado.
        const schema = internals.getSchema(extractor.entity);
        const issues = await internals.validateRow(
          row,
          schema,
          companyId,
          i + 2,
          true,
        );

        const blocking = issues.filter((issue: any) => {
          if (issue.severity === 'warning') return false;

          // Referência que a etapa anterior vai criar: na execução real, a
          // ordem de carga resolve. Contar como erro esconderia os problemas
          // de verdade no meio do ruído.
          const dependency = RESOLVED_BY_LOAD_ORDER[issue.field];
          if (dependency && simulated[dependency].has(String(issue.value))) {
            return false;
          }

          // Cadastro de apoio que a preparação da etapa cria antes da carga.
          if (
            RESOLVED_BY_PREPARATION.has(issue.field) &&
            simulated.reference.has(comparableName(issue.value))
          ) {
            return false;
          }

          return true;
        });

        result.warnings =
          (result.warnings ?? 0) +
          issues.filter((issue: any) => issue.severity === 'warning').length;

        result.pending =
          (result.pending ?? 0) + (issues.length - blocking.length);

        if (blocking.length > 0) {
          throw new Error(blocking.map((e: any) => e.error).join('; '));
        }
      } else if (extractor.entity === 'employee') {
        await internals.importEmployee(
          row,
          companyId,
          userId,
          prep.adoptionIndex,
        );
      } else if (extractor.entity === 'client') {
        await internals.importClient(row, companyId, prep.adoptionIndex);
      } else if (extractor.entity === 'supplier') {
        await internals.importSupplier(row, companyId, prep.adoptionIndex);
      } else if (extractor.entity === 'product') {
        await internals.importProduct(row, companyId, { legacy: true });
      } else if (extractor.entity === 'paymentCondition') {
        await internals.importPaymentCondition(row, companyId);
      } else {
        throw new Error(`Entidade '${extractor.entity}' ainda não suportada`);
      }

      result.imported++;
    } catch (error: any) {
      result.failed++;
      result.errors.push({
        row: i + 2,
        codigoLegado: row.codigoLegado,
        error: error.message,
      });
    }
  }

  return result;
}

/**
 * Quem recebe a carga e quem responde por ela.
 *
 * Pela linha de comando o alvo chega como e-mail, que resolve a empresa pelo
 * vínculo de colaborador. Pela tela do superadmin a empresa já vem escolhida,
 * e o autor é o próprio administrador — que não tem vínculo com a empresa do
 * cliente e não seria encontrado por e-mail.
 */
export interface MigrationTarget {
  email?: string;
  companyId?: string;
  userId?: string;
}

export async function migrateLegacyTenant(
  prisma: PrismaClient,
  target: MigrationTarget | string,
  base: string,
  options: { dryRun?: boolean; fullHistory?: boolean } = {},
) {
  const dryRun = options.dryRun ?? false;
  const fullHistory = options.fullHistory ?? false;
  const alvo: MigrationTarget =
    typeof target === 'string' ? { email: target } : target;

  if (!/^acn_\d+$/.test(base)) {
    throw new Error(
      `Nome de base inválido: '${base}'. Esperado o formato acn_000000.`,
    );
  }

  let companyId: string;
  let companyName: string;
  let userId: string;

  if (alvo.companyId) {
    const destino = await prisma.company.findUnique({
      where: { id: alvo.companyId },
      select: { id: true, name: true },
    });
    if (!destino) {
      throw new Error(`Empresa ${alvo.companyId} não encontrada`);
    }
    if (!alvo.userId) {
      throw new Error('Informe o autor da migração junto da empresa');
    }
    companyId = destino.id;
    companyName = destino.name;
    userId = alvo.userId;
  } else {
    if (!alvo.email)
      throw new Error('Informe o e-mail ou a empresa de destino');

    const resolvido = await resolveCompanyByEmail(prisma, alvo.email);
    companyId = resolvido.companyId;
    companyName = resolvido.companyName;

    const user = await prisma.user.findFirst({
      where: { email: alvo.email.toLowerCase().trim() },
      select: { id: true },
    });
    if (!user) throw new Error(`Nenhum usuário com o e-mail ${alvo.email}`);
    userId = user.id;
  }

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { name: true, cnpj: true },
  });

  const legacyHost = process.env.LEGACY_DB_HOST || '127.0.0.1';
  const legacyPort = Number(process.env.LEGACY_DB_PORT || 13306);

  // Sem este contexto o erro sai como um "connect ETIMEDOUT" solto, sem dizer
  // qual das duas conexões falhou — a do banco novo ou a do legado.
  let legacy: mysql.Connection;
  try {
    legacy = await mysql.createConnection({
      host: legacyHost,
      port: legacyPort,
      user: process.env.LEGACY_DB_USER,
      password: process.env.LEGACY_DB_PASSWORD,
      connectTimeout: 20000,
    });
  } catch (error: any) {
    const hint =
      error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED'
        ? ' O host não respondeu: confira se a origem está liberada no security group do banco legado, ou se o túnel SSH está de pé.'
        : '';

    throw new Error(
      `Não foi possível conectar ao banco legado em ${legacyHost}:${legacyPort} ` +
        `(${error.code || error.message}).${hint}`,
    );
  }

  try {
    const [companyRows] = await legacy.query(LEGACY_COMPANY_SQL(base));
    const legacyCompany = (companyRows as any[])[0];

    if (!legacyCompany) {
      throw new Error(`Base '${base}' não tem empresa cadastrada`);
    }

    assertSameCompany(legacyCompany, company as any);
    // Vale também para quem roda pela linha de comando, que não passa pela
    // conferência da tela.
    await assertSingleDestination(prisma, base, legacyCompany.cnpj);

    console.log(`Empresa de destino: ${companyName} (${companyId})`);
    console.log(
      `Base legada:        ${base} — ${legacyCompany.razao_social || legacyCompany.nome}`,
    );
    console.log(
      dryRun
        ? 'Modo:               simulação (nada será gravado)\n'
        : 'Modo:               gravando\n',
    );

    const results: StepResult[] = [];
    const simulated: SimulatedKeys = {
      client: new Set(),
      employee: new Set(),
      product: new Set(),
      paymentCondition: new Set(),
      reference: new Set(),
    };

    for (const extractor of EXTRACTORS) {
      const result = await runStep(
        service(prisma),
        legacy,
        base,
        extractor,
        companyId,
        userId,
        dryRun,
        simulated,
        fullHistory,
      );
      results.push(result);

      const extras = [
        result.warnings ? `${result.warnings} aviso(s)` : '',
        result.pending
          ? `${result.pending} resolvido(s) pela ordem de carga`
          : '',
        result.skipped ? `${result.skipped} já migrado(s)` : '',
        result.created?.length
          ? `${result.created.length} cadastro(s) ${dryRun ? 'a criar' : 'criado(s)'}`
          : '',
        result.adopted ? `${result.adopted} já na conta` : '',
      ].filter(Boolean);

      const status =
        (result.failed === 0 ? 'ok' : `${result.failed} com erro`) +
        (extras.length ? ` · ${extras.join(' · ')}` : '');
      const unit = result.documents ?? result.extracted;
      console.log(
        `${result.label.padEnd(18)} origem ${String(result.expected ?? unit).padStart(6)} · ` +
          `extraídos ${String(unit).padStart(6)} · ` +
          `${dryRun ? 'válidos' : 'gravados'} ${String(result.imported).padStart(6)} · ${status}`,
      );

      // Diferença entre origem e extração é perda silenciosa se não for dita.
      if (result.expected !== undefined && result.expected > unit) {
        console.log(
          `   ${result.expected - unit} documento(s) da origem não entraram na extração`,
        );
      }

      if (result.created?.length) {
        console.log(
          `   ${dryRun ? 'seriam criados' : 'criados'}: ${result.created.join(', ')}`,
        );
      }

      for (const note of result.notes ?? []) {
        console.log(`   ${note}`);
      }

      // Primeiras falhas, para o operador entender o padrão sem abrir o log
      for (const error of result.errors.slice(0, 5)) {
        console.log(
          `   linha ${error.row} (código ${error.codigoLegado}): ${error.error}`,
        );
      }
      if (result.errors.length > 5) {
        console.log(`   ... e mais ${result.errors.length - 5}`);
      }
    }

    return results;
  } finally {
    await legacy.end();
  }
}

/**
 * O MinioService não é usado nesta rota, mas o ProductFiscalService é: sem ele,
 * todo produto importado fica sem dado fiscal e não serve para emitir nota.
 */
function service(prisma: PrismaClient) {
  return new ImportService(
    prisma as any,
    null as any,
    new ProductFiscalService(prisma as any),
  );
}

/** Valor de uma opção no formato --nome=valor. */
function flagValue(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const fullHistory = args.includes('--full-history');
  const runId = flagValue(args, 'run-id');
  const companyId = flagValue(args, 'company-id');
  const userId = flagValue(args, 'user-id');
  const posicionais = args.filter((a) => !a.startsWith('--'));

  // Pela tela do superadmin a empresa vem escolhida e não há e-mail; pela
  // linha de comando é o contrário.
  const email = companyId ? undefined : posicionais[0];
  const base = companyId ? posicionais[0] : posicionais[1];

  const target: MigrationTarget = companyId ? { companyId, userId } : { email };

  if (!base || (!companyId && !email)) {
    console.error(
      'Uso: ts-node src/scripts/migrate-legacy-tenant.ts <email> <base> [--dry-run]\n' +
        '     ou --company-id=<id> --user-id=<id> <base> [--dry-run] [--run-id=<id>]',
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();

  // Quem escreve o acompanhamento é este processo, não a API: assim o registro
  // chega ao fim mesmo que a API reinicie durante a carga.
  const registrar = async (data: any) => {
    if (!runId) return;
    try {
      await prisma.migrationRun.update({ where: { id: runId }, data });
    } catch (error: any) {
      console.error(`Não foi possível atualizar a execução: ${error.message}`);
    }
  };

  try {
    await registrar({ status: 'RUNNING', startedAt: new Date() });

    const results = await migrateLegacyTenant(prisma, target, base, {
      dryRun,
      fullHistory,
    });
    const failed = results.reduce((sum, r) => sum + r.failed, 0);

    await registrar({
      status: 'COMPLETED',
      finishedAt: new Date(),
      summary: results.map(({ errors: _ignorado, ...resumo }) => resumo) as any,
      // Um recorte basta: o relatório existe para o suporte reconhecer o padrão
      // do erro e encaminhar, não para carregar milhares de linhas na tela.
      errors: results
        .flatMap((r) => r.errors.map((e) => ({ etapa: r.label, ...e })))
        .slice(0, 200) as any,
    });

    console.log(
      failed === 0
        ? '\nConcluído sem erros.'
        : `\nConcluído com ${failed} linha(s) com erro.`,
    );
    process.exit(failed === 0 ? 0 : 1);
  } catch (error: any) {
    await registrar({
      status: 'FAILED',
      finishedAt: new Date(),
      failureReason: error.message,
    });

    console.error(`\nFalhou: ${error.message}`);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main();
}
