import {
  NO_MANAGER_ACCESS,
  ProductionAccessService,
  ProductionViewer,
} from './production-access.service';
import { aggregateStatus } from './production-mirror.service';

const viewer = (patch: Partial<ProductionViewer> = {}): ProductionViewer => ({
  companyId: 'c-1',
  userId: 'u-1',
  employeeId: 'e-me',
  name: 'Marcos',
  manager: false,
  timeEditor: false,
  productivity: false,
  access: new Map(),
  ...patch,
});

const task = (patch = {}) => ({
  managerId: 'm-imp',
  assigneeId: null,
  workerIds: [],
  affectedIds: [],
  ...patch,
});

describe('ProductionAccessService: quem vê o quê (GP-11)', () => {
  const service = new ProductionAccessService({} as any, {} as any);

  it('o gerente vê tudo', () => {
    expect(service.canSee(viewer({ manager: true }), task())).toBe(true);
  });

  it('o operador sem acesso ao gerenciador não vê', () => {
    expect(service.canSee(viewer(), task())).toBe(false);
    expect(() => service.assertManagerAccess(viewer(), 'm-imp')).toThrow(
      NO_MANAGER_ACCESS,
    );
  });

  it('com acesso a tudo, vê as tarefas do gerenciador', () => {
    const me = viewer({
      access: new Map([['m-imp', { onlyAssigned: false }]]),
    });
    expect(service.canSee(me, task())).toBe(true);
    expect(service.canSee(me, task({ managerId: 'm-outro' }))).toBe(false);
  });

  describe('com "só o seu"', () => {
    const me = viewer({ access: new Map([['m-imp', { onlyAssigned: true }]]) });

    it('não vê a tarefa dos outros', () => {
      expect(service.canSee(me, task({ assigneeId: 'e-ana' }))).toBe(false);
    });

    it.each([
      ['atribuída a ele', { assigneeId: 'e-me' }],
      ['em que trabalha', { workerIds: ['e-me'] }],
      ['em que uma correção o afetou (GP-44)', { affectedIds: ['e-me'] }],
    ])('vê a tarefa %s', (_label, patch) => {
      expect(service.canSee(me, task(patch))).toBe(true);
    });
  });

  it('sem colaborador nesta empresa, o operador não vê nada', () => {
    const me = viewer({
      employeeId: null,
      access: new Map([['m-imp', { onlyAssigned: false }]]),
    });
    expect(service.canSee(me, task())).toBe(false);
  });
});

describe('aggregateStatus: a etapa da agenda espelha as tarefas (D20)', () => {
  it.each([
    [[], 'NOT_STARTED'],
    [['NOT_STARTED', 'NOT_STARTED'], 'NOT_STARTED'],
    [['DONE', 'CANCELED'], 'DONE'],
    [['CANCELED', 'CANCELED'], 'CANCELED'],
    [['DONE', 'NOT_STARTED'], 'IN_PROGRESS'],
    [['PAUSED', 'PENDING', 'IN_PROGRESS'], 'IN_PROGRESS'],
    [['PAUSED', 'PENDING'], 'PENDING'],
    [['PAUSED', 'NOT_STARTED'], 'PAUSED'],
  ] as const)('%j → %s', (statuses, expected) => {
    expect(aggregateStatus([...statuses])).toBe(expected);
  });
});
