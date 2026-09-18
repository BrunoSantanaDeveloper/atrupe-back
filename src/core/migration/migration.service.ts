import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { spawn } from 'child_process';
import { join } from 'path';
import * as mysql from 'mysql2/promise';
import { LEGACY_COMPANY_SQL } from '../../scripts/legacy-extractors';
import {
  assertSameCompany,
  companiesWithCnpj,
  destinationConflict,
  findDestinationConflict,
  onlyDigits,
  realLoads,
} from '../../scripts/legacy-destination-guard';
import { validCNPJ } from '../../helpers/validators/cnpj';

/** Formato do nome de base no legado, que é um banco por cliente. */
const LEGACY_BASE_PATTERN = /^acn_\d+$/;

/** Consultas simultâneas ao legado durante a busca por CNPJ. */
const LEGACY_SEARCH_CONCURRENCY = 5;

const CONNECTION_ERRORS = [
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EHOSTUNREACH',
];

type LegacyCompany = {
  nome?: string;
  razao_social?: string;
  cnpj?: string;
  cpf?: string;
};

/** Teto da lista de conferência: com todas as bases liberadas, seriam centenas. */
const MAX_LISTED_BASES = 50;

export interface LegacyBase {
  base: string;
  razaoSocial: string | null;
  cnpj: string | null;
  /** Conta do Atrupe com o mesmo CNPJ, quando há exatamente uma. */
  empresaVinculada: { id: string; name: string } | null;
  /** Por que a base não pode ser migrada agora, quando não pode. */
  bloqueio: string | null;
}

/** O que a busca enxergou numa base, para conferir quando nada casa. */
export interface LegacyBaseGlimpse {
  base: string;
  razaoSocial: string | null;
  cnpj: string | null;
  /** CPF, quando a empresa do legado está cadastrada como pessoa. */
  cpf: string | null;
  /** Por que não deu para ler a empresa desta base. */
  erro?: string;
}

export interface LegacyBaseSearch {
  /**
   * Quantas bases de cliente o usuário do legado consegue ler. Com poucas, um
   * "não encontrado" tende a ser base não liberada, e não CNPJ errado.
   */
  basesConsultadas: number;
  encontradas: LegacyBase[];
  /**
   * Só quando nada casa: o que foi lido em cada base. É por aqui que se vê se
   * a base do cliente está entre as liberadas e com que documento ela está
   * cadastrada.
   */
  consultadas?: LegacyBaseGlimpse[];
}

@Injectable()
export class MigrationService {
  private readonly logger = new Logger(MigrationService.name);

  constructor(private readonly prisma: PrismaService) {}

  protected legacyPool(): mysql.Pool {
    if (!process.env.LEGACY_DB_HOST) {
      throw new BadRequestException(
        'Acesso ao sistema legado não configurado neste ambiente. Defina ' +
          'LEGACY_DB_HOST, LEGACY_DB_PORT, LEGACY_DB_USER e LEGACY_DB_PASSWORD ' +
          'no ambiente da API.',
      );
    }
    return mysql.createPool({
      host: process.env.LEGACY_DB_HOST,
      port: Number(process.env.LEGACY_DB_PORT || 3306),
      user: process.env.LEGACY_DB_USER,
      password: process.env.LEGACY_DB_PASSWORD,
      connectTimeout: 20000,
      connectionLimit: LEGACY_SEARCH_CONCURRENCY,
    });
  }

  /** Falha de acesso ao legado em termos que o suporte consiga encaminhar. */
  private legacyError(error: any): Error {
    if (error instanceof HttpException) return error;

    if (CONNECTION_ERRORS.includes(error?.code)) {
      // O legado só é alcançável de dentro da rede da AWS: fora do servidor,
      // esta é a falha esperada.
      return new ServiceUnavailableException(
        `Não foi possível conectar ao banco legado (${error.code}). ` +
          'Confira LEGACY_DB_HOST e LEGACY_DB_PORT no ambiente da API.',
      );
    }
    if (error?.code === 'ER_ACCESS_DENIED_ERROR') {
      return new ServiceUnavailableException(
        'O banco legado recusou o usuário configurado. Confira ' +
          'LEGACY_DB_USER e LEGACY_DB_PASSWORD no ambiente da API.',
      );
    }
    if (error?.sqlMessage) {
      return new BadRequestException(
        `O banco legado recusou a consulta: ${error.sqlMessage}`,
      );
    }
    return error;
  }

