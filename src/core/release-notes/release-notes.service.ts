import { Injectable, NotFoundException } from '@nestjs/common';
import { PlanType, Prisma } from '@prisma/client';
import { PrismaService } from 'nestjs-prisma';
import { PlanControlService } from '../plan/plan-control.service';
import {
  CreateReleaseNoteDto,
  PublishReleaseNoteDto,
  UpdateReleaseNoteDto,
} from './dto/release-note.dto';

/** Quem pede: o usuário da sessão. */
export type ReleaseReader = {
  userId: string;
  companyId?: string | null;
  isSystemAdmin?: boolean;
};

export const RELEASE_NOTE_NOT_FOUND = 'Novidade não encontrada';

/** A lista do sino e da página Novidades */
const LIST_LIMIT = 50;

const NOTE_SELECT = {
  id: true,
  title: true,
  summary: true,
  version: true,
  items: true,
  plans: true,
  highlight: true,
  publishedAt: true,
} satisfies Prisma.ReleaseNoteSelect;

/**
 * As novidades do sistema (19/11/2026). O Super Admin escreve e publica cada
 * atualização, para todos os planos ou só para alguns. O cliente vê:
 *
 * - o sino do topo, com as não vistas;
 * - o aviso "O que mudou" no painel, uma vez, na primeira abertura depois da
 *   atualização marcada como destaque;
 * - a página Novidades, com todas as publicadas para o plano dele.
 *
 * Só conta como não vista a publicada depois que o usuário foi criado: quem
 * chega agora não recebe o aviso de uma atualização antiga.
 */
