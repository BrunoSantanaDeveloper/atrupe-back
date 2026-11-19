import { NotFoundException } from '@nestjs/common';
import { ReleaseNotesService } from './release-notes.service';

/**
 * As novidades do sistema (19/11/2026): o plano decide o que a empresa vê,
 * só conta como não vista o que saiu depois de o usuário existir, e o aviso
 * do painel abre uma vez.
 */
describe('ReleaseNotesService', () => {
  let prisma: any;
  let planControl: any;
  let service: ReleaseNotesService;
  const userCreated = new Date('2026-11-01T12:00:00Z');

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ createdAt: userCreated }),
      },
      releaseNote: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({ id: 'n-1' }),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(async ({ data }) => ({ id: 'n-1', ...data })),
        update: jest.fn(async ({ data }) => ({ id: 'n-1', ...data })),
        delete: jest.fn(),
      },
      releaseNoteRead: { upsert: jest.fn((args) => args) },
      $transaction: jest.fn(async (ops) => ops),
    };
    planControl = {
      getCompanyPlanInfo: jest.fn().mockResolvedValue({ planType: 'START' }),
    };
    service = new ReleaseNotesService(prisma, planControl);
  });

  const reader = { userId: 'u-1', companyId: 'c-1' };
  const whereOf = () => prisma.releaseNote.findMany.mock.calls[0][0].where;

  it('a empresa do Start vê as de todos os planos e as do Start, publicadas', async () => {
    await service.list(reader);
    expect(whereOf()).toEqual({
      publishedAt: { not: null, lte: expect.any(Date) },
      OR: [{ plans: { isEmpty: true } }, { plans: { hasSome: ['START'] } }],
    });
  });

  it('a conta em teste vê também as do Start', async () => {
    planControl.getCompanyPlanInfo.mockResolvedValue({ planType: 'TRIAL' });
    await service.list(reader);
    expect(whereOf().OR[1]).toEqual({
      plans: { hasSome: ['TRIAL', 'START'] },
    });
  });

  it('sem plano, só as de todos os planos', async () => {
    planControl.getCompanyPlanInfo.mockResolvedValue(null);
    await service.list(reader);
    expect(whereOf().OR).toEqual([{ plans: { isEmpty: true } }]);
  });

  it('o Super Admin vê todas as publicadas, sem filtro de plano', async () => {
    await service.list({ userId: 'u-1', isSystemAdmin: true });
    expect(whereOf()).not.toHaveProperty('OR');
    expect(planControl.getCompanyPlanInfo).not.toHaveBeenCalled();
  });

  it('a lista marca vista a já lida e a anterior ao usuário', async () => {
    prisma.releaseNote.findMany.mockResolvedValue([
      {
        id: 'nova',
        publishedAt: new Date('2026-11-19T12:00:00Z'),
        reads: [],
      },
      {
        id: 'lida',
        publishedAt: new Date('2026-11-10T12:00:00Z'),
        reads: [{ seenAt: new Date() }],
      },
      {
        id: 'antiga',
        publishedAt: new Date('2026-10-01T12:00:00Z'),
        reads: [],
      },
    ]);
    const list = await service.list(reader);
    expect(list.map((note) => [note.id, note.seen])).toEqual([
      ['nova', false],
      ['lida', true],
      ['antiga', true],
    ]);
    expect(list[0]).not.toHaveProperty('reads');
  });

  it('o resumo só conta a publicada depois de o usuário existir', async () => {
    prisma.releaseNote.count.mockResolvedValue(2);
    const result = await service.summary(reader);
    expect(result.unread).toBe(2);
    const where = prisma.releaseNote.count.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain(userCreated.toISOString());
    const announce = prisma.releaseNote.findFirst.mock.calls[0][0];
    expect(JSON.stringify(announce.where)).toContain('"highlight":true');
    expect(announce.orderBy).toEqual({ publishedAt: 'desc' });
  });

  it('o aviso do painel marca anunciada e vista', async () => {
    prisma.releaseNote.findFirst.mockResolvedValue({ id: 'n-1' });
    await service.markAnnounced(reader, 'n-1');
    const args = prisma.releaseNoteRead.upsert.mock.calls[0][0];
    expect(args.update).toEqual({
      seenAt: expect.any(Date),
      announcedAt: expect.any(Date),
    });
  });

  it('não anuncia a novidade que o plano não vê', async () => {
    prisma.releaseNote.findFirst.mockResolvedValue(null);
    await expect(service.markAnnounced(reader, 'n-2')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.releaseNoteRead.upsert).not.toHaveBeenCalled();
  });

  it('o sino aberto marca vistas as visíveis', async () => {
    prisma.releaseNote.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    const result = await service.markSeen(reader);
    expect(result).toEqual({ seen: 2 });
    expect(prisma.releaseNoteRead.upsert).toHaveBeenCalledTimes(2);
  });

  it('a nova nasce rascunho, sem mudança vazia e sem plano repetido', async () => {
    const created = await service.create(
      {
        title: ' Orçamento mais rápido ',
        summary: ' O que muda ',
        items: [
          { kind: 'NEW', text: ' Busca no item ' },
          { kind: 'FIX', text: '   ' },
        ],
        plans: ['START', 'START'],
      },
      'Bruno',
    );
    const data = prisma.releaseNote.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      title: 'Orçamento mais rápido',
      summary: 'O que muda',
      items: [{ kind: 'NEW', text: 'Busca no item' }],
      plans: ['START'],
      highlight: true,
      createdByName: 'Bruno',
    });
    expect(data).not.toHaveProperty('publishedAt');
    expect(created.id).toBe('n-1');
  });

  it('publicar sem data publica agora; a novidade que não existe dá 404', async () => {
    await service.publish('n-1', {});
    expect(prisma.releaseNote.update.mock.calls[0][0].data.publishedAt).toEqual(
      expect.any(Date),
    );
    prisma.releaseNote.findUnique.mockResolvedValue(null);
    await expect(service.publish('x', {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
