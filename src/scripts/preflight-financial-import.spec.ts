import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import {
  runPreflight,
  resolveCompanyByEmail,
} from './preflight-financial-import';

const EMAIL = 'financeiro@exemplo.com.br';

// Mesmo formato do export do sistema de origem: diretiva sep=; antes do header.
const CSV = [
  'sep=;',
  'Tipo;Descricao;Referencia;DataReferencia;ValorTotal;QuantidadeParcelas;ClienteCpfCnpj;FornecedorCpfCnpj;FuncionarioEmail;Natureza;SubCategoria;CondicaoPagamento;Parcela;DataVencimento;ValorParcela;Status;DataPagamento;ValorPago;ContaBancaria;Observacoes',
  'RECEITA;Recebimento Job 868;JOB-868;2026-08-03;345.00;1;55895031000140;;;;;;1;2026-08-03;345.00;PAID;2026-08-03;345.00;Sicredi CC 47204-3;',
  'RECEITA;Recebimento Job 856;JOB-856;2026-07-31;251.94;1;36141395000190;;;;;;1;2026-07-31;251.94;PAID;2026-07-31;251.94;Bradesco CC 8392-5;',
  'RECEITA;Recebimento Job 948;JOB-948;2026-07-27;50.00;1;;;;;;;1;2026-07-27;50.00;PAID;2026-07-27;50.00;Bradesco CC 8392-5;',
].join('\n');

let dir: string;
let csvPath: string;

function buildPrisma(overrides: Record<string, any> = {}) {
  const prisma = {
    user: {
      findFirst: jest.fn().mockResolvedValue({ id: 'user-1', email: EMAIL }),
    },
    employee: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { companyId: 'company-1', company: { name: 'Armazém' } },
        ]),
    },
    // Cliente sempre encontrado: isola o preflight na pendência de conta.
    client: {
      findFirst: jest.fn().mockResolvedValue({ id: 'client-1' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    bankAccount: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    ...overrides,
  };

  return prisma as unknown as PrismaClient;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'preflight-'));
  csvPath = join(dir, 'extrato.csv');
  writeFileSync(csvPath, CSV, 'utf-8');
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  jest.restoreAllMocks();
});

describe('resolveCompanyByEmail', () => {
  it('resolve a empresa pelo vínculo de colaborador', async () => {
    const prisma = buildPrisma();

    await expect(resolveCompanyByEmail(prisma, EMAIL)).resolves.toEqual({
      companyId: 'company-1',
      companyName: 'Armazém',
    });
  });

  it('falha quando o e-mail não existe', async () => {
    const prisma = buildPrisma({
      user: { findFirst: jest.fn().mockResolvedValue(null) },
    });

    await expect(resolveCompanyByEmail(prisma, EMAIL)).rejects.toThrow(
      /Nenhum usuário/,
    );
  });

  it('falha quando o usuário não tem colaborador ativo', async () => {
    const prisma = buildPrisma({
      employee: { findMany: jest.fn().mockResolvedValue([]) },
    });

    await expect(resolveCompanyByEmail(prisma, EMAIL)).rejects.toThrow(
      /colaborador ativo/,
    );
  });
});

describe('runPreflight', () => {
  it('reproduz a rejeição por conta bancária ausente', async () => {
    const prisma = buildPrisma();

    const { totalRows, errors } = await runPreflight(prisma, EMAIL, csvPath);

    // A diretiva sep=; não conta como linha de dados.
    expect(totalRows).toBe(3);
    expect(errors).toHaveLength(3);
    expect(errors.every((e) => e.field === 'ContaBancaria')).toBe(true);
    expect(errors.map((e) => e.row)).toEqual([2, 3, 4]);
    expect(new Set(errors.map((e) => e.value))).toEqual(
      new Set(['Sicredi CC 47204-3', 'Bradesco CC 8392-5']),
    );
  });

  it('lista as contas cadastradas na mensagem quando existem outras', async () => {
    const prisma = buildPrisma({
      bankAccount: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest
          .fn()
          .mockResolvedValue([{ name: 'Caixa do Financeiro' }]),
      },
    });

    const { errors } = await runPreflight(prisma, EMAIL, csvPath);

    expect(errors[0].error).toContain('Contas ativas: Caixa do Financeiro');
  });

  it('não aponta erro quando todas as contas existem', async () => {
    const prisma = buildPrisma({
      bankAccount: {
        findFirst: jest.fn().mockResolvedValue({ id: 'acc-1' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    });

    const { errors } = await runPreflight(prisma, EMAIL, csvPath);

    expect(errors).toHaveLength(0);
  });

  it('aponta cliente não cadastrado, ignorando linhas sem CPF/CNPJ', async () => {
    const prisma = buildPrisma({
      client: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      bankAccount: {
        findFirst: jest.fn().mockResolvedValue({ id: 'acc-1' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    });

    const { errors } = await runPreflight(prisma, EMAIL, csvPath);

    // A terceira linha do CSV vem sem cliente, e o campo é opcional.
    expect(errors).toHaveLength(2);
    expect(errors.every((e) => e.field === 'ClienteCpfCnpj')).toBe(true);
    expect(errors.map((e) => e.value)).toEqual([
      '55895031000140',
      '36141395000190',
    ]);
  });
});
