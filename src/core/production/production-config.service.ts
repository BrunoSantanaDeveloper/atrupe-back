import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { DEFAULT_CALENDAR } from './engine/production-chain';
import {
  CalendarDto,
  CollaboratorRoleDto,
  ManagerDto,
  ManagerUserDto,
  StepOrderDto,
  TaskStepDto,
  TaskTypeDto,
  VehicleDto,
} from './dto/production-config.dto';
import { ProductionAccessService } from './production-access.service';

export const DEFAULT_FLOW = 'Comunicação Visual';
export const MANAGER_NOT_FOUND = 'Gerenciador não encontrado';
export const TASK_TYPE_NOT_FOUND = 'Tipo de tarefa não encontrado';
export const VEHICLE_NOT_FOUND = 'Veículo não encontrado';
const STEP_NOT_FOUND = 'Etapa não encontrada';

const bad = (message: string): never => {
  throw new BadRequestException(message);
};

export const SECTOR_SELECT = {
  id: true,
  name: true,
  icon: true,
  color: true,
} satisfies Prisma.CompanySectorSelect;

const MANAGER_SELECT = {
  id: true,
  name: true,
  flowId: true,
  timeMode: true,
  intervalMinutes: true,
  workStart: true,
  workEnd: true,
  breakStart: true,
  breakEnd: true,
  runsThroughBreak: true,
  liveSchedule: true,
  afterDoneMinutes: true,
  isActive: true,
  sector: { select: SECTOR_SELECT },
  users: {
    select: { employeeId: true, onlyAssigned: true },
    orderBy: { employeeId: 'asc' },
  },
} satisfies Prisma.ProductionManagerSelect;

const TASK_TYPE_SELECT = {
  id: true,
  name: true,
  release: true,
  timeControl: true,
  isActive: true,
  steps: {
    select: { id: true, name: true, managerId: true },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  },
} satisfies Prisma.ProductionTaskTypeSelect;

type ManagerRow = Prisma.ProductionManagerGetPayload<{
  select: typeof MANAGER_SELECT;
}>;
type TaskTypeRow = Prisma.ProductionTaskTypeGetPayload<{
  select: typeof TASK_TYPE_SELECT;
}>;

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/**
 * O expediente do gerenciador (GP-48 item 19): início e fim juntos, ou
 * nenhum (vale o da empresa); o intervalo, opcional, dentro do expediente.
 */
export const hoursData = (dto: {
  workStart?: string | null;
  workEnd?: string | null;
  breakStart?: string | null;
  breakEnd?: string | null;
  runsThroughBreak?: boolean;
}) => {
  const workStart = dto.workStart || null;
  const workEnd = dto.workEnd || null;
  const breakStart = dto.breakStart || null;
  const breakEnd = dto.breakEnd || null;
  if (!workStart !== !workEnd) {
    bad('Informe o início e o fim do expediente, ou deixe os dois vazios');
  }
  if (workStart && workEnd && minutesOf(workStart) >= minutesOf(workEnd)) {
    bad('O fim do expediente precisa ser depois do início');
  }
  if (!breakStart !== !breakEnd) {
    bad('Informe o início e o fim do intervalo, ou deixe os dois vazios');
  }
  if (breakStart && breakEnd) {
    if (minutesOf(breakStart) >= minutesOf(breakEnd)) {
      bad('O fim do intervalo precisa ser depois do início');
    }
    if (
      workStart &&
      workEnd &&
      (minutesOf(breakStart) < minutesOf(workStart) ||
        minutesOf(breakEnd) > minutesOf(workEnd))
    ) {
      bad('O intervalo precisa estar dentro do expediente');
    }
  }
  return {
    workStart,
    workEnd,
    breakStart,
    breakEnd,
    runsThroughBreak: dto.runsThroughBreak ?? false,
  };
};

const hoursView = (row: {
  workStart: string | null;
  workEnd: string | null;
  breakStart: string | null;
  breakEnd: string | null;
  runsThroughBreak: boolean;
}) => ({
  workStart: row.workStart,
  workEnd: row.workEnd,
  breakStart: row.breakStart,
  breakEnd: row.breakEnd,
  runsThroughBreak: row.runsThroughBreak,
});