  /**
   * Procura no legado a base do cliente pelo CNPJ.
   *
   * O pedido de migração chega do cliente com o CNPJ, não com o nome da base.
   * A busca percorre as bases que o usuário do legado consegue ler: estar na
   * mesma rede permite conectar ao servidor, mas quem decide quais bases são
   * lidas é a permissão desse usuário no MySQL. Base sem permissão não aparece.
   */
  async findLegacyBases(cnpj: string | undefined): Promise<LegacyBaseSearch> {
    const digits = onlyDigits(cnpj);
    if (!digits) throw new BadRequestException('Informe o CNPJ do cliente');
    if (!validCNPJ(digits)) {
      throw new BadRequestException(`CNPJ inválido: ${cnpj}`);
    }

    const pool = this.legacyPool();

    try {
      const bases = await this.readableBases(pool);
      if (bases.length === 0) {
        throw new BadRequestException(
          'O usuário do legado não tem permissão de leitura em nenhuma base ' +
            'de cliente. Peça ao time do legado o SELECT nas bases acn_.',
        );
      }

      const empresas = await Promise.all(
        bases.map(async (base) => ({
          base,
          ...(await this.companyOf(pool, base)),
        })),
      );
      const achadas = empresas.filter(
        (e) => onlyDigits(e.dados?.cnpj) === digits,
      );

      if (achadas.length === 0) {
        // Sem isto, "não encontrado" não distingue base não liberada de base
        // liberada com outro documento — e a conversa com o time do legado
        // fica sem evidência.
        return {
          basesConsultadas: bases.length,
          encontradas: [],
          consultadas: empresas.slice(0, MAX_LISTED_BASES).map((empresa) => ({
            base: empresa.base,
            razaoSocial:
              empresa.dados?.razao_social || empresa.dados?.nome || null,
            cnpj: empresa.dados?.cnpj || null,
            cpf: empresa.dados?.cpf || null,
            ...(empresa.erro ? { erro: empresa.erro } : {}),
          })),
        };
      }

      const contas = await companiesWithCnpj(this.prisma, digits);
      const cargas = await realLoads(
        this.prisma,
        achadas.map((a) => a.base),
        contas.map((c) => c.id),
      );
      const vinculada = contas.length === 1 ? contas[0] : null;

      return {
        basesConsultadas: bases.length,
        encontradas: achadas.map(({ base, dados }) => ({
          base,
          razaoSocial: dados?.razao_social || dados?.nome || null,
          cnpj: dados?.cnpj || null,
          empresaVinculada: vinculada
            ? { id: vinculada.id, name: vinculada.name }
            : null,
          bloqueio: findDestinationConflict({
            base,
            sameCnpj: contas,
            loads: cargas,
          }),
        })),
      };
    } catch (error) {
      throw this.legacyError(error);
    } finally {
      await pool.end().catch(() => undefined);
    }
  }

  /** Bases de cliente que o usuário do legado consegue ler. */
  private async readableBases(pool: mysql.Pool): Promise<string[]> {
    // SHOW DATABASES só devolve as bases em que o usuário tem alguma permissão.
    const [rows] = await pool.query('SHOW DATABASES');
    return (rows as any[])
      .map((r) => Object.values(r)[0] as string)
      .filter((name) => LEGACY_BASE_PATTERN.test(name));
  }

  private async companyOf(
    pool: mysql.Pool,
    base: string,
  ): Promise<{ dados: LegacyCompany | null; erro?: string }> {
    try {
      const [rows] = await pool.query(LEGACY_COMPANY_SQL(base));
      return { dados: (rows as any[])[0] ?? null };
    } catch (error: any) {
      // Uma base sem as tabelas da empresa não pode derrubar a busca nas
      // demais. Queda de conexão, sim: sem ela, a busca diria "não encontrado".
      if (error?.fatal) throw error;

      // O motivo é o que interessa: permissão só no banco, sem as tabelas,
      // aparece aqui como "SELECT command denied".
      return { dados: null, erro: error?.sqlMessage || error?.message };
    }
  }

