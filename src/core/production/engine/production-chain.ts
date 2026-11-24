/**
 * A cadeia de produção (área 9 §12.2, GP-42, PR-2, FL-13): o que se deriva
 * das tarefas em toda leitura. Nada aqui é gravado, porque depende do
 * relógio: o tempo apontado corre, o horário agendado passa e o que falta
 * deixa de caber até a entrega. Nunca reagenda nada sozinho.
 *
 * Pura: o relógio vem de fora (now, e como transformar dia + hora local num
 * instante), para os testes fixarem o momento.
 */

export type TaskStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'PAUSED'
  | 'PENDING'
  | 'DONE'
  | 'CANCELED';

export type ProjectStatus = 'STANDBY' | 'PRODUCTION' | 'DONE' | 'CANCELED';

export type ChainEntry = { start: Date; end: Date | null; seconds: number };

export type ChainTask = {
  id: string;
  projectId: string;
  stageName: string;
  status: TaskStatus;
  estimatedMinutes: number;
  dependsOn: string[];
  /** Liberou a próxima etapa antes de concluir (FL-13) */
  released: boolean;
  /** O cadeado na agenda (24/11/2026): não anda; a cadeia avisa se não chega */
  locked?: boolean;
  /**
   * A espera depois de concluir antes da etapa seguinte (ex.: secagem), do
   * gerenciador onde a tarefa termina (GP-48 item 21)
   */
  afterDoneMinutes?: number;
  /** Agendada só no dia (GP-49): sem a hora, vale até o fim do expediente */
  schedule: ChainSchedule | null;
  /**
   * Os outros blocos de agenda (GP-52): o resto de um trabalho dividido e o
   * tempo extra. O prazo da tarefa é o fim do último bloco
   */
  slots?: ChainSchedule[];
  entries: ChainEntry[];
  /**
   * O expediente do gerenciador onde a tarefa está (GP-48 item 19); sem ele,
   * o da empresa. Os dias e os feriados são sempre os da empresa.
   */
  hours?: WorkHours | null;
};

export type ChainSchedule = {
  date: string;
  start: string | null;
  minutes: number;
};

export type WorkHours = {
  startTime: string;
  endTime: string;
  breakStart?: string | null;
  breakEnd?: string | null;
};

export type ChainProject = {
  id: string;
  status: ProjectStatus;
  due: string;
  /** A hora da entrega na venda (opcional, "HH:MM"); sem ela, o fim do expediente */
  dueTime?: string | null;
};

export type ChainAlert = {
  kind: 'OVERDUE' | 'LATE_PREDECESSOR' | 'DELIVERY_RISK';
  text: string;
};

export type ChainClock = {
  now: Date;
  /** O instante do dia (YYYY-MM-DD) e da hora (HH:mm) no fuso da empresa */
  at: (date: string, time: string) => Date;
  /** O dia (YYYY-MM-DD) do instante no fuso da empresa */
  dayOf: (instant: Date) => string;
  /** O expediente da empresa; sem ele, o padrão */
  calendar?: WorkCalendar;
};

/** O expediente (§4.8): dias da semana (0 = domingo), horário e feriados. */
export type WorkCalendar = {
  workDays: number[];
  startTime: string;
  endTime: string;
  holidays: string[];
  /** O intervalo (almoço), opcional: o gerenciador novo copia (GP-49) */
  breakStart?: string | null;
  breakEnd?: string | null;
  /**
   * Quando uma etapa atrasa (24/11/2026): só avisar a cadeia, ou avisar e
   * reagendar (a agenda viva, chain-replan.ts)
   */
  liveSchedule?: 'WARN' | 'RESCHEDULE';
};

/** O expediente de referência até existir calendário (§4.8): 8h às 18h. */
export const WORK_START = '08:00';
export const WORK_END = '18:00';

/**
 * O expediente sem cadastro: segunda a sexta, das 08:00 às 18:00. O fim de
 * semana não conta, para a cadeia não acusar risco falso (decisão de
 * 15/10/2026); quem trabalha no sábado marca no expediente.
 */
export const DEFAULT_CALENDAR: WorkCalendar = {
  workDays: [1, 2, 3, 4, 5],
  startTime: WORK_START,
  endTime: WORK_END,
  holidays: [],
  breakStart: null,
  breakEnd: null,
};

