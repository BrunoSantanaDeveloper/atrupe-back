import { PrismaClient } from '@prisma/client';
import * as mysql from 'mysql2/promise';
import { LEGACY_COMPANY_SQL } from './legacy-extractors';
import { assertSameCompany } from './legacy-destination-guard';

/**
 * Liga os lançamentos financeiros migrados ao cliente, fornecedor ou
 * colaborador que eles têm no legado.
 *
 * No legado a conta (`fin_conta`) aponta para uma entidade, que pode ser
 * cliente, fornecedor ou colaborador. A carga só traduzia o cliente, e só nas
 * receitas: despesa de fornecedor sem documento e toda a folha de pagamento
 * entraram sem ninguém, e nas cargas anteriores à coluna ClienteCodigoLegado
 * as receitas também. O Fluxo financeiro mostrava linhas sem nome. A carga de
 * hoje já traduz os três papéis; este script é para o que entrou antes.
 *
 * O id da conta no legado está na descrição, entre colchetes ("FOLHA #188 -
 * 09/2026 - SALÁRIO [2715]"). Só mexe em lançamento importado que continua
 * sem ninguém; o que o usuário já ligou fica como está.
 *
 * Conta a pagar: fornecedor e/ou colaborador; se a entidade não for nenhum
 * dos dois, o cliente (estorno, devolução). Conta a receber: cliente; se a
 * entidade for só fornecedor, o fornecedor. Cada lançamento da folha aponta,
 * no legado, para o colaborador daquela linha.
 *
 * É idempotente. Sem --yes apenas relata.
 *
 * Uso:
 *   npm run financeiro:vinculos:dev -- --company-id=<id> <base> [--yes]
 *   npm run financeiro:vinculos -- --company-id=<id> <base> [--yes]   (contêiner)
 */

export type Lado = 'payable' | 'receivable';
export type Campo = 'clientId' | 'supplierId' | 'employeeId';

/** Ids, no legado, dos papéis da entidade da conta. */
export interface PapeisNoLegado {
  cliente: string | null;
  fornecedor: string | null;
  colaborador: string | null;
}

/** Cadastros do Atrupe pelo código do legado. */
export interface Cadastros {
  cliente: Map<string, string>;
  fornecedor: Map<string, string>;
  colaborador: Map<string, string>;
}

export type Decisao =
  | { vinculos: { campo: Campo; id: string }[] }
  | { motivo: string };

/** O id da conta no legado, que a carga põe no fim da descrição. */
export function idLegadoDaDescricao(
  descricao: string | null | undefined,
): string | null {
  const encontrado = /\[(\d+)\]\s*$/.exec(descricao || '');
  return encontrado ? encontrado[1] : null;
}

/** Quem o lançamento deve apontar, pelos papéis da entidade no legado. */
export function decidirVinculo(
  lado: Lado,
  papeis: PapeisNoLegado | null,
  cadastros: Cadastros,
): Decisao {
  if (!papeis) return { motivo: 'conta não encontrada no legado' };

  const faltando: string[] = [];
  const cadastro = (papel: keyof PapeisNoLegado): string | null => {
    const legado = papeis[papel];
    if (!legado) return null;
    const id = cadastros[papel].get(legado);
    if (!id) faltando.push(`${papel} ${legado}`);
    return id ?? null;
  };

  const vinculos: { campo: Campo; id: string }[] = [];
  if (lado === 'payable') {
    const fornecedor = cadastro('fornecedor');
    const colaborador = cadastro('colaborador');
    if (fornecedor) vinculos.push({ campo: 'supplierId', id: fornecedor });
    if (colaborador) vinculos.push({ campo: 'employeeId', id: colaborador });
    if (!papeis.fornecedor && !papeis.colaborador) {
      const cliente = cadastro('cliente');
      if (cliente) vinculos.push({ campo: 'clientId', id: cliente });
    }
  } else {
    const cliente = cadastro('cliente');
    if (cliente) {
      vinculos.push({ campo: 'clientId', id: cliente });
    } else if (!papeis.cliente) {
      const fornecedor = cadastro('fornecedor');
      if (fornecedor) vinculos.push({ campo: 'supplierId', id: fornecedor });
    }
  }

  if (vinculos.length) return { vinculos };
  if (faltando.length) {
    return { motivo: `sem cadastro no Atrupe (${faltando.join(', ')})` };
  }
  return {
    motivo: 'a entidade não é cliente, fornecedor nem colaborador no legado',
  };
}

