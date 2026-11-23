import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { PlanControlService } from '../../plan/plan-control.service';
import { ProductionFilesService } from './production-files.service';
import { ProductionStorageService } from './production-storage.service';
import {
  CLEANUP_DEFAULT_PERCENT,
  CLEANUP_DEFAULT_THRESHOLD,
  CleanupCandidate,
  autoCleanupDue,
  autoCleanupSkip,
  cleanupConfirmed,
  pickOldest,
} from './storage-cleanup';

type Who = { companyId: string; userId: string | null; name: string };
type Db = Prisma.TransactionClient;
type CleanupFile = CleanupCandidate & { storageKey: string };

const brDay = (date: Date) =>
  date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

/**
 * A O.S. entregue: a finalizada, que passou pela entrega. A concluída
 * (COMPLETED) ainda conta como em andamento, e o projeto concluído (DONE) só
 * diz que a produção acabou.
 */
const DELIVERED = { status: 'FINISHED' } as const;

const NOTHING_TO_CLEAN = 'Não há arquivos de O.S. entregues para apagar.';

/**
 * A transação da limpeza espera a vez na trava da empresa, planeja e marca
 * milhares de arquivos de uma vez: os 5 s padrão do Prisma não bastam.
 */
const CLEANUP_TX = { maxWait: 10_000, timeout: 60_000 };

/**
 * A limpeza do espaço dos arquivos de produção (GP-49): a prévia, a
 * limpeza confirmada pelo administrador e a automática (desligada de
 * partida). As regras ficam em `storage-cleanup.ts`.
 */
@Injectable()
export class ProductionCleanupService {
  private readonly logger = new Logger(ProductionCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: ProductionFilesService,
    private readonly storage: ProductionStorageService,
    private readonly plans: PlanControlService,
  ) {}

  /** Só o administrador apaga: não tem volta. */
  assertAdmin(user: { isAdmin?: boolean; isSystemAdmin?: boolean }) {
    if (!user?.isAdmin && !user?.isSystemAdmin) {
      throw new ForbiddenException(
        'Só o administrador da empresa pode limpar o espaço dos arquivos.',
      );
    }
  }

  /**
   * O que pode sair: as versões dos anexos das tarefas e os arquivos das
   * O.S., só das O.S. entregues. O anexo chega à O.S. pela tarefa, o projeto
   * e a venda; a O.S. é contada pela venda (a mesma no projeto e na O.S.).
   */
  private async candidates(companyId: string, db: Db): Promise<CleanupFile[]> {
    const [versions, orderFiles] = await Promise.all([
      db.productionAttachmentVersion.findMany({
        where: {
          removedAt: null,
          attachment: {
            task: {
              companyId,
              project: { quotation: { order: DELIVERED } },
            },
          },
        },
        select: {
          id: true,
          size: true,
          uploadedAt: true,
          storageKey: true,
          attachment: {
            select: {
              taskId: true,
              task: { select: { project: { select: { quotationId: true } } } },
            },
          },
        },
      }),
      db.orderFile.findMany({
        where: { companyId, removedAt: null, order: DELIVERED },
        select: {
          id: true,
          size: true,
          uploadedAt: true,
          storageKey: true,
          order: { select: { quotationId: true } },
        },
      }),
    ]);
    return [
      ...versions.map((row) => ({
        id: row.id,
        size: row.size,
        uploadedAt: row.uploadedAt,
        storageKey: row.storageKey,
        taskId: row.attachment.taskId as string | null,
        projectId: row.attachment.task.project.quotationId,
      })),
      ...orderFiles.map((row) => ({
        id: row.id,
        size: row.size,
        uploadedAt: row.uploadedAt,
        storageKey: row.storageKey,
        taskId: null as string | null,
        projectId: row.order.quotationId,
      })),
    ];
  }

  private async plan(companyId: string, percent: number, db: Db) {
    const [summary, candidates] = await Promise.all([
      this.files.summary(companyId, false),
      this.candidates(companyId, db),
    ]);
    return {
      summary,
      pick: pickOldest(candidates, summary.usedBytes, percent),
    };
  }

  /** O que a limpeza apagaria, sem apagar nada. */
  async preview(companyId: string, percent: number) {
    const { summary, pick } = await this.plan(companyId, percent, this.prisma);
    return {
      usedBytes: summary.usedBytes,
      quotaBytes: summary.quotaBytes,
      percent,
      targetBytes: pick.targetBytes,
      eligibleBytes: pick.eligibleBytes,
      files: pick.picked.length,
      bytes: pick.bytes,
      projects: pick.projects,
      from: pick.from?.toISOString() ?? null,
      to: pick.to?.toISOString() ?? null,
    };
  }