export const managerView = (row: ManagerRow) => ({
  id: row.id,
  name: row.name,
  sector: row.sector,
  flowId: row.flowId,
  timeMode: row.timeMode,
  intervalMinutes: row.intervalMinutes,
  hours: hoursView(row),
  liveSchedule: row.liveSchedule,
  afterDoneMinutes: row.afterDoneMinutes,
  users: row.users.map((user) => ({
    collaboratorId: user.employeeId,
    onlyAssigned: user.onlyAssigned,
  })),
  active: row.isActive,
});

export const taskTypeView = (row: TaskTypeRow) => ({
  id: row.id,
  name: row.name,
  release: row.release,
  timeControl: row.timeControl,
  steps: row.steps,
  active: row.isActive,
});

const vehicleView = (row: {
  id: string;
  name: string;
  plate: string;
  isActive: boolean;
  assetId?: string | null;
}) => ({
  id: row.id,
  name: row.name,
  plate: row.plate,
  active: row.isActive,
  assetId: row.assetId ?? null,
});

const nameKey = (name: string) => name.trim().toLocaleLowerCase('pt-BR');

/**
 * Configurações › Produção (área 9 §4.6 a §4.14): fluxo, gerenciadores e o
 * acesso de cada colaborador, o perfil de cada um, tipos de tarefa com as
 * etapas, e a frota. Tudo da empresa da sessão.
 */