const CAMPOS_DO_LADO: Record<Lado, Campo[]> = {
  payable: ['supplierId', 'employeeId', 'clientId'],
  receivable: ['clientId', 'supplierId'],
};

function lotes<T>(lista: T[], tamanho: number): T[][] {
  const resultado: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) {
    resultado.push(lista.slice(i, i + tamanho));
  }
  return resultado;
}

function flagValue(args: string[], nome: string): string | undefined {
  const arg = args.find((a) => a.startsWith(`--${nome}=`));
  return arg?.slice(nome.length + 3);
}

async function papeisNoLegado(
  legado: mysql.Connection,
  base: string,
  contas: string[],
): Promise<Map<string, PapeisNoLegado>> {
  const resultado = new Map<string, PapeisNoLegado>();
  const texto = (valor: unknown) =>
    valor === null || valor === undefined ? null : String(valor);
  for (const lote of lotes(contas, 500)) {
    const [linhas] = await legado.query(
      `SELECT c.idconta,
              (SELECT MIN(cl.idcliente) FROM ${base}.crm_cliente cl
                WHERE cl.fkidentidade = c.fkidentidade) AS cliente,
              (SELECT MIN(f.idfornecedor) FROM ${base}.forn_fornecedor f
                WHERE f.fkidentidade = c.fkidentidade) AS fornecedor,
              (SELECT MIN(r.idfuncionario) FROM ${base}.rh_funcionario r
                WHERE r.fkidentidade = c.fkidentidade) AS colaborador
         FROM ${base}.fin_conta c
        WHERE c.idconta IN (?)`,
      [lote],
    );
    for (const linha of linhas as any[]) {
      resultado.set(String(linha.idconta), {
        cliente: texto(linha.cliente),
        fornecedor: texto(linha.fornecedor),
        colaborador: texto(linha.colaborador),
      });
    }
  }
  return resultado;
}