@Injectable()
export class ReleaseNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planControl: PlanControlService,
  ) {}

  /**
   * As publicadas que o leitor vê: as de todos os planos e as do plano da
   * empresa. O Super Admin vê todas. A conta em teste (TRIAL) vê as do Start,
   * o plano que ela testa.
   */
  private async visibleWhere(
    reader: ReleaseReader,
  ): Promise<Prisma.ReleaseNoteWhereInput> {
    const published = { publishedAt: { not: null, lte: new Date() } };
    if (reader.isSystemAdmin) return published;
    const info = reader.companyId
      ? await this.planControl.getCompanyPlanInfo(reader.companyId)
      : null;
    const planType = info?.planType as PlanType | undefined;
    const plans: PlanType[] = !planType
      ? []
      : planType === 'TRIAL'
        ? ['TRIAL', 'START']
        : [planType];
    return {
      ...published,
      OR: [
        { plans: { isEmpty: true } },
        ...(plans.length ? [{ plans: { hasSome: plans } }] : []),
      ],
    };
  }

  /** Desde quando as novidades contam como não vistas para o usuário. */
  private async readerSince(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { createdAt: true },
    });
    return user?.createdAt ?? new Date(0);
  }

  /** A página Novidades e a lista do sino: as mais novas primeiro. */
  async list(reader: ReleaseReader) {
    const [where, since] = await Promise.all([
      this.visibleWhere(reader),
      this.readerSince(reader.userId),
    ]);
    const notes = await this.prisma.releaseNote.findMany({
      where,
      orderBy: { publishedAt: 'desc' },
      take: LIST_LIMIT,
      select: {
        ...NOTE_SELECT,
        reads: {
          where: { userId: reader.userId },
          select: { seenAt: true },
        },
      },
    });
    return notes.map(({ reads, ...note }) => ({
      ...note,
      // A anterior ao usuário nasce vista: não acende o sino
      seen: !!reads[0]?.seenAt || note.publishedAt! < since,
    }));
  }

  /**
   * O sino e o painel: quantas não vistas, e a atualização que o painel
   * anuncia (a mais nova em destaque que o usuário ainda não viu no aviso).
   */
  async summary(reader: ReleaseReader) {
    const [where, since] = await Promise.all([
      this.visibleWhere(reader),
      this.readerSince(reader.userId),
    ]);
    const fresh: Prisma.ReleaseNoteWhereInput = {
      AND: [where, { publishedAt: { gte: since } }],
    };
    const [unread, announce] = await Promise.all([
      this.prisma.releaseNote.count({
        where: {
          AND: [
            fresh,
            {
              reads: {
                none: { userId: reader.userId, seenAt: { not: null } },
              },
            },
          ],
        },
      }),
      this.prisma.releaseNote.findFirst({
        where: {
          AND: [
            fresh,
            { highlight: true },
            {
              reads: {
                none: { userId: reader.userId, announcedAt: { not: null } },
              },
            },
          ],
        },
        orderBy: { publishedAt: 'desc' },
        select: NOTE_SELECT,
      }),
    ]);
    return { unread, announce };
  }

  /** O sino aberto: marca como vistas as indicadas, ou todas as visíveis. */
  async markSeen(reader: ReleaseReader, ids?: string[]) {
    const where = await this.visibleWhere(reader);
    const notes = await this.prisma.releaseNote.findMany({
      where: ids?.length ? { AND: [where, { id: { in: ids } }] } : where,
      select: { id: true },
    });
    const now = new Date();
    await this.prisma.$transaction(
      notes.map((note) =>
        this.prisma.releaseNoteRead.upsert({
          where: {
            releaseNoteId_userId: {
              releaseNoteId: note.id,
              userId: reader.userId,
            },
          },
          create: {
            releaseNoteId: note.id,
            userId: reader.userId,
            seenAt: now,
          },
          update: { seenAt: now },
        }),
      ),
    );
    return { seen: notes.length };
  }

  /** O aviso do painel fechado: não abre de novo, e a novidade fica vista. */
  async markAnnounced(reader: ReleaseReader, id: string) {
    const where = await this.visibleWhere(reader);
    const note = await this.prisma.releaseNote.findFirst({
      where: { AND: [where, { id }] },
      select: { id: true },
    });
    if (!note) throw new NotFoundException(RELEASE_NOTE_NOT_FOUND);
    const now = new Date();
    await this.prisma.releaseNoteRead.upsert({
      where: {
        releaseNoteId_userId: { releaseNoteId: id, userId: reader.userId },
      },
      create: {
        releaseNoteId: id,
        userId: reader.userId,
        seenAt: now,
        announcedAt: now,
      },
      update: { seenAt: now, announcedAt: now },
    });
    return { id };
  }

  // ---------------------------------------------------------------------
  // Super Admin
  // ---------------------------------------------------------------------

  /** Todas, rascunhos primeiro, com quantos usuários já viram. */
  async adminList() {
    const notes = await this.prisma.releaseNote.findMany({
      orderBy: [{ publishedAt: { sort: 'desc', nulls: 'first' } }],
      select: {
        ...NOTE_SELECT,
        createdByName: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { reads: { where: { seenAt: { not: null } } } } },
      },
    });
    return notes.map(({ _count, ...note }) => ({
      ...note,
      seenCount: _count.reads,
    }));
  }

  async create(dto: CreateReleaseNoteDto, authorName?: string | null) {
    return this.prisma.releaseNote.create({
      data: {
        title: dto.title.trim(),
        summary: dto.summary.trim(),
        version: dto.version?.trim() || null,
        items: this.items(dto.items),
        plans: [...new Set(dto.plans ?? [])],
        highlight: dto.highlight ?? true,
        createdByName: authorName ?? null,
      },
      select: NOTE_SELECT,
    });
  }

  async update(id: string, dto: UpdateReleaseNoteDto) {
    await this.exists(id);
    return this.prisma.releaseNote.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.summary !== undefined ? { summary: dto.summary.trim() } : {}),
        ...(dto.version !== undefined
          ? { version: dto.version?.trim() || null }
          : {}),
        ...(dto.items !== undefined ? { items: this.items(dto.items) } : {}),
        ...(dto.plans !== undefined ? { plans: [...new Set(dto.plans)] } : {}),
        ...(dto.highlight !== undefined ? { highlight: dto.highlight } : {}),
      },
      select: NOTE_SELECT,
    });
  }

  /** Publicar: agora, ou na data indicada (pode ser futura). */
  async publish(id: string, dto: PublishReleaseNoteDto) {
    await this.exists(id);
    return this.prisma.releaseNote.update({
      where: { id },
      data: {
        publishedAt: dto.publishedAt ? new Date(dto.publishedAt) : new Date(),
      },
      select: NOTE_SELECT,
    });
  }

  /** Voltar a rascunho: some do sino e da página; as leituras ficam. */
  async unpublish(id: string) {
    await this.exists(id);
    return this.prisma.releaseNote.update({
      where: { id },
      data: { publishedAt: null },
      select: NOTE_SELECT,
    });
  }

  async remove(id: string) {
    await this.exists(id);
    await this.prisma.releaseNote.delete({ where: { id } });
    return { id };
  }

  private async exists(id: string) {
    const found = await this.prisma.releaseNote.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found) throw new NotFoundException(RELEASE_NOTE_NOT_FOUND);
  }

  /** As mudanças sem linha vazia, com o texto aparado. */
  private items(items: { kind: string; text: string }[]) {
    return items
      .map((item) => ({ kind: item.kind, text: item.text.trim() }))
      .filter((item) => item.text) as unknown as Prisma.InputJsonValue;
  }
}
