import { EXECUCAO_INTERROMPIDA, MigrationService } from './migration.service';

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
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockImplementation(() =>
          Promise.resolve(
            cargasReais.map(({ base, company }) => ({
              legacyBase: base,
              company,
            })),
          ),
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

  describe('execução órfã de um contêiner anterior', () => {
    // CENCOM, 18/11: um deploy trocou o contêiner 9 minutos depois do início
    // da simulação. O processo morreu junto, o registro ficou "em andamento"
    // e passou a recusar qualquer migração nova.
    const encerramento = () =>
      prisma.migrationRun.updateMany.mock.calls.at(-1)[0];

    it('é encerrada como falha antes de conferir a fila', async () => {
      const antes = Date.now();
      await start();

      const { where, data } = encerramento();
      expect(where.status).toEqual({ in: ['QUEUED', 'RUNNING'] });
      expect(data).toMatchObject({
        status: 'FAILED',
        failureReason: EXECUCAO_INTERROMPIDA,
      });
      // Só a que começou antes deste processo subir: a que ele mesmo
      // disparou está viva.
      expect(where.createdAt.lt.getTime()).toBeLessThanOrEqual(antes);
      expect(
        prisma.migrationRun.updateMany.mock.invocationCallOrder[0],
      ).toBeLessThan(prisma.migrationRun.findFirst.mock.invocationCallOrder[0]);
    });

    it('é encerrada quando a API sobe', async () => {
      await service.onModuleInit();

      expect(encerramento().data.status).toBe('FAILED');
    });

    it('falha ao conferir não derruba a subida da API', async () => {
      prisma.migrationRun.updateMany.mockRejectedValueOnce(
        new Error('banco fora'),
      );

      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
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
      cargasReais = [
        {
          base: 'acn_001676',
          company: { id: 'empresa-antiga', name: 'Conta Antiga' },
        },
      ];

      await expect(start()).rejects.toThrow(/já foi migrada para Conta Antiga/);
      expect(criados).toHaveLength(0);
    });

    it('permite recarregar na mesma conta', async () => {
      // A carga é idempotente por código do legado; repetir é o caminho para
      // completar uma carga interrompida.
      cargasReais = [
        {
          base: 'acn_001676',
          company: { id: 'empresa-1', name: 'Cliente Piloto' },
        },
      ];

      await expect(start({ dryRun: false })).resolves.toMatchObject({
        id: 'run-1',
      });
    });

    it('recusa a conta que já recebeu outra base do legado', async () => {
      // As bases numeram os registros a partir do 1: os desta base seriam
      // confundidos com os da anterior.
      cargasReais = [
        {
          base: 'acn_000999',
          company: { id: 'empresa-1', name: 'Cliente Piloto' },
        },
      ];

      await expect(start()).rejects.toThrow(/já recebeu a base acn_000999/);
      expect(criados).toHaveLength(0);
    });
  });

  describe('busca por CNPJ', () => {
    let basesLegado: Record<string, any>;
    let pool: any;

    const naoFatal = () =>
      Object.assign(new Error('tabela ausente'), {
        errno: 1146,
        sqlMessage: "Table 'emp_minha_empresa' doesn't exist",
      });

    beforeEach(() => {
      basesLegado = {
        acn_000001: { razao_social: 'Outro Cliente', cnpj: '99888777000166' },
        acn_001676: {
          razao_social: 'Cliente Piloto LTDA',
          cnpj: '11.222.333/0001-81',
        },
      };

      pool = {
        query: jest.fn().mockImplementation((sql: string) => {
          if (sql === 'SHOW DATABASES') {
            return Promise.resolve([
              [
                { Database: 'information_schema' },
                ...Object.keys(basesLegado).map((b) => ({ Database: b })),
              ],
            ]);
          }
          const base = Object.keys(basesLegado).find((b) =>
            sql.includes(`${b}.`),
          );
          const dados = basesLegado[base as string];
          if (dados instanceof Error) return Promise.reject(dados);
          return Promise.resolve([dados ? [dados] : []]);
        }),
        end: jest.fn().mockResolvedValue(undefined),
      };
      jest.spyOn(service as any, 'legacyPool').mockReturnValue(pool);
    });

    it('encontra a base pelo CNPJ e vincula a conta, com ou sem máscara', async () => {
      const busca = await service.findLegacyBases('11222333000181');

      expect(busca.basesConsultadas).toBe(2);
      expect(busca.encontradas).toEqual([
        {
          base: 'acn_001676',
          razaoSocial: 'Cliente Piloto LTDA',
          cnpj: '11.222.333/0001-81',
          empresaVinculada: { id: 'empresa-1', name: 'Cliente Piloto' },
          bloqueio: null,
        },
      ]);
      expect(pool.end).toHaveBeenCalled();
    });

    it('sem conta com o CNPJ, devolve a base sem vínculo', async () => {
      contas = [];

      const busca = await service.findLegacyBases('11.222.333/0001-81');

      expect(busca.encontradas[0]).toMatchObject({
        base: 'acn_001676',
        empresaVinculada: null,
        bloqueio: null,
      });
    });

    it('não encontrado informa quantas bases foram consultadas', async () => {
      // Com poucas bases lidas, o suporte entende que a do cliente pode não
      // estar liberada, e não que o CNPJ está errado.
      delete basesLegado.acn_001676;

      const busca = await service.findLegacyBases('11222333000181');

      expect(busca.basesConsultadas).toBe(1);
      expect(busca.encontradas).toEqual([]);
    });

    it('não encontrado mostra o que foi lido em cada base liberada', async () => {
      // É a evidência para conferir com o time do legado: a base está entre as
      // liberadas? com que documento ela está cadastrada?
      delete basesLegado.acn_001676;

      const busca = await service.findLegacyBases('11222333000181');

      expect(busca.consultadas).toEqual([
        {
          base: 'acn_000001',
          razaoSocial: 'Outro Cliente',
          cnpj: '99888777000166',
          cpf: null,
        },
      ]);
    });

    it('base liberada só no banco aparece com o motivo da recusa', async () => {
      // Permissão no banco sem permissão nas tabelas: a base aparece em SHOW
      // DATABASES, mas a leitura da empresa é negada.
      basesLegado.acn_000001 = Object.assign(new Error('negado'), {
        errno: 1142,
        sqlMessage: "SELECT command denied to user 'migracao'",
      });
      delete basesLegado.acn_001676;

      const busca = await service.findLegacyBases('11222333000181');

      expect(busca.consultadas?.[0]).toMatchObject({
        base: 'acn_000001',
        erro: "SELECT command denied to user 'migracao'",
      });
    });

    it('base sem a tabela da empresa não derruba a busca', async () => {
      basesLegado.acn_000001 = naoFatal();

      const busca = await service.findLegacyBases('11222333000181');

      expect(busca.encontradas.map((b) => b.base)).toEqual(['acn_001676']);
    });

    it('queda de conexão no meio da busca é erro, não "não encontrado"', async () => {
      basesLegado.acn_000001 = Object.assign(new Error('conexão perdida'), {
        fatal: true,
        code: 'PROTOCOL_CONNECTION_LOST',
      });

      await expect(service.findLegacyBases('11222333000181')).rejects.toThrow(
        /conexão perdida/,
      );
      expect(pool.end).toHaveBeenCalled();
    });

    it('explica quando o usuário do legado não lê nenhuma base', async () => {
      basesLegado = {};

      await expect(service.findLegacyBases('11222333000181')).rejects.toThrow(
        /não tem permissão de leitura em nenhuma base/,
      );
    });

    it('traduz a falha de conexão com o legado', async () => {
      pool.query.mockRejectedValueOnce(
        Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }),
      );

      await expect(service.findLegacyBases('11222333000181')).rejects.toThrow(
        /Não foi possível conectar ao banco legado \(ETIMEDOUT\)/,
      );
    });

    it('com o CNPJ em duas bases, a conta que já recebeu uma bloqueia a outra', async () => {
      basesLegado.acn_000002 = { ...basesLegado.acn_001676 };
      cargasReais = [
        {
          base: 'acn_001676',
          company: { id: 'empresa-1', name: 'Cliente Piloto' },
        },
      ];

      const busca = await service.findLegacyBases('11222333000181');
      const porBase = Object.fromEntries(
        busca.encontradas.map((b) => [b.base, b.bloqueio]),
      );

      expect(porBase.acn_001676).toBeNull();
      expect(porBase.acn_000002).toMatch(/já recebeu a base acn_001676/);
    });

    it('recusa CNPJ ausente ou inválido sem consultar o legado', async () => {
      await expect(service.findLegacyBases('')).rejects.toThrow(
        /Informe o CNPJ/,
      );
      await expect(
        service.findLegacyBases('11.222.333/0001-00'),
      ).rejects.toThrow(/CNPJ inválido/);
      expect((service as any).legacyPool).not.toHaveBeenCalled();
    });

    it('avisa quando o acesso ao legado não está configurado', async () => {
      (service as any).legacyPool.mockRestore();
      const host = process.env.LEGACY_DB_HOST;
      delete process.env.LEGACY_DB_HOST;

      try {
        await expect(service.findLegacyBases('11222333000181')).rejects.toThrow(
          /não configurado neste ambiente/,
        );
      } finally {
        if (host !== undefined) process.env.LEGACY_DB_HOST = host;
      }
    });
  });
});