async function cadastrosPorLegado(
  prisma: PrismaClient,
  companyId: string,
): Promise<Cadastros> {
  const mapa = (linhas: { id: string; legacyId: string | null }[]) =>
    new Map(
      linhas
        .filter((linha) => linha.legacyId)
        .map((linha) => [(linha.legacyId as string).trim(), linha.id]),
    );
  const onde = { companyId, legacyId: { not: null } };
  const selecao = { id: true, legacyId: true };
  return {
    cliente: mapa(
      await prisma.client.findMany({ where: onde, select: selecao }),
    ),
    fornecedor: mapa(
      await prisma.supplier.findMany({ where: onde, select: selecao }),
    ),
    colaborador: mapa(
      await prisma.employee.findMany({ where: onde, select: selecao }),
    ),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const gravar = args.includes('--yes');
  const companyId = flagValue(args, 'company-id');
  const [base] = args.filter((a) => !a.startsWith('--'));

  if (!companyId || !base) {
    console.error(
      'Uso: link-imported-financial-parties --company-id=<id> <base> [--yes]',
    );
    process.exit(1);
  }
  if (!/^acn_\d+$/.test(base)) {
    console.error(`Nome de base inválido: '${base}'. Esperado acn_000000.`);
    process.exit(1);
  }

  const prisma = new PrismaClient();
  let legado: mysql.Connection | undefined;
  try {
    const empresa = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true, cnpj: true },
    });
    if (!empresa) throw new Error(`Empresa ${companyId} não encontrada`);

    legado = await mysql.createConnection({
      host: process.env.LEGACY_DB_HOST || '127.0.0.1',
      port: Number(process.env.LEGACY_DB_PORT || 13306),
      user: process.env.LEGACY_DB_USER,
      password: process.env.LEGACY_DB_PASSWORD,
      connectTimeout: 20000,
    });

    // A base errada ligaria lançamentos a cadastros de outro cliente.
    const [empresasLegado] = await legado.query(LEGACY_COMPANY_SQL(base));
    const empresaLegado = (empresasLegado as any[])[0];
    if (!empresaLegado) throw new Error(`Base '${base}' não tem empresa`);
    assertSameCompany(empresaLegado, empresa);

    console.log(`Empresa: ${empresa.name} (${empresa.id})`);
    console.log(
      `Base:    ${base} — ${empresaLegado.razao_social || empresaLegado.nome}`,
    );
    console.log(
      gravar
        ? 'Modo:    ligando\n'
        : 'Modo:    simulação (use --yes para gravar)\n',
    );

    const cadastros = await cadastrosPorLegado(prisma, empresa.id);

    for (const lado of ['payable', 'receivable'] as Lado[]) {
      const semNinguem = Object.fromEntries(
        CAMPOS_DO_LADO[lado].map((campo) => [campo, null]),
      );
      const lancamentos: { id: string; description: string | null }[] = await (
        prisma[lado] as any
      ).findMany({
        where: { companyId: empresa.id, isImported: true, ...semNinguem },
        select: { id: true, description: true },
      });

      const contas = [
        ...new Set(
          lancamentos
            .map((l) => idLegadoDaDescricao(l.description))
            .filter((id): id is string => !!id),
        ),
      ];
      const papeis = await papeisNoLegado(legado, base, contas);

      const grupos = new Map<string, string[]>();
      const motivos = new Map<string, string[]>();
      const porCampo: Record<string, number> = {};
      for (const lancamento of lancamentos) {
        const conta = idLegadoDaDescricao(lancamento.description);
        const decisao: Decisao = conta
          ? decidirVinculo(lado, papeis.get(conta) ?? null, cadastros)
          : { motivo: 'sem o id do legado na descrição' };
        if ('motivo' in decisao) {
          const lista = motivos.get(decisao.motivo) ?? [];
          lista.push(lancamento.description || '(sem descrição)');
          motivos.set(decisao.motivo, lista);
          continue;
        }
        const chave = JSON.stringify(decisao.vinculos);
        grupos.set(chave, [...(grupos.get(chave) ?? []), lancamento.id]);
        for (const vinculo of decisao.vinculos) {
          porCampo[vinculo.campo] = (porCampo[vinculo.campo] ?? 0) + 1;
        }
      }

      const ligaveis = [...grupos.values()].reduce((s, l) => s + l.length, 0);
      console.log(
        `${lado === 'payable' ? 'Contas a pagar' : 'Contas a receber'}: ${lancamentos.length} sem ninguém, ${ligaveis} ligáveis ${JSON.stringify(porCampo)}`,
      );
      for (const [motivo, lista] of motivos) {
        console.log(
          `   ficam sem ninguém: ${lista.length} — ${motivo}; ex.: ${lista.slice(0, 3).join(' | ')}`,
        );
      }

      if (!gravar) continue;
      let ligados = 0;
      for (const [chave, ids] of grupos) {
        const vinculos = JSON.parse(chave) as { campo: Campo; id: string }[];
        const dados = Object.fromEntries(vinculos.map((v) => [v.campo, v.id]));
        for (const lote of lotes(ids, 500)) {
          // Só o que continua sem ninguém: o que o usuário ligou fica.
          const { count } = await (prisma[lado] as any).updateMany({
            where: { id: { in: lote }, companyId: empresa.id, ...semNinguem },
            data: dados,
          });
          ligados += count;
        }
      }
      console.log(`   ligados: ${ligados}`);
    }

    console.log(gravar ? '\nLançamentos ligados.' : '\nNada foi gravado.');
  } catch (error: any) {
    console.error(`\nFalhou: ${error.message}`);
    process.exit(1);
  } finally {
    await legado?.end().catch(() => undefined);
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main();
}
