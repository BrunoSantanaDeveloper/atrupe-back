import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { spawn } from 'child_process';
import { join } from 'path';
import * as mysql from 'mysql2/promise';
import { LEGACY_COMPANY_SQL } from '../../scripts/legacy-extractors';

/** Formato do nome de base no legado, que é um banco por cliente. */
const LEGACY_BASE_PATTERN = /^acn_\d+$/;

export interface LegacyBase {
  base: string;
  razaoSocial: string | null;
  cnpj: string | null;
  /** Empresa do Atrupe com o mesmo CNPJ, quando existe. */
  empresaVinculada: { id: string; name: string } | null;
}

@Injectable()
export class MigrationService {
  private readonly logger = new Logger(MigrationService.name);

  constructor(private readonly prisma: PrismaService) {}

  private legacyConnection() {
    return mysql.createConnection({
      host: process.env.LEGACY_DB_HOST,
      port: Number(process.env.LEGACY_DB_PORT || 3306),
      user: process.env.LEGACY_DB_USER,
      password: process.env.LEGACY_DB_PASSWORD,
      connectTimeout: 20000,
    });
  }

  /**
   * Bases liberadas no legado, já com a identidade da empresa.
   *
   * O suporte escolhe da lista em vez de digitar o nome da base: um nome
   * trocado despejaria os dados de um cliente dentro da empresa de outro. A
   * conferência de CNPJ na carga continua valendo como segunda barreira.
   */
  async listLegacyBases(): Promise<LegacyBase[]> {
    if (!process.env.LEGACY_DB_HOST) {
      throw new BadRequestException(
        'Acesso ao sistema legado não configurado neste ambiente',
      );
    }

    const connection = await this.legacyConnection();

    try {
      const [rows] = await connection.query('SHOW DATABASES');
      const bases = (rows as any[])
        .map((r) => Object.values(r)[0] as string)
        .filter((name) => LEGACY_BASE_PATTERN.test(name));

      const empresas = await this.prisma.company.findMany({
        where: { cnpj: { not: null } },
        select: { id: true, name: true, cnpj: true },
      });
      const porDocumento = new Map(
        empresas.map((e) => [this.onlyDigits(e.cnpj), e]),
      );

      const resultado: LegacyBase[] = [];

      for (const base of bases) {
        try {
          const [empresa] = await connection.query(LEGACY_COMPANY_SQL(base));
          const dados = (empresa as any[])[0];
          const vinculada = porDocumento.get(this.onlyDigits(dados?.cnpj));

          resultado.push({
            base,
            razaoSocial: dados?.razao_social || dados?.nome || null,
            cnpj: dados?.cnpj || null,
            empresaVinculada: vinculada
              ? { id: vinculada.id, name: vinculada.name }
              : null,
          });
        } catch {
          // Base sem empresa cadastrada ainda aparece na lista: esconder a
          // deixaria o suporte sem entender por que ela sumiu.
          resultado.push({
            base,
            razaoSocial: null,
            cnpj: null,
            empresaVinculada: null,
          });
        }
      }

      return resultado;
    } finally {
      await connection.end();
    }
  }

  private onlyDigits(value: string | null | undefined): string {
    return String(value ?? '').replace(/[^\d]/g, '');
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
      select: { id: true, name: true },
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