  /** Empresa cadastrada na base legada, ou `null` se não houver. */
  protected async legacyCompany(base: string): Promise<LegacyCompany | null> {
    const pool = this.legacyPool();
    try {
      const [rows] = await pool.query(LEGACY_COMPANY_SQL(base));
      return (rows as any[])[0] ?? null;
    } catch (error) {
      throw this.legacyError(error);
    } finally {
      await pool.end().catch(() => undefined);
    }
  }

  /**
   * Confere o destino antes de registrar a execução.
   *
   * O script repete as mesmas conferências; aqui elas existem para o suporte
   * receber a recusa no clique, e não minutos depois como execução com falha.
   */
  private async assertDestination(
    company: { id: string; name: string; cnpj: string | null },
    legacyBase: string,
  ) {
    const legado = await this.legacyCompany(legacyBase);
    if (!legado) {
      throw new BadRequestException(
        `Base '${legacyBase}' não tem empresa cadastrada`,
      );
    }

    try {
      assertSameCompany(legado, company);
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }

    const conflito = await destinationConflict(
      this.prisma,
      legacyBase,
      legado.cnpj,
    );
    if (conflito) throw new ConflictException(conflito);
  }

  /**
   * Registra a execução e dispara o processo que faz a carga.
   *
   * A migração leva minutos e grava milhares de registros: não cabe num
   * request. Roda como processo separado, que atualiza o próprio registro ao
   * terminar — então o acompanhamento sobrevive a um reinício da API.
   */
  async start(params: {
    companyId: string;
    legacyBase: string;
    dryRun: boolean;
    startedById: string;
  }) {
    const { companyId, legacyBase, dryRun, startedById } = params;

    if (!LEGACY_BASE_PATTERN.test(legacyBase)) {
      throw new BadRequestException(
        `Nome de base inválido: '${legacyBase}'. Esperado o formato acn_000000.`,
      );
    }

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true, cnpj: true },
    });
    if (!company) throw new NotFoundException('Empresa não encontrada');

    // Uma migração por vez. Duas cargas simultâneas disputariam o mesmo banco
    // e o relatório de nenhuma delas seria confiável.
    const emAndamento = await this.prisma.migrationRun.findFirst({
      where: { status: { in: ['QUEUED', 'RUNNING'] } },
      select: { id: true, company: { select: { name: true } } },
    });
    if (emAndamento) {
      throw new ConflictException(
        `Já existe uma migração em andamento (${emAndamento.company.name}). Aguarde a conclusão.`,
      );
    }

    await this.assertDestination(company, legacyBase);

    const run = await this.prisma.migrationRun.create({
      data: { companyId, legacyBase, dryRun, startedById },
    });

    this.spawnRun(run.id, { companyId, legacyBase, dryRun, startedById });

    return run;
  }

  private spawnRun(
    runId: string,
    params: {
      companyId: string;
      legacyBase: string;
      dryRun: boolean;
      startedById: string;
    },
  ) {
    // A imagem carrega apenas o build; os fontes não vão para o contêiner.
    const script = join(
      process.cwd(),
      'dist',
      'src',
      'scripts',
      'migrate-legacy-tenant.js',
    );

    const args = [
      script,
      params.legacyBase,
      `--company-id=${params.companyId}`,
      `--user-id=${params.startedById}`,
      `--run-id=${runId}`,
    ];
    if (params.dryRun) args.push('--dry-run');

    const child = spawn(process.execPath, args, {
      // Desacoplado do ciclo da requisição: a carga continua mesmo que o
      // cliente feche a tela.
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });

    child.on('error', async (error) => {
      this.logger.error(
        `Falha ao iniciar a migração ${runId}: ${error.message}`,
      );
      await this.prisma.migrationRun
        .update({
          where: { id: runId },
          data: {
            status: 'FAILED',
            finishedAt: new Date(),
            failureReason: `Não foi possível iniciar o processo: ${error.message}`,
          },
        })
        .catch(() => undefined);
    });

    child.unref();
  }

  async findOne(id: string) {
    const run = await this.prisma.migrationRun.findUnique({
      where: { id },
      include: {
        company: { select: { id: true, name: true, cnpj: true } },
        startedBy: { select: { id: true, name: true, email: true } },
      },
    });
    if (!run) throw new NotFoundException('Execução não encontrada');
    return run;
  }

  async list(limit = 20) {
    return this.prisma.migrationRun.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        company: { select: { id: true, name: true } },
        startedBy: { select: { name: true, email: true } },
      },
    });
  }
}
