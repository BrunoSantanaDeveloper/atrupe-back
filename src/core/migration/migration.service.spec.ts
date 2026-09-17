import { MigrationService } from './migration.service';

describe('MigrationService', () => {
  let service: MigrationService;
  let prisma: any;
  let criados: any[];
  let emAndamento: any;
  let contas: any[];
  let cargasReais: any[];
  let legado: any;

  beforeEach(() => {
    criados = [];
    emAndamento = null;
    contas = [
      {
        id: 'empresa-1',
        name: 'Cliente Piloto',
        cnpj: '11.222.333/0001-81',
        isActive: true,
      },
    ];
    cargasReais = [];
    legado = { razao_social: 'Cliente Piloto LTDA', cnpj: '11222333000181' };

    prisma = {
      company: {
        findUnique: jest
          .fn()
          .mockImplementation(({ where }) =>
            Promise.resolve(contas.find((c) => c.id === where.id) ?? null),
          ),
        findMany: jest.fn().mockImplementation(() => Promise.resolve(contas)),
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
        findMany: jest
          .fn()
          .mockImplementation(() =>
            Promise.resolve(cargasReais.map((company) => ({ company }))),
          ),
      },
    };

    service = new MigrationService(prisma as any);
    jest
      .spyOn(service as any, 'legacyCompany')
      .mockImplementation(() => Promise.resolve(legado));
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

  describe('destino único por CNPJ', () => {
    it('recusa quando a base legada é de outro CNPJ', async () => {
      legado = { razao_social: 'Outro Cliente', cnpj: '99888777000166' };

      await expect(start()).rejects.toThrow(/não corresponde/);
      expect(criados).toHaveLength(0);
    });

    it('recusa quando a conta não tem CNPJ', async () => {
      contas[0].cnpj = null;

      await expect(start()).rejects.toThrow(/CNPJ ausente/);
      expect(criados).toHaveLength(0);
    });

    it('recusa quando duas contas têm o mesmo CNPJ, mesmo com máscara diferente', async () => {
      // Cada conta receberia uma cópia do histórico, e as duas divergiriam.
      contas.push({
        id: 'empresa-2',
        name: 'Cliente Piloto (duplicada)',
        cnpj: '11222333000181',
        isActive: true,
      });

      await expect(start()).rejects.toThrow(/cadastrado em 2 contas/);
      expect(criados).toHaveLength(0);
      expect((service as any).spawnRun).not.toHaveBeenCalled();
    });

    it('conta inativa com o mesmo CNPJ também bloqueia', async () => {
      // Reativada, dividiria os dados com a outra.
      contas.push({
        id: 'empresa-2',
        name: 'Conta antiga',
        cnpj: '11222333000181',
        isActive: false,
      });

      await expect(start()).rejects.toThrow(/Conta antiga .* inativa/);
    });

    it('recusa a base que já foi carregada em outra conta', async () => {
      // O CNPJ da conta antiga foi alterado depois da carga: sem o registro da
      // execução, nada mais ligaria essa conta à base.
      cargasReais = [{ id: 'empresa-antiga', name: 'Conta Antiga' }];

      await expect(start()).rejects.toThrow(/já foi migrada para Conta Antiga/);
      expect(criados).toHaveLength(0);
    });

    it('permite recarregar na mesma conta', async () => {
      // A carga é idempotente por código do legado; repetir é o caminho para
      // completar uma carga interrompida.
      cargasReais = [{ id: 'empresa-1', name: 'Cliente Piloto' }];

      await expect(start({ dryRun: false })).resolves.toMatchObject({
        id: 'run-1',
      });
    });
  });
});