  /**
   * Apaga: marca as versões, registra na tarefa e na empresa e, gravado
   * isso, remove do armazenamento.
   *
   * Duas limpezas da mesma empresa (duplo clique, a manual junto com a
   * automática) se enfileiram na trava, e a segunda planeja sobre o que a
   * primeira deixou. Conta só o que esta limpeza marcou: o arquivo apagado à
   * mão no meio do caminho não entra no histórico.
   */
  async run(who: Who, percent: number, automatic = false) {
    const now = new Date();
    const done = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`storage-cleanup:${who.companyId}`}))`;

      const { pick } = await this.plan(who.companyId, percent, tx);
      if (!pick.picked.length) {
        throw new UnprocessableEntityException(NOTHING_TO_CLEAN);
      }
      const idsOf = (fromTask: boolean) =>
        pick.picked
          .filter((file) => !!file.taskId === fromTask)
          .map((file) => file.id);
      const versions = await tx.productionAttachmentVersion.updateMany({
        where: { id: { in: idsOf(true) }, removedAt: null },
        data: { removedAt: now },
      });
      const orderFiles = await tx.orderFile.updateMany({
        where: { id: { in: idsOf(false) }, removedAt: null },
        data: { removedAt: now },
      });
      const count = versions.count + orderFiles.count;
      if (!count) throw new UnprocessableEntityException(NOTHING_TO_CLEAN);
      const marked =
        count === pick.picked.length
          ? pick.picked
          : await this.markedAt(tx, pick.picked, now);

      const perTask = new Map<string, number>();
      for (const file of marked) {
        if (!file.taskId) continue;
        perTask.set(file.taskId, (perTask.get(file.taskId) ?? 0) + 1);
      }
      if (perTask.size) {
        await tx.productionTaskHistory.createMany({
          data: [...perTask].map(([taskId, files]) => ({
            taskId,
            at: now,
            byUserId: who.userId,
            byName: who.name,
            text: `${files === 1 ? '1 arquivo removido' : `${files} arquivos removidos`} na limpeza do espaço de ${brDay(now)}${automatic ? ' (automática)' : ''}`,
            affects: [],
          })),
        });
      }
      const bytes = marked.reduce((sum, file) => sum + file.size, 0);
      await tx.productionStorageCleanup.create({
        data: {
          companyId: who.companyId,
          at: now,
          byUserId: who.userId,
          byName: who.name,
          automatic,
          percent,
          files: count,
          bytes,
        },
      });
      return {
        marked,
        bytes,
        projects: new Set(marked.map((file) => file.projectId)).size,
      };
    }, CLEANUP_TX);

    for (const file of done.marked) {
      await this.storage
        .remove(file.storageKey)
        .catch((error) =>
          this.logger.warn(
            `Arquivo não apagado (${file.storageKey}): ${error.message}`,
          ),
        );
    }
    return {
      files: done.marked.length,
      bytes: done.bytes,
      projects: done.projects,
    };
  }

  /** Dos escolhidos, os que esta limpeza marcou (os de agora). */
  private async markedAt(tx: Db, picked: CleanupFile[], at: Date) {
    const ids = picked.map((file) => file.id);
    const [versions, orderFiles] = await Promise.all([
      tx.productionAttachmentVersion.findMany({
        where: { id: { in: ids }, removedAt: at },
        select: { id: true },
      }),
      tx.orderFile.findMany({
        where: { id: { in: ids }, removedAt: at },
        select: { id: true },
      }),
    ]);
    const marked = new Set([...versions, ...orderFiles].map((row) => row.id));
    return picked.filter((file) => marked.has(file.id));
  }

  async history(companyId: string) {
    const rows = await this.prisma.productionStorageCleanup.findMany({
      where: { companyId },
      orderBy: { at: 'desc' },
      take: 20,
    });
    return rows.map((row) => ({
      at: row.at.toISOString(),
      by: row.byName,
      automatic: row.automatic,
      percent: row.percent,
      files: row.files,
      bytes: row.bytes,
    }));
  }

  async auto(companyId: string) {
    const row = await this.prisma.productionStorageAuto.findUnique({
      where: { companyId },
    });
    return {
      enabled: row?.enabled ?? false,
      percent: row?.percent ?? CLEANUP_DEFAULT_PERCENT,
      threshold: row?.threshold ?? CLEANUP_DEFAULT_THRESHOLD,
    };
  }

  /**
   * Liga, desliga ou ajusta a automática. Ligar pede o APAGAR digitado, como
   * a limpeza manual: dali em diante ela apaga sem perguntar.
   */
  async saveAuto(
    companyId: string,
    dto: {
      enabled: boolean;
      percent: number;
      threshold: number;
      confirm?: string;
    },
  ) {
    if (dto.enabled && !cleanupConfirmed(dto.confirm)) {
      const current = await this.prisma.productionStorageAuto.findUnique({
        where: { companyId },
        select: { enabled: true },
      });
      if (!current?.enabled) {
        throw new BadRequestException(
          'Digite APAGAR para ligar a limpeza automática',
        );
      }
    }
    const data = {
      enabled: dto.enabled,
      percent: dto.percent,
      threshold: dto.threshold,
    };
    await this.prisma.productionStorageAuto.upsert({
      where: { companyId },
      create: { companyId, ...data },
      update: data,
    });
    return data;
  }

  /** A automática, de madrugada, só para quem ligou. */
  @Cron('40 3 * * *', {
    name: 'production-storage-auto-cleanup',
    timeZone: 'America/Sao_Paulo',
  })
  async runAutomatic() {
    const rows = await this.prisma.productionStorageAuto.findMany({
      where: { enabled: true },
    });
    for (const row of rows) {
      try {
        const skip = autoCleanupSkip(
          await this.plans.getCompanyPlanInfo(row.companyId),
        );
        if (skip) {
          this.logger.log(
            `Limpeza automática pulada (${row.companyId}): ${skip}; sem ela a cota cai para a grátis.`,
          );
          continue;
        }
        const summary = await this.files.summary(row.companyId, false);
        if (!autoCleanupDue(summary, row.threshold)) continue;
        await this.run(
          {
            companyId: row.companyId,
            userId: null,
            name: 'Limpeza automática',
          },
          row.percent,
          true,
        );
      } catch (error) {
        this.logger.warn(
          `Limpeza automática não feita (${row.companyId}): ${(error as Error).message}`,
        );
      }
    }
  }
}