const weekdayOf = (day: string) => new Date(`${day}T12:00:00.000Z`).getUTCDay();

/** Quantos dias a conta do expediente percorre, no máximo. */
const MAX_DAYS = 400;

export const isOpen = (status: TaskStatus) =>
  status !== 'DONE' && status !== 'CANCELED';

const round1 = (value: number) => Math.round(value * 10) / 10;

const nextDay = (day: string) => {
  const date = new Date(`${day}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

const brDate = (day: string) => day.split('-').reverse().join('/');

/** Minutos de um trecho; o aberto corre até agora. */
export const entryMinutes = (entry: ChainEntry, now: Date) =>
  entry.end
    ? entry.seconds / 60
    : Math.max(0, (now.getTime() - entry.start.getTime()) / 60000);

export class ProductionChain {
  private readonly byId = new Map<string, ChainTask>();
  private readonly dependents = new Map<string, ChainTask[]>();
  private readonly alerts = new Map<string, ChainAlert | null>();
  private readonly ahead = new Map<string, number>();
  private readonly visitingAlert = new Set<string>();
  private readonly visitingAhead = new Set<string>();
  private readonly available = new Map<string, number>();

  constructor(
    tasks: ChainTask[],
    private readonly projects: Map<string, ChainProject>,
    private readonly clock: ChainClock,
  ) {
    for (const task of tasks) this.byId.set(task.id, task);
    for (const task of tasks) {
      for (const id of task.dependsOn) {
        const list = this.dependents.get(id) ?? [];
        list.push(task);
        this.dependents.set(id, list);
      }
    }
  }

  get today() {
    return this.clock.dayOf(this.clock.now);
  }

  task(id: string) {
    return this.byId.get(id) ?? null;
  }

  /** Os trechos fechados mais o que corre nos abertos, com uma casa. */
  actualMinutes(task: ChainTask) {
    return round1(
      task.entries.reduce(
        (sum, entry) => sum + entryMinutes(entry, this.clock.now),
        0,
      ),
    );
  }

  /** A anterior libera quando termina, cancela ou libera antes (FL-13). */
  private satisfied(dependency: ChainTask) {
    return !isOpen(dependency.status) || dependency.released;
  }

  /** A etapa que trava esta (PR-2): só vale para a que não começou. */
  blocker(task: ChainTask) {
    if (task.status !== 'NOT_STARTED') return null;
    for (const id of task.dependsOn) {
      const dependency = this.byId.get(id);
      if (dependency && !this.satisfied(dependency)) return dependency;
    }
    return null;
  }

  blocking(task: ChainTask) {
    const project = this.projects.get(task.projectId);
    const blocker = this.blocker(task);
    const standby = project?.status === 'STANDBY';
    return {
      blocked: !!blocker || standby,
      blockedBy: blocker
        ? blocker.stageName
        : standby
          ? 'produção não liberada'
          : null,
    };
  }

  /** Aberta, com a entrega do projeto antes de hoje (GP-18). */
  late(task: ChainTask) {
    const project = this.projects.get(task.projectId);
    return !!project && isOpen(task.status) && project.due < this.today;
  }

  private blockEnd(task: ChainTask, block: ChainSchedule) {
    // Só o dia: o prazo é o fim do expediente daquele dia
    if (!block.start) {
      const hours = this.hoursOf(task);
      return this.clock.at(block.date, hours.endTime);
    }
    const start = this.clock.at(block.date, block.start);
    return new Date(start.getTime() + block.minutes * 60000);
  }

  /** O fim do último bloco de agenda (GP-52); sem o bloco 1, nenhum. */
  private scheduleEnd(task: ChainTask) {
    if (!task.schedule) return null;
    return [task.schedule, ...(task.slots ?? [])]
      .map((block) => this.blockEnd(task, block))
      .reduce((last, end) => (end.getTime() > last.getTime() ? end : last));
  }

  /** O último dia agendado, entre todos os blocos (GP-52). */
  private lastScheduledDay(task: ChainTask) {
    if (!task.schedule) return null;
    return [task.schedule, ...(task.slots ?? [])].reduce(
      (last, block) => (block.date > last ? block.date : last),
      task.schedule.date,
    );
  }

  /**
   * Quando a etapa deve terminar: o fim agendado, ou agora mais o que falta,
   * o que vier depois
   */
  private expectedEnd(task: ChainTask) {
    const end = this.scheduleEnd(task);
    const left = Math.max(0, task.estimatedMinutes - this.actualMinutes(task));
    const fromNow = new Date(this.clock.now.getTime() + left * 60000);
    if (!end) return task.status === 'NOT_STARTED' ? null : fromNow;
    return end.getTime() > fromNow.getTime() ? end : fromNow;
  }

  /** Passou do horário planejado sem terminar. */
  overdue(task: ChainTask) {
    const end = this.scheduleEnd(task);
    return (
      !!end && isOpen(task.status) && end.getTime() < this.clock.now.getTime()
    );
  }

  /**
   * O que ainda falta desta etapa para a frente, no caminho mais longo
   * (§4.7): o previsto menos o apontado desta, mais a maior cadeia das
   * dependentes abertas.
   */
  remainingAhead(task: ChainTask): number {
    const cached = this.ahead.get(task.id);
    if (cached !== undefined) return cached;
    // Dependência em círculo é erro de cadastro: não conta duas vezes
    if (this.visitingAhead.has(task.id)) return 0;
    this.visitingAhead.add(task.id);
    const own = isOpen(task.status)
      ? Math.max(task.estimatedMinutes - this.actualMinutes(task), 0)
      : 0;
    const next = (this.dependents.get(task.id) ?? [])
      .filter((item) => isOpen(item.status))
      .map((item) => this.remainingAhead(item));
    this.visitingAhead.delete(task.id);
    // A espera depois de concluir (secagem) só conta enquanto a etapa está
    // aberta: concluída, ela já passou a contar no relógio
    const wait =
      next.length && isOpen(task.status) ? (task.afterDoneMinutes ?? 0) : 0;
    const total = own + (next.length ? wait + Math.max(...next) : 0);
    this.ahead.set(task.id, total);
    return total;
  }

  /** O expediente da tarefa: o do gerenciador, ou o da empresa. */
  private hoursOf(task?: ChainTask): WorkHours {
    const calendar = this.clock.calendar ?? DEFAULT_CALENDAR;
    return task?.hours?.startTime && task.hours.endTime ? task.hours : calendar;
  }

  /**
   * Os minutos de expediente de agora até o fim do dia da entrega, no
   * horário do gerenciador quando informado, sem o intervalo (almoço).
   */
  workMinutesUntil(
    due: string,
    dueTime?: string | null,
    hours?: WorkHours | null,
  ) {
    const base = this.clock.calendar ?? DEFAULT_CALENDAR;
    const calendar = {
      ...base,
      ...(hours?.startTime && hours.endTime ? hours : {}),
    };
    const cacheKey = `${due} ${dueTime ?? ''} ${calendar.startTime}-${calendar.endTime} ${calendar.breakStart ?? ''}-${calendar.breakEnd ?? ''}`;
    const cached = this.available.get(cacheKey);
    if (cached !== undefined) return cached;
    const now = this.clock.now.getTime();
    const deadline = this.clock
      .at(
        due,
        dueTime && dueTime < calendar.endTime ? dueTime : calendar.endTime,
      )
      .getTime();
    let minutes = 0;
    let day = this.clock.dayOf(this.clock.now);
    for (let count = 0; day <= due && count < MAX_DAYS; count++) {
      if (
        calendar.workDays.includes(weekdayOf(day)) &&
        !calendar.holidays.includes(day)
      ) {
        const from = Math.max(
          now,
          this.clock.at(day, calendar.startTime).getTime(),
        );
        const to = Math.min(
          deadline,
          this.clock.at(day, calendar.endTime).getTime(),
        );
        if (to > from) {
          minutes += (to - from) / 60000;
          if (calendar.breakStart && calendar.breakEnd) {
            const pauseFrom = Math.max(
              from,
              this.clock.at(day, calendar.breakStart).getTime(),
            );
            const pauseTo = Math.min(
              to,
              this.clock.at(day, calendar.breakEnd).getTime(),
            );
            if (pauseTo > pauseFrom) minutes -= (pauseTo - pauseFrom) / 60000;
          }
        }
      }
      day = nextDay(day);
    }
    this.available.set(cacheKey, minutes);
    return minutes;
  }

  /**
   * O alerta da cadeia, só para a tarefa aberta de projeto em produção,
   * nesta ordem: passou do horário; a anterior atrasou (em cadeia); o que
   * falta não cabe até a entrega; agendada depois da entrega.
   */
  alert(task: ChainTask): ChainAlert | null {
    if (this.alerts.has(task.id)) return this.alerts.get(task.id)!;
    if (this.visitingAlert.has(task.id)) return null;
    this.visitingAlert.add(task.id);
    const result = this.computeAlert(task);
    this.visitingAlert.delete(task.id);
    this.alerts.set(task.id, result);
    return result;
  }

  private computeAlert(task: ChainTask): ChainAlert | null {
    const project = this.projects.get(task.projectId);
    if (!project || !isOpen(task.status) || project.status !== 'PRODUCTION') {
      return null;
    }
    if (this.overdue(task)) {
      return {
        kind: 'OVERDUE',
        text: 'Passou do horário planejado sem terminar. Reagende ou recupere o atraso: as etapas seguintes estão avisadas.',
      };
    }
    // Travada (o cadeado): a etapa anterior que não termina antes do horário
    // travado acende o alerta, e a cadeia depois dela herda
    if (task.locked && task.schedule && task.status === 'NOT_STARTED') {
      const lockedAt = task.schedule.start
        ? this.clock.at(task.schedule.date, task.schedule.start)
        : this.clock.at(task.schedule.date, this.hoursOf(task).startTime);
      for (const id of task.dependsOn) {
        const dependency = this.byId.get(id);
        if (!dependency || !isOpen(dependency.status) || dependency.released) {
          continue;
        }
        const end = this.expectedEnd(dependency);
        if (end && end.getTime() > lockedAt.getTime()) {
          return {
            kind: 'LATE_PREDECESSOR',
            text: `Travada na agenda, mas ${dependency.stageName} não termina a tempo. Destrave para a agenda viva reagendar, ou recupere o atraso.`,
          };
        }
      }
    }
    // O aviso só some quando a anterior termina ou é reagendada de um jeito
    // que a cadeia volta a caber (§12.2)
    for (const id of task.dependsOn) {
      const dependency = this.byId.get(id);
      if (
        dependency &&
        isOpen(dependency.status) &&
        (this.overdue(dependency) || !!this.alert(dependency))
      ) {
        return {
          kind: 'LATE_PREDECESSOR',
          text: `${dependency.stageName} atrasou. Esta etapa herda o atraso até a cadeia voltar a ficar alinhada.`,
        };
      }
    }
    const remaining = this.remainingAhead(task);
    if (
      remaining >
      this.workMinutesUntil(project.due, project.dueTime, task.hours)
    ) {
      return {
        kind: 'DELIVERY_RISK',
        text: `O que falta daqui para a frente (${Math.round(remaining)} min) não cabe até a entrega em ${brDate(project.due)}${project.dueTime ? ` às ${project.dueTime}` : ''}.`,
      };
    }
    const lastDay = this.lastScheduledDay(task);
    if (lastDay && lastDay > project.due) {
      return {
        kind: 'DELIVERY_RISK',
        text: 'Agendada para depois da data de entrega.',
      };
    }
    return null;
  }

  /** O resumo do projeto para a lista (GP-18). */
  projectSummary(projectId: string, tasks: ChainTask[]) {
    const project = this.projects.get(projectId);
    const own = tasks.filter((task) => task.projectId === projectId);
    const alerts = own.map((task) => this.alert(task));
    return {
      total: own.length,
      done: own.filter((task) => task.status === 'DONE').length,
      alerts: alerts.filter(Boolean).length,
      risk: alerts.some((alert) => alert?.kind === 'DELIVERY_RISK'),
      late:
        !!project &&
        (project.status === 'STANDBY' || project.status === 'PRODUCTION') &&
        project.due < this.today,
    };
  }
}
