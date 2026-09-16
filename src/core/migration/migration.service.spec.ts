import { MigrationService } from './migration.service';

describe('MigrationService', () => {
  let service: MigrationService;
  let prisma: any;
  let criados: any[];
  let emAndamento: any;

  beforeEach(() => {
    criados = [];
    emAndamento = null;

    prisma = {
      company: {
        findUnique: jest
          .fn()
          .mockImplementation(({ where }) =>
            Promise.resolve(
              where.id === 'empresa-1'
                ? { id: 'empresa-1', name: 'Cliente Piloto' }
                : null,
            ),
          ),
      },
      migrationRun: {
        findFirst: jest
          .fn()
          .mockImplementation(() => Promise.resolve(emAndamento)),
        create: jest.fn().mockImplementation(({ data }) => {
          criados.push(data);
          return Promise.resolve({ id: 'run-1', ...data });
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    service = new MigrationService(prisma as any);
    // O disparo do processo é efeito colateral do sistema operacional; aqui
    // interessa a regra que decide se ele acontece.
    jest.spyOn(service as any, 'spawnRun').mockImplementation(() => undefined);
  });

  const start = (over: any = {}) =>
    service.start({
      companyId: 'empresa-1',
      legacyBase: 'acn_001676',
      dryRun: true,
      startedById: 'admin-1',
      ...over,
    });

  it('registra a execução e dispara o processo', async () => {
    const run = await start();

    expect(run.id).toBe('run-1');
    expect(criados[0]).toMatchObject({
      companyId: 'empresa-1',
      legacyBase: 'acn_001676',
      startedById: 'admin-1',
    });
    expect((service as any).spawnRun).toHaveBeenCalled();
  });

  it('recusa uma segunda migração enquanto outra roda', async () => {
    // Duas cargas simultâneas disputariam o mesmo banco e nenhum dos dois
    // relatórios seria confiável.
    emAndamento = { id: 'run-0', company: { name: 'Outro Cliente' } };

    await expect(start()).rejects.toThrow(
      /já existe uma migração em andamento/i,
    );
    expect(criados).toHaveLength(0);
  });

  it('recusa nome de base fora do formato', async () => {
    // Nome de base errado despejaria os dados de um cliente na empresa de
    // outro; a conferência de CNPJ na carga é a segunda barreira.
    await expect(start({ legacyBase: 'producao' })).rejects.toThrow(
      /Nome de base inválido/,
    );
    await expect(start({ legacyBase: 'acn_001676; DROP' })).rejects.toThrow(
      /Nome de base inválido/,
    );
    expect(criados).toHaveLength(0);
  });

  it('recusa empresa inexistente', async () => {
    await expect(start({ companyId: 'nao-existe' })).rejects.toThrow(
      /Empresa não encontrada/,
    );
  });

  it('não dispara o processo quando a validação falha', async () => {
    await expect(start({ legacyBase: 'x' })).rejects.toThrow();
    expect((service as any).spawnRun).not.toHaveBeenCalled();
  });
});
