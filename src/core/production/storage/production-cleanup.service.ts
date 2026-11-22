import {
  ForbiddenException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { ProductionFilesService } from './production-files.service';
import { ProductionStorageService } from './production-storage.service';
import {
  CLEANUP_DEFAULT_PERCENT,
  CLEANUP_DEFAULT_THRESHOLD,
  autoCleanupDue,
  pickOldest,
} from './storage-cleanup';

type Who = { companyId: string; userId: string | null; name: string };

const brDay = (date: Date) =>
  date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

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
  ) {}

  /** Só o administrador apaga: não tem volta. */
  assertAdmin(user: { isAdmin?: boolean; isSystemAdmin?: boolean }) {
    if (!user?.isAdmin && !user?.isSystemAdmin) {
      throw new ForbiddenException(
        'Só o administrador da empresa pode limpar o espaço dos arquivos.',
      );
    }
  }

  private async candidates(companyId: string) {
    const rows = await this.prisma.productionAttachmentVersion.findMany({
      where: {
        removedAt: null,
        attachment: {
          task: { companyId, project: { status: 'DONE' } },
        },
      },
      select: {
        id: true,
        size: true,
        uploadedAt: true,
        storageKey: true,
        attachment: {
          select: { taskId: true, task: { select: { projectId: true } } },
        },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      size: row.size,
      uploadedAt: row.uploadedAt,
      storageKey: row.storageKey,
      taskId: row.attachment.taskId,
      projectId: row.attachment.task.projectId,
    }));
  }

  private async plan(companyId: string, percent: number) {
    const summary = await this.files.summary(companyId, false);
    const candidates = await this.candidates(companyId);
    return {
      summary,
      candidates,
      pick: pickOldest(candidates, summary.usedBytes, percent),
    };
  }

  /** O que a limpeza apagaria, sem apagar nada. */
  async preview(companyId: string, percent: number) {
    const { summary, pick } = await this.plan(companyId, percent);
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

  /** Apaga: marca as versões, registra na tarefa e na empresa, e remove. */
  async run(who: Who, percent: number, automatic = false) {
    const { candidates, pick } = await this.plan(who.companyId, percent);
    if (!pick.picked.length) {
      throw new UnprocessableEntityException(
        'Não há arquivos de O.S. entregues e concluídas para apagar.',
      );
    }
    const now = new Date();
    const ids = pick.picked.map((file) => file.id);
    const keys = new Map(candidates.map((file) => [file.id, file.storageKey]));
    const perTask = new Map<string, number>();
    for (const file of pick.picked) {
      perTask.set(file.taskId, (perTask.get(file.taskId) ?? 0) + 1);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.productionAttachmentVersion.updateMany({
        where: { id: { in: ids } },
        data: { removedAt: now },
      });
      for (const [taskId, count] of perTask) {
        await tx.productionTaskHistory.create({
          data: {
            taskId,
            byUserId: who.userId,
            byName: who.name,
            text: `${count === 1 ? '1 arquivo removido' : `${count} arquivos removidos`} na limpeza do espaço de ${brDay(now)}${automatic ? ' (automática)' : ''}`,
            affects: [],
          },
        });
      }
      await tx.productionStorageCleanup.create({
        data: {
          companyId: who.companyId,
          at: now,
          byUserId: who.userId,
          byName: who.name,
          automatic,
          percent,
          files: ids.length,
          bytes: pick.bytes,
        },
      });
    });
    for (const id of ids) {
      const key = keys.get(id);
      if (!key) continue;
      await this.storage
        .remove(key)
        .catch((error) =>
          this.logger.warn(`Arquivo não apagado (${key}): ${error.message}`),
        );
    }
    return { files: ids.length, bytes: pick.bytes, projects: pick.projects };
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

  async saveAuto(
    companyId: string,
    dto: { enabled: boolean; percent: number; threshold: number },
  ) {
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
  @Cron('40 3 * * *', { name: 'production-storage-auto-cleanup' })
  async runAutomatic() {
    const rows = await this.prisma.productionStorageAuto.findMany({
      where: { enabled: true },
    });
    for (const row of rows) {
      try {
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