@Injectable()
export class ProductionConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProductionAccessService,
  ) {}

  /** O fluxo da empresa: hoje um só, criado na primeira vez. */
  async defaultFlow(companyId: string) {
    const existing = await this.prisma.productionFlow.findFirst({
      where: { companyId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true },
    });
    if (existing) return existing;
    return this.prisma.productionFlow.upsert({
      where: { companyId_name: { companyId, name: DEFAULT_FLOW } },
      create: { companyId, name: DEFAULT_FLOW },
      update: {},
      select: { id: true, name: true },
    });
  }

  /** O expediente da empresa; sem cadastro, o padrão (segunda a sexta). */
  async calendar(companyId: string) {
    const row = await this.prisma.productionCalendar.findUnique({
      where: { companyId },
      select: {
        workDays: true,
        startTime: true,
        endTime: true,
        holidays: true,
        breakStart: true,
        breakEnd: true,
      },
    });
    return row ?? { ...DEFAULT_CALENDAR };
  }

  async updateCalendar(companyId: string, dto: CalendarDto) {
    if (dto.endTime <= dto.startTime) {
      bad('O fim do expediente vem depois do início');
    }
    // O intervalo segue as mesmas regras do gerenciador
    const hours = hoursData({
      workStart: dto.startTime,
      workEnd: dto.endTime,
      breakStart: dto.breakStart,
      breakEnd: dto.breakEnd,
    });
    const data = {
      workDays: [...dto.workDays].sort((a, b) => a - b),
      startTime: dto.startTime,
      endTime: dto.endTime,
      breakStart: hours.breakStart,
      breakEnd: hours.breakEnd,
      holidays: [...new Set(dto.holidays ?? [])].sort(),
    };
    await this.prisma.productionCalendar.upsert({
      where: { companyId },
      create: { companyId, ...data },
      update: data,
    });
    return data;
  }

  async config(companyId: string) {
    await this.defaultFlow(companyId);
    const [flows, managers, taskTypes, collaborators, vehicles, calendar] =
      await Promise.all([
        this.prisma.productionFlow.findMany({
          where: { companyId },
          orderBy: { createdAt: 'asc' },
          select: { id: true, name: true },
        }),
        this.prisma.productionManager.findMany({
          where: { companyId },
          orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
          select: MANAGER_SELECT,
        }),
        this.prisma.productionTaskType.findMany({
          where: { companyId },
          orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
          select: TASK_TYPE_SELECT,
        }),
        this.collaborators(companyId),
        this.prisma.productionVehicle.findMany({
          where: { companyId },
          orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
          select: { id: true, name: true, plate: true, isActive: true },
        }),
        this.calendar(companyId),
      ]);
    return {
      flows,
      managers: managers.map(managerView),
      taskTypes: taskTypes.map(taskTypeView),
      collaborators,
      vehicles: vehicles.map(vehicleView),
      calendar,
    };
  }

  /**
   * Os usuários ativos da empresa, com o perfil na produção (sem perfil é
   * operador) e a tarefa em que estão agora (GP-17).
   */
  async collaborators(companyId: string) {
    const [rows, open] = await Promise.all([
      this.prisma.employee.findMany({
        where: this.access.collaboratorWhere(companyId),
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          user: { select: { name: true, email: true } },
          productionProfile: { select: { role: true } },
        },
      }),
      this.prisma.productionTimeEntry.findMany({
        where: { companyId, end: null },
        select: { employeeId: true, taskId: true, start: true },
      }),
    ]);
    const working = new Map(open.map((entry) => [entry.employeeId, entry]));
    return rows.map((row) => {
      const entry = working.get(row.id);
      return {
        id: row.id,
        name: row.name || row.user?.name || '',
        email: row.user?.email ?? null,
        role: row.productionProfile?.role ?? 'OPERATOR',
        working: entry
          ? { taskId: entry.taskId, since: entry.start.toISOString() }
          : null,
      };
    });
  }

  /* ------------------------------------------------------- gerenciadores */

  private async managerRow(companyId: string, id: string) {
    const row = await this.prisma.productionManager.findFirst({
      where: { id, companyId },
      select: MANAGER_SELECT,
    });
    if (!row) throw new NotFoundException(MANAGER_NOT_FOUND);
    return row;
  }

  private async managerData(companyId: string, dto: ManagerDto) {
    const name = dto.name?.trim() || bad('Informe o nome do gerenciador');
    const sector = dto.sectorId
      ? await this.prisma.companySector.findFirst({
          where: { id: dto.sectorId, companyId, isActive: true },
          select: { id: true },
        })
      : null;
    if (!sector) bad('Escolha o setor do gerenciador');
    let flowId: string;
    if (dto.flowId) {
      const flow = await this.prisma.productionFlow.findFirst({
        where: { id: dto.flowId, companyId },
        select: { id: true },
      });
      if (!flow)
        throw new NotFoundException('Fluxo de produção não encontrado');
      flowId = flow.id;
    } else {
      flowId = (await this.defaultFlow(companyId)).id;
    }
    return {
      name,
      sectorId: sector!.id,
      flowId,
      timeMode: dto.timeMode,
      intervalMinutes: dto.intervalMinutes ?? 0,
      ...hoursData(dto),
      liveSchedule: dto.liveSchedule ?? 'WARN',
      afterDoneMinutes: dto.afterDoneMinutes ?? 0,
    };
  }

  async createManager(companyId: string, dto: ManagerDto) {
    const data = await this.managerData(companyId, dto);
    // O gerenciador novo nasce com o expediente da empresa, editável
    // (GP-49): só quando o formulário veio sem expediente
    if (!data.workStart) {
      const calendar = await this.calendar(companyId);
      data.workStart = calendar.startTime;
      data.workEnd = calendar.endTime;
      if (!data.breakStart) {
        data.breakStart = calendar.breakStart ?? null;
        data.breakEnd = calendar.breakEnd ?? null;
      }
    }
    const row = await this.prisma.productionManager.create({
      data: { companyId, ...data },
      select: MANAGER_SELECT,
    });
    return managerView(row);
  }

  async updateManager(companyId: string, id: string, dto: ManagerDto) {
    await this.managerRow(companyId, id);
    const data = await this.managerData(companyId, dto);
    const row = await this.prisma.productionManager.update({
      where: { id },
      data,
      select: MANAGER_SELECT,
    });
    return managerView(row);
  }

  /** Inativar passa as etapas para outro: nenhuma tarefa fica sem lugar (GP-15). */
  async inactivateManager(
    companyId: string,
    id: string,
    destinationId?: string,
  ) {
    await this.managerRow(companyId, id);
    const destination =
      destinationId && destinationId !== id
        ? await this.prisma.productionManager.findFirst({
            where: { id: destinationId, companyId, isActive: true },
            select: { id: true },
          })
        : null;
    if (!destination) bad('Escolha um gerenciador ativo de destino');
    const moved = await this.prisma.$transaction(async (tx) => {
      const result = await tx.productionTaskStep.updateMany({
        where: { managerId: id },
        data: { managerId: destination!.id },
      });
      await tx.productionManager.update({
        where: { id },
        data: { isActive: false },
      });
      return result.count;
    });
    return { id, active: false, movedSteps: moved };
  }

  /** As etapas não voltam sozinhas. */
  async reactivateManager(companyId: string, id: string) {
    await this.managerRow(companyId, id);
    await this.prisma.productionManager.update({
      where: { id },
      data: { isActive: true },
    });
    return { id, active: true };
  }

  async setManagerUser(
    companyId: string,
    id: string,
    employeeId: string,
    dto: ManagerUserDto,
  ) {
    await this.managerRow(companyId, id);
    await this.access.collaborator(companyId, employeeId);
    if (dto.access === 'NONE') {
      await this.prisma.productionManagerUser.deleteMany({
        where: { managerId: id, employeeId },
      });
    } else {
      const onlyAssigned = dto.access === 'ASSIGNED';
      await this.prisma.productionManagerUser.upsert({
        where: { managerId_employeeId: { managerId: id, employeeId } },
        create: { managerId: id, employeeId, onlyAssigned },
        update: { onlyAssigned },
      });
    }
    const row = await this.managerRow(companyId, id);
    return { users: managerView(row).users };
  }

  async setCollaboratorRole(
    companyId: string,
    employeeId: string,
    dto: CollaboratorRoleDto,
  ) {
    await this.access.collaborator(companyId, employeeId);
    await this.prisma.productionCollaborator.upsert({
      where: { employeeId },
      create: { companyId, employeeId, role: dto.role },
      update: { role: dto.role },
    });
    return { id: employeeId, role: dto.role };
  }

  /* --------------------------------------------------- tipos de tarefa */

  private async taskTypeRow(companyId: string, id: string) {
    const row = await this.prisma.productionTaskType.findFirst({
      where: { id, companyId },
      select: TASK_TYPE_SELECT,
    });
    if (!row) throw new NotFoundException(TASK_TYPE_NOT_FOUND);
    return row;
  }

  /** O nome casa com o tipo de tarefa da etapa da composição (IP-23). */
  private async assertUniqueName(
    companyId: string,
    name: string,
    exceptId?: string,
  ) {
    const clash = await this.prisma.productionTaskType.findFirst({
      where: {
        companyId,
        nameKey: nameKey(name),
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException('Já existe um tipo de tarefa com esse nome');
    }
  }

  /** O gerenciador da etapa existe e está ativo (GP-14). */
  private async activeManager(
    companyId: string,
    managerId: string | undefined,
    message: string,
  ) {
    const manager = managerId
      ? await this.prisma.productionManager.findFirst({
          where: { id: managerId, companyId, isActive: true },
          select: { id: true },
        })
      : null;
    if (!manager) bad(message);
    return manager!.id;
  }

  async createTaskType(companyId: string, dto: TaskTypeDto) {
    const name = dto.name?.trim() || bad('Informe o nome do tipo de tarefa');
    await this.assertUniqueName(companyId, name);
    const managerId = await this.activeManager(
      companyId,
      dto.managerId,
      'Escolha o gerenciador da primeira etapa',
    );
    const row = await this.prisma.productionTaskType.create({
      data: {
        companyId,
        name,
        nameKey: nameKey(name),
        release: dto.release,
        timeControl: dto.timeControl ?? true,
        steps: { create: { name: 'Primeira etapa', managerId, position: 0 } },
      },
      select: TASK_TYPE_SELECT,
    });
    return taskTypeView(row);
  }

  async updateTaskType(companyId: string, id: string, dto: TaskTypeDto) {
    await this.taskTypeRow(companyId, id);
    const name = dto.name?.trim() || bad('Informe o nome do tipo de tarefa');
    await this.assertUniqueName(companyId, name, id);
    const row = await this.prisma.productionTaskType.update({
      where: { id },
      data: {
        name,
        nameKey: nameKey(name),
        release: dto.release,
        ...(dto.timeControl !== undefined
          ? { timeControl: dto.timeControl }
          : {}),
      },
      select: TASK_TYPE_SELECT,
    });
    return taskTypeView(row);
  }

  /** O tipo inativo deixa de casar na geração de tarefas. */
  async toggleTaskType(companyId: string, id: string, active: boolean) {
    await this.taskTypeRow(companyId, id);
    await this.prisma.productionTaskType.update({
      where: { id },
      data: { isActive: active },
    });
    return { id, active };
  }

  async addStep(companyId: string, id: string, dto: TaskStepDto) {
    const type = await this.taskTypeRow(companyId, id);
    const name = dto.name?.trim() || bad('Informe o nome da etapa');
    const managerId = await this.activeManager(
      companyId,
      dto.managerId,
      'Escolha um gerenciador ativo para a etapa',
    );
    const last = await this.prisma.productionTaskStep.aggregate({
      where: { taskTypeId: type.id },
      _max: { position: true },
    });
    await this.prisma.productionTaskStep.create({
      data: {
        taskTypeId: type.id,
        name,
        managerId,
        position: (last._max.position ?? -1) + 1,
      },
    });
    return taskTypeView(await this.taskTypeRow(companyId, id));
  }

  async updateStep(
    companyId: string,
    id: string,
    stepId: string,
    dto: TaskStepDto,
  ) {
    const type = await this.taskTypeRow(companyId, id);
    if (!type.steps.some((step) => step.id === stepId)) {
      throw new NotFoundException(STEP_NOT_FOUND);
    }
    const name = dto.name?.trim() || bad('Informe o nome da etapa');
    const managerId = await this.activeManager(
      companyId,
      dto.managerId,
      'Escolha um gerenciador ativo para a etapa',
    );
    await this.prisma.productionTaskStep.update({
      where: { id: stepId },
      data: { name, managerId },
    });
    return taskTypeView(await this.taskTypeRow(companyId, id));
  }

  /** Recusa a última etapa e a etapa com tarefa aberta parada nela. */
  async removeStep(companyId: string, id: string, stepId: string) {
    const type = await this.taskTypeRow(companyId, id);
    if (!type.steps.some((step) => step.id === stepId)) {
      throw new NotFoundException(STEP_NOT_FOUND);
    }
    if (type.steps.length <= 1) bad('O tipo precisa de ao menos uma etapa');
    const open = await this.prisma.productionTask.count({
      where: {
        currentStepId: stepId,
        status: { notIn: ['DONE', 'CANCELED'] },
      },
    });
    if (open) throw new ConflictException('Há tarefas abertas nesta etapa');
    await this.prisma.productionTaskStep.delete({ where: { id: stepId } });
    return taskTypeView(await this.taskTypeRow(companyId, id));
  }

  /** A sequência inteira (legado §9.2): exatamente as etapas do tipo. */
  async orderSteps(companyId: string, id: string, dto: StepOrderDto) {
    const type = await this.taskTypeRow(companyId, id);
    const current = new Set(type.steps.map((step) => step.id));
    const given = new Set(dto.stepIds);
    if (
      given.size !== dto.stepIds.length ||
      given.size !== current.size ||
      dto.stepIds.some((stepId) => !current.has(stepId))
    ) {
      bad('Mande todas as etapas do tipo, uma vez cada');
    }
    await this.prisma.$transaction(
      dto.stepIds.map((stepId, position) =>
        this.prisma.productionTaskStep.update({
          where: { id: stepId },
          data: { position },
        }),
      ),
    );
    return taskTypeView(await this.taskTypeRow(companyId, id));
  }

  /* --------------------------------------------------------- veículos */

  private async vehicleData(companyId: string, dto: VehicleDto) {
    // O veículo é o patrimônio (VE-1): o bem precisa ser da empresa
    if (dto.assetId) {
      const asset = await this.prisma.asset.findFirst({
        where: { id: dto.assetId, companyId },
        select: { id: true },
      });
      if (!asset) throw new NotFoundException('Patrimônio não encontrado');
    }
    return {
      name: dto.name?.trim() || bad('Informe o nome do veículo'),
      plate: (dto.plate ?? '').trim().toUpperCase(),
      ...(dto.assetId !== undefined ? { assetId: dto.assetId || null } : {}),
    };
  }

  async createVehicle(companyId: string, dto: VehicleDto) {
    const row = await this.prisma.productionVehicle.create({
      data: { companyId, ...(await this.vehicleData(companyId, dto)) },
    });
    return vehicleView(row);
  }

  private async vehicleRow(companyId: string, id: string) {
    const row = await this.prisma.productionVehicle.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!row) throw new NotFoundException(VEHICLE_NOT_FOUND);
  }

  async updateVehicle(companyId: string, id: string, dto: VehicleDto) {
    await this.vehicleRow(companyId, id);
    const row = await this.prisma.productionVehicle.update({
      where: { id },
      data: await this.vehicleData(companyId, dto),
    });
    return vehicleView(row);
  }

  async toggleVehicle(companyId: string, id: string, active: boolean) {
    await this.vehicleRow(companyId, id);
    await this.prisma.productionVehicle.update({
      where: { id },
      data: { isActive: active },
    });
    return { id, active };
  }
}
