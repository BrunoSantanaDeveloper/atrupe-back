import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, ProductionAttachmentKind } from '@prisma/client';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { PrismaService } from 'src/config/prisma/prisma.service';
import {
  toProjectDateKey,
  toProjectTimeKey,
} from '../fiscal/utils/project-date.util';
import { rescheduleAfter, toMinutes } from './engine/live-schedule';
import { isOpen } from './engine/production-chain';
import { planAction } from './engine/task-machine';
import {
  AttachmentDto,
  DirectAttachmentDto,
  DirectFileDto,
  ReleaseNextDto,
  TaskActionDto,
  TaskScheduleDto,
  TimeEntryDto,
  UpdateTaskDto,
  UploadLinkDto,
  WorkStartDto,
} from './dto/production-task.dto';
import {
  ProductionAccessService,
  ProductionViewer,
} from './production-access.service';
import { VEHICLE_NOT_FOUND } from './production-config.service';
import { ProductionMirrorService } from './production-mirror.service';
import { dateColumn } from './production-project.service';
import {
  ChainRow,
  ManagerRow,
  ProductionContext,
  ProductionViewService,
  TASK_NOT_FOUND,
} from './production-view.service';
import {
  ProductionFilesService,
  refusalOf,
} from './storage/production-files.service';
import { ProductionStorageService } from './storage/production-storage.service';

/** Tamanho máximo do arquivo do anexo (D32, PO 13/10/2026). */
export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

/** Imagem, PDF, AI, CDR, TIFF, DXF e ZIP (contrato). SVG fica de fora. */
export const ATTACHMENT_EXTENSIONS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.heic': 'image/heic',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.pdf': 'application/pdf',
  '.ai': 'application/postscript',
  '.eps': 'application/postscript',
  '.cdr': 'application/vnd.corel-draw',
  '.dxf': 'image/vnd.dxf',
  '.zip': 'application/zip',
};

const ATTACHMENT_NOT_FOUND = 'Anexo não encontrado';

/** O nome do arquivo: o tipo aceito e o nome seguro para a chave. */
export function nameOf(originalName: string) {
  const extension = path.extname(originalName).toLowerCase();
  const mime = ATTACHMENT_EXTENSIONS[extension];
  if (!mime) {
    bad('Tipo de arquivo não aceito: imagem, PDF, AI, CDR, TIFF, DXF ou ZIP');
  }
  const safeName =
    path
      .basename(originalName)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w.-]+/g, '-')
      .slice(-120) || `arquivo${extension}`;
  return {
    fileName: path.basename(originalName).slice(-200),
    mime: mime!,
    safeName,
  };
}
const TASK_CLOSED = 'A tarefa já foi encerrada';

const bad = (message: string): never => {
  throw new BadRequestException(message);
};

const round1 = (value: number) => Math.round(value * 10) / 10;
const secondsBetween = (start: Date, end: Date) =>
  Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
const brDate = (day: string) => day.split('-').reverse().join('/');

type UploadedFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

type Tx = Prisma.TransactionClient;

/**
 * O que se faz na tarefa (GP-28, GP-43, GP-44, GP-25): estado, pendência,
 * liberar a próxima etapa, agenda, quem faz, veículo, relógio, correção de
 * tempo e anexos. Quem age é sempre o usuário da sessão; a tarefa precisa
 * estar visível a ele (GP-11). Cada mudança devolve a TaskView atualizada.
 */
@Injectable()
export class ProductionTaskService {
  private readonly logger = new Logger(ProductionTaskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProductionAccessService,
    private readonly view: ProductionViewService,
    private readonly mirror: ProductionMirrorService,
    private readonly storage: ProductionStorageService,
    private readonly files: ProductionFilesService,
  ) {}

  /* ------------------------------------------------------------ apoio */

  private async load(viewer: ProductionViewer, id: string) {
    const task = await this.prisma.productionTask.findFirst({
      where: { id, companyId: viewer.companyId },
      select: { projectId: true },
    });
    if (!task) throw new NotFoundException(TASK_NOT_FOUND);
    const ctx = await this.view.context(viewer, { id: task.projectId });
    const row = ctx.rowsById.get(id);
    // A tarefa que o operador não vê é, para ele, inexistente
    if (!row || !this.view.visible(ctx, row)) {
      throw new NotFoundException(TASK_NOT_FOUND);
    }
    const project = ctx.projects.get(row.projectId)!;
    return { ctx, row, project };
  }

  private async respond(viewer: ProductionViewer, id: string, message: string) {
    const task = await this.prisma.productionTask.findUnique({
      where: { id },
      select: { projectId: true },
    });
    const ctx = await this.view.context(viewer, { id: task!.projectId });
    const [view] = await this.view.views(ctx, [id]);
    return { message, task: view };
  }

  private log(
    tx: Tx,
    viewer: ProductionViewer,
    taskId: string,
    text: string,
    affects: string[] = [],
    kind: 'EVENT' | 'COMMENT' = 'EVENT',
  ) {
    return tx.productionTaskHistory.create({
      data: {
        taskId,
        byUserId: viewer.userId,
        byName: viewer.name,
        text,
        affects,
        kind,
      },
    });
  }

  /**
   * O comentário da equipe (VS-5; GP-47, item 3): texto livre de quem tem
   * acesso ao gerenciador, no histórico da tarefa, sem notificação. Vale
   * também na tarefa fechada: a conversa sobre o trabalho continua.
   */
  async comment(viewer: ProductionViewer, id: string, text?: string) {
    await this.load(viewer, id);
    const content = text?.trim() || bad('Escreva o comentário');
    await this.prisma.$transaction((tx) =>
      this.log(tx, viewer, id, content, [], 'COMMENT'),
    );
    return this.respond(viewer, id, 'Comentário registrado');
  }

  /** Fecha os trechos abertos da tarefa (de todos que estão nela). */
  private async closeEntries(tx: Tx, taskId: string, now: Date) {
    const open = await tx.productionTimeEntry.findMany({
      where: { taskId, end: null },
      select: { id: true, start: true },
    });
    for (const entry of open) {
      await tx.productionTimeEntry.update({
        where: { id: entry.id },
        data: { end: now, seconds: secondsBetween(entry.start, now) },
      });
    }
  }

  private assertOpenProject(status: string) {
    if (status === 'DONE' || status === 'CANCELED') {
      bad('O projeto já foi encerrado');
    }
  }

  /* ----------------------------------------------------------- estado */

  async action(viewer: ProductionViewer, id: string, dto: TaskActionDto) {
    const { ctx, row, project } = await this.load(viewer, id);
    this.assertOpenProject(project.status);
    const { step, nextStep } = this.view.stepOf(ctx, row);
    const chainTask = ctx.chain.task(id)!;
    const { blocked, blockedBy } = ctx.chain.blocking(chainTask);
    const detail = await this.prisma.productionTask.findUnique({
      where: { id },
      select: { pendencyText: true, stageName: true },
    });
    const plan = planAction(dto.action, {
      status: row.status,
      blocked,
      blockedBy,
      stepName: step?.name ?? detail!.stageName,
      nextStepName: nextStep?.name ?? null,
      hasPendency: !!detail!.pendencyText,
    });
    if (!plan.ok) throw new BadRequestException(plan.message);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      if (plan.closeEntries) await this.closeEntries(tx, id, now);
      await tx.productionTask.update({
        where: { id },
        data: {
          status: plan.status,
          ...(plan.advanceStep && nextStep
            ? { currentStepId: nextStep.id }
            : {}),
          ...(plan.clearSchedule
            ? { scheduleDate: null, scheduleStart: null, scheduleMinutes: null }
            : {}),
          ...(plan.complete
            ? { completedBy: viewer.name, completedAt: now }
            : {}),
          ...(plan.clearCompletion
            ? { completedBy: null, completedAt: null }
            : {}),
          ...(plan.clearPendency
            ? { pendencyText: null, pendencyAt: null, pendencyBy: null }
            : {}),
        },
      });
      if (plan.clearPendency && dto.action === 'RESUME') {
        await this.log(
          tx,
          viewer,
          id,
          `Resolveu a pendência: ${detail!.pendencyText}`,
        );
      }
      for (const text of plan.history) await this.log(tx, viewer, id, text);
    });
    // A máquina ficou livre: a agenda viva grava o horário novo dos
    // seguintes que já não cabem (GP-48 item 20)
    if (plan.complete || plan.advanceStep) {
      const managerId = this.view.stepOf(ctx, row).managerId;
      const manager = managerId ? ctx.managers.get(managerId) : undefined;
      if (manager?.liveSchedule === 'RESCHEDULE') {
        await this.liveReschedule(viewer, id, manager, now);
      }
    }
    // Iniciar ou continuar com quem faz liga o relógio dele (GP-43)
    if (plan.mayOpenClock && dto.collaboratorId) {
      const type = ctx.types.get(row.taskTypeId);
      if (type?.timeControl) {
        await this.startClock(viewer, id, dto.collaboratorId, 'CLOCK');
      }
    }
    await this.mirror.sync(row.projectId);
    return this.respond(viewer, id, plan.message);
  }

  /**
   * "Reagenda e avisa" gravado (GP-48 item 20; Maicol, 22/11/2026): os
   * trabalhos de hoje na mesma máquina e no mesmo gerenciador, ainda não
   * iniciados, que já não cabem andam para depois deste, na sequência. Com
   * outro trabalho em andamento na máquina, espera: ele reagenda ao sair.
   */
  private async liveReschedule(
    viewer: ProductionViewer,
    id: string,
    manager: ManagerRow,
    now: Date,
  ) {
    const task = await this.prisma.productionTask.findUnique({
      where: { id },
      select: { machine: true },
    });
    if (!task?.machine) return;
    const steps = await this.prisma.productionTaskStep.findMany({
      where: { managerId: manager.id },
      select: { id: true },
    });
    const today = toProjectDateKey(now);
    const others = await this.prisma.productionTask.findMany({
      where: {
        companyId: viewer.companyId,
        id: { not: id },
        machine: task.machine,
        currentStepId: { in: steps.map((step) => step.id) },
        OR: [
          { status: 'IN_PROGRESS' },
          { status: 'NOT_STARTED', scheduleDate: dateColumn(today) },
        ],
      },
      select: {
        id: true,
        projectId: true,
        status: true,
        scheduleStart: true,
        scheduleMinutes: true,
        estimatedMinutes: true,
      },
    });
    if (others.some((item) => item.status === 'IN_PROGRESS')) return;
    const moves = rescheduleAfter({
      freeAt: toMinutes(toProjectTimeKey(now)),
      intervalMinutes: manager.intervalMinutes,
      hours: {
        breakStart: manager.breakStart,
        breakEnd: manager.breakEnd,
        runsThroughBreak: manager.runsThroughBreak,
      },
      tasks: others
        .filter((item) => item.scheduleStart)
        .map((item) => ({
          id: item.id,
          start: item.scheduleStart!,
          minutes: item.scheduleMinutes || item.estimatedMinutes,
        })),
    });
    if (!moves.length) return;
    await this.prisma.$transaction(async (tx) => {
      for (const move of moves) {
        await tx.productionTask.update({
          where: { id: move.id },
          data: { scheduleStart: move.to },
        });
        await this.log(
          tx,
          viewer,
          move.id,
          `Reagendada de ${move.from} para ${move.to}: o trabalho anterior na máquina atrasou (agenda viva)`,
        );
      }
    });
    const projects = new Set(
      others
        .filter((item) => moves.some((move) => move.id === item.id))
        .map((item) => item.projectId),
    );
    for (const projectId of projects) await this.mirror.sync(projectId);
  }

  /** O impedimento descrito: a tarefa fica pendente e os relógios param. */
  async pendency(viewer: ProductionViewer, id: string, text?: string) {
    const { row, project } = await this.load(viewer, id);
    this.assertOpenProject(project.status);
    const description = text?.trim() || bad('Descreva a pendência');
    if (!isOpen(row.status)) bad(TASK_CLOSED);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await this.closeEntries(tx, id, now);
      await tx.productionTask.update({
        where: { id },
        data: {
          status: 'PENDING',
          pendencyText: description,
          pendencyAt: now,
          pendencyBy: viewer.name,
        },
      });
      await this.log(tx, viewer, id, `Adicionou pendência: ${description}`);
    });
    await this.mirror.sync(row.projectId);
    return this.respond(viewer, id, 'Pendência registrada');
  }

  /** Libera as dependentes antes de concluir (FL-13, GP-37). */
  async releaseNext(viewer: ProductionViewer, id: string, dto: ReleaseNextDto) {
    const { ctx, row, project } = await this.load(viewer, id);
    this.assertOpenProject(project.status);
    if (!isOpen(row.status)) bad(TASK_CLOSED);
    const dependents = ctx.rows.filter((item) => item.dependsOn.includes(id));
    if (!dependents.length) bad('Nenhuma etapa espera por esta');
    if (row.releasedNext) bad('A próxima etapa já foi liberada');
    const task = await this.prisma.productionTask.findUnique({
      where: { id },
      select: { quantity: true },
    });
    const quantity = dto.quantity ?? null;
    if (quantity !== null && (quantity < 1 || quantity > task!.quantity)) {
      bad(`A quantidade vai de 1 a ${task!.quantity}`);
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.productionTask.update({
        where: { id },
        data: {
          releasedNext: {
            at: now.toISOString(),
            by: viewer.name,
            quantity,
            of: quantity !== null ? task!.quantity : null,
          },
        },
      });
      await this.log(
        tx,
        viewer,
        id,
        quantity !== null
          ? `Liberou a próxima etapa com ${quantity} de ${task!.quantity}`
          : 'Liberou a próxima etapa antes de concluir',
      );
    });
    return this.respond(
      viewer,
      id,
      `${dependents.map((item) => item.stageName).join(', ')} liberada(s)`,
    );
  }

  /** Agenda ou tira da agenda (GP-35); não recusa conflito. */
  async schedule(viewer: ProductionViewer, id: string, dto: TaskScheduleDto) {
    await this.load(viewer, id);
    if (dto.schedule === undefined) bad('Informe a agenda');
    const value = dto.schedule;
    if (value) {
      const start = value.start || null;
      // Só o dia (GP-49): a hora e os minutos ficam para depois
      const minutes =
        value.minutes === null || value.minutes === undefined
          ? null
          : Math.round(value.minutes);
      if (start && !(minutes && minutes > 0)) bad('Informe os minutos');
      if (minutes !== null && !(minutes > 0)) bad('Informe os minutos');
      if (Number.isNaN(dateColumn(value.date).getTime())) bad('Data inválida');
      const message = start
        ? `Agendou para ${brDate(value.date)} às ${start}`
        : `Agendou para ${brDate(value.date)}, sem horário`;
      await this.prisma.$transaction(async (tx) => {
        await tx.productionTask.update({
          where: { id },
          data: {
            scheduleDate: dateColumn(value.date),
            scheduleStart: start,
            scheduleMinutes: minutes,
          },
        });
        await this.log(tx, viewer, id, message);
      });
      return this.respond(viewer, id, message);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.productionTask.update({
        where: { id },
        data: {
          scheduleDate: null,
          scheduleStart: null,
          scheduleMinutes: null,
        },
      });
      await this.log(tx, viewer, id, 'Tirou da agenda');
    });
    return this.respond(viewer, id, 'Tirou da agenda');
  }

  /** Quem faz, e o veículo com os km (VS-7). */
  async update(viewer: ProductionViewer, id: string, dto: UpdateTaskDto) {
    await this.load(viewer, id);
    const messages: string[] = [];
    const data: Prisma.ProductionTaskUncheckedUpdateInput = {};
    if (dto.assigneeId !== undefined) {
      if (dto.assigneeId === null) {
        data.assigneeId = null;
        messages.push('Tirou a atribuição');
      } else {
        const person = await this.access.collaborator(
          viewer.companyId,
          dto.assigneeId,
        );
        data.assigneeId = person.id;
        messages.push(`Atribuiu a ${person.name}`);
      }
    }
    if (dto.vehicleId !== undefined) {
      if (dto.vehicleId === null) {
        data.vehicleId = null;
        data.km = null;
        messages.push('Tirou o veículo');
      } else {
        const vehicle = await this.prisma.productionVehicle.findFirst({
          where: {
            id: dto.vehicleId,
            companyId: viewer.companyId,
            isActive: true,
          },
          select: { id: true, name: true },
        });
        if (!vehicle) throw new NotFoundException(VEHICLE_NOT_FOUND);
        const km = dto.km ?? null;
        data.vehicleId = vehicle.id;
        data.km = km;
        messages.push(`Reservou ${vehicle.name}${km ? ` · ${km} km` : ''}`);
      }
    } else if (dto.km !== undefined) {
      data.km = dto.km;
      messages.push(dto.km ? `Mudou os km para ${dto.km}` : 'Tirou os km');
    }
    if (dto.priority !== undefined) {
      data.priority = dto.priority;
      messages.push(
        dto.priority === 'URGENT' ? 'Marcou como urgente' : 'Tirou a urgência',
      );
    }
    if (!messages.length) bad('Nada para mudar');
    await this.prisma.$transaction(async (tx) => {
      await tx.productionTask.update({ where: { id }, data });
      for (const text of messages) await this.log(tx, viewer, id, text);
    });
    return this.respond(viewer, id, messages[messages.length - 1]);
  }

  /* ---------------------------------------------------------- relógio */

  /**
   * O operador liga e para o próprio relógio; o gerente, o de qualquer um
   * (no coletivo, quem arrasta é o líder). O colaborador precisa ter acesso
   * ao gerenciador da etapa.
   */
  private async workTarget(
    viewer: ProductionViewer,
    ctx: ProductionContext,
    row: ChainRow,
    collaboratorId: string,
  ) {
    if (!viewer.manager && collaboratorId !== viewer.employeeId) {
      throw new ForbiddenException('Você só liga e para o seu relógio');
    }
    const person = await this.prisma.employee.findFirst({
      where: {
        id: collaboratorId,
        ...this.access.collaboratorWhere(viewer.companyId),
      },
      select: {
        id: true,
        name: true,
        user: { select: { name: true } },
        productionProfile: { select: { role: true } },
      },
    });
    if (!person)
      throw new NotFoundException('Tarefa ou colaborador não encontrado');
    const managerId = this.view.stepOf(ctx, row).managerId;
    const manager = managerId ? ctx.managers.get(managerId) : null;
    const hasAccess =
      person.productionProfile?.role === 'MANAGER' ||
      (person.id === viewer.employeeId && viewer.manager) ||
      !!manager?.users.some((user) => user.employeeId === person.id);
    return {
      id: person.id,
      name: person.name || person.user?.name || '',
      hasAccess,
    };
  }

  async workStart(viewer: ProductionViewer, id: string, dto: WorkStartDto) {
    await this.startClock(
      viewer,
      id,
      dto.collaboratorId,
      dto.source ?? 'CLOCK',
    );
    await this.mirror.sync(
      (await this.prisma.productionTask.findUnique({
        where: { id },
        select: { projectId: true },
      }))!.projectId,
    );
    return this.respond(viewer, id, 'Colaborador na tarefa: o relógio começou');
  }

  private async startClock(
    viewer: ProductionViewer,
    id: string,
    collaboratorId: string,
    source: 'CLOCK' | 'DRAG',
  ) {
    const { ctx, row, project } = await this.load(viewer, id);
    this.assertOpenProject(project.status);
    const target = await this.workTarget(viewer, ctx, row, collaboratorId);
    if (!target.hasAccess) {
      bad('O colaborador não tem acesso a este gerenciador');
    }
    if (!isOpen(row.status)) bad(TASK_CLOSED);
    const { blocked, blockedBy } = ctx.chain.blocking(ctx.chain.task(id)!);
    if (blocked) bad(`Esta etapa espera ${blockedBy}`);
    if (!ctx.types.get(row.taskTypeId)?.timeControl) {
      bad('Este tipo de tarefa não controla o tempo');
    }
    const now = new Date();
    const self = target.id === viewer.employeeId;
    try {
      await this.prisma.$transaction(async (tx) => {
        // Uma tarefa por pessoa: a que estava aberta fecha antes (GP-43)
        const open = await tx.productionTimeEntry.findFirst({
          where: { employeeId: target.id, end: null },
          select: { id: true, start: true, taskId: true },
        });
        if (open?.taskId === id) return;
        if (open) {
          await tx.productionTimeEntry.update({
            where: { id: open.id },
            data: { end: now, seconds: secondsBetween(open.start, now) },
          });
          await this.log(
            tx,
            viewer,
            open.taskId,
            self
              ? 'Saiu da tarefa (relógio parado)'
              : `${target.name} saiu da tarefa (relógio parado)`,
            [target.id],
          );
        }
        await tx.productionTimeEntry.create({
          data: {
            companyId: viewer.companyId,
            taskId: id,
            employeeId: target.id,
            start: now,
            source,
          },
        });
        const task = await tx.productionTask.findUnique({
          where: { id },
          select: { assigneeId: true, status: true },
        });
        await tx.productionTask.update({
          where: { id },
          data: {
            assigneeId: task!.assigneeId ?? target.id,
            ...(task!.status === 'NOT_STARTED' || task!.status === 'PAUSED'
              ? { status: 'IN_PROGRESS' }
              : {}),
          },
        });
        await this.log(
          tx,
          viewer,
          id,
          self
            ? 'Entrou na tarefa (relógio ligado)'
            : `${target.name} entrou na tarefa (relógio ligado)`,
          [target.id],
        );
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'O relógio dessa pessoa acabou de ser ligado',
        );
      }
      throw error;
    }
  }

  /** Para o relógio; não muda o estado da tarefa nem dá erro sem relógio. */
  async workStop(viewer: ProductionViewer, id: string, collaboratorId: string) {
    const { ctx, row } = await this.load(viewer, id);
    const target = await this.workTarget(viewer, ctx, row, collaboratorId);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const open = await tx.productionTimeEntry.findFirst({
        where: { taskId: id, employeeId: target.id, end: null },
        select: { id: true, start: true },
      });
      if (!open) return;
      await tx.productionTimeEntry.update({
        where: { id: open.id },
        data: { end: now, seconds: secondsBetween(open.start, now) },
      });
      await this.log(
        tx,
        viewer,
        id,
        target.id === viewer.employeeId
          ? 'Saiu da tarefa (relógio parado)'
          : `${target.name} saiu da tarefa (relógio parado)`,
        [target.id],
      );
    });
    return this.respond(viewer, id, 'Relógio parado');
  }

  /* ------------------------------------------------- correção de tempo */

  private assertTimeEditor(viewer: ProductionViewer) {
    if (!viewer.timeEditor) {
      throw new ForbiddenException('Só o gerente corrige e lança tempo');
    }
  }

  /** Corrige os minutos e a pessoa de um trecho; o antes fica (GP-44). */
  async correctEntry(
    viewer: ProductionViewer,
    id: string,
    entryId: string,
    dto: TimeEntryDto,
  ) {
    this.assertTimeEditor(viewer);
    await this.load(viewer, id);
    const entry = await this.prisma.productionTimeEntry.findFirst({
      where: { id: entryId, taskId: id },
      select: { id: true, employeeId: true, end: true, seconds: true },
    });
    if (!entry) throw new NotFoundException('Apontamento não encontrado');
    if (!entry.end) bad('Pare o relógio antes de corrigir');
    const note = dto.note?.trim() || bad('Diga o motivo da correção');
    if (dto.minutes < 0) bad('O tempo não pode ser negativo');
    const person = await this.access.collaborator(
      viewer.companyId,
      dto.collaboratorId,
    );
    const before = {
      collaboratorId: entry.employeeId,
      minutes: round1(entry.seconds / 60),
    };
    const after = { collaboratorId: person.id, minutes: round1(dto.minutes) };
    await this.prisma.$transaction(async (tx) => {
      await tx.productionTimeEntry.update({
        where: { id: entryId },
        data: {
          seconds: Math.round(dto.minutes * 60),
          employeeId: person.id,
          source: 'CORRECTION',
          note,
        },
      });
      await tx.productionTimeCorrection.create({
        data: {
          taskId: id,
          entryId,
          byUserId: viewer.userId,
          byName: viewer.name,
          before,
          after,
          note,
        },
      });
      await this.log(
        tx,
        viewer,
        id,
        `Corrigiu o apontamento: ${before.minutes} min → ${after.minutes} min (${person.name}). ${note}`,
        [...new Set([before.collaboratorId, after.collaboratorId])],
      );
    });
    return this.respond(viewer, id, 'Apontamento corrigido');
  }

  /** Lança tempo à mão: o trecho termina agora (GP-44). */
  async addEntry(viewer: ProductionViewer, id: string, dto: TimeEntryDto) {
    this.assertTimeEditor(viewer);
    await this.load(viewer, id);
    if (!(dto.minutes > 0)) bad('Informe o tempo');
    const note = dto.note?.trim() || bad('Diga o motivo do lançamento');
    const person = await this.access.collaborator(
      viewer.companyId,
      dto.collaboratorId,
    );
    const now = new Date();
    const seconds = Math.round(dto.minutes * 60);
    const minutes = round1(dto.minutes);
    await this.prisma.$transaction(async (tx) => {
      const entry = await tx.productionTimeEntry.create({
        data: {
          companyId: viewer.companyId,
          taskId: id,
          employeeId: person.id,
          start: new Date(now.getTime() - seconds * 1000),
          end: now,
          seconds,
          source: 'CORRECTION',
          note,
        },
      });
      await tx.productionTimeCorrection.create({
        data: {
          taskId: id,
          entryId: entry.id,
          byUserId: viewer.userId,
          byName: viewer.name,
          before: Prisma.DbNull,
          after: { collaboratorId: person.id, minutes },
          note,
        },
      });
      await this.log(
        tx,
        viewer,
        id,
        `Lançou ${minutes} min para ${person.name}. ${note}`,
        [person.id],
      );
    });
    return this.respond(viewer, id, 'Tempo lançado');
  }

  /* ----------------------------------------------------------- anexos */

  private fileOf(file?: UploadedFile) {
    if (!file?.originalname || !file.buffer?.length) bad('Escolha o arquivo');
    if (file!.size > ATTACHMENT_MAX_BYTES) bad('O arquivo passa de 20 MB');
    const name = nameOf(file!.originalname);
    return {
      fileName: name.fileName,
      mime:
        file!.mimetype && file!.mimetype !== 'application/octet-stream'
          ? file!.mimetype
          : name.mime,
      size: file!.size,
      buffer: file!.buffer,
      safeName: name.safeName,
    };
  }

  private async attachmentView(attachmentId: string) {
    const attachment = await this.prisma.productionAttachment.findUnique({
      where: { id: attachmentId },
      select: {
        id: true,
        name: true,
        kind: true,
        versions: {
          orderBy: { version: 'asc' },
          select: {
            version: true,
            fileName: true,
            size: true,
            mime: true,
            storageKey: true,
            uploadedBy: true,
            uploadedAt: true,
            current: true,
            removedAt: true,
          },
        },
      },
    });
    const now = new Date();
    return {
      id: attachment!.id,
      name: attachment!.name,
      kind: attachment!.kind,
      versions: attachment!.versions.map(({ storageKey, ...version }) => ({
        ...version,
        uploadedAt: version.uploadedAt.toISOString(),
        removedAt: version.removedAt?.toISOString() ?? null,
        url: version.removedAt ? null : this.storage.signedUrl(storageKey, now),
      })),
    };
  }

  private keyOf(viewer: ProductionViewer, taskId: string, safeName: string) {
    return `production/${viewer.companyId}/${taskId}/${randomUUID()}-${safeName}`;
  }

  private async upload(
    viewer: ProductionViewer,
    taskId: string,
    file: ReturnType<ProductionTaskService['fileOf']>,
  ) {
    const key = this.keyOf(viewer, taskId, file.safeName);
    await this.storage.put(key, file.buffer, file.mime);
    return key;
  }

  /** O espaço da empresa, com o teto do arquivo (GP-48 item 27). */
  storageSummary(viewer: ProductionViewer) {
    return this.files.summary(viewer.companyId, this.storage.configured());
  }

  /** O arquivo enviado pelo servidor (até 20 MB) também conta no espaço. */
  private async assertServerUploadFits(viewer: ProductionViewer, size: number) {
    this.files.assertFits(await this.storageSummary(viewer), size);
  }

  /**
   * O link para o navegador enviar o arquivo direto ao armazenamento: confere
   * o tipo, o teto do arquivo e o espaço antes de liberar.
   */
  async uploadLink(viewer: ProductionViewer, id: string, dto: UploadLinkDto) {
    await this.load(viewer, id);
    const name = nameOf(dto.fileName);
    this.files.assertFits(await this.storageSummary(viewer), dto.size);
    const key = this.keyOf(viewer, id, name.safeName);
    return { key, url: this.storage.uploadUrl(key), mime: name.mime };
  }

  /**
   * O arquivo que o navegador enviou: a chave precisa ser da pasta da tarefa,
   * e o tamanho vale o do armazenamento, não o que a tela disse. Sem espaço,
   * o arquivo é apagado e a entrada recusada.
   */
  private async receivedFile(
    viewer: ProductionViewer,
    id: string,
    dto: DirectFileDto,
  ) {
    if (!dto.key.startsWith(`production/${viewer.companyId}/${id}/`)) {
      bad('Arquivo de outra tarefa');
    }
    const name = nameOf(dto.fileName);
    const size = await this.storage.sizeOf(dto.key);
    if (size === null)
      bad('O arquivo não chegou ao armazenamento. Envie de novo.');
    const summary = await this.storageSummary(viewer);
    const refusal = refusalOf(summary, size!);
    if (refusal) {
      await this.storage.remove(dto.key).catch(() => undefined);
      throw new UnprocessableEntityException(refusal);
    }
    return {
      fileName: name.fileName,
      mime: dto.mime?.trim() || name.mime,
      size: size!,
      storageKey: dto.key,
    };
  }

  private async createAttachment(
    viewer: ProductionViewer,
    id: string,
    dto: AttachmentDto,
    file: { fileName: string; mime: string; size: number; storageKey: string },
  ) {
    const name =
      dto.name?.trim() ||
      path.parse(file.fileName).name.trim() ||
      bad('Dê um nome ao anexo');
    const attachmentId = await this.prisma.$transaction(async (tx) => {
      const attachment = await tx.productionAttachment.create({
        data: {
          taskId: id,
          name,
          kind: (dto.kind ?? 'OTHER') as ProductionAttachmentKind,
          versions: {
            create: {
              version: 1,
              fileName: file.fileName,
              size: file.size,
              mime: file.mime,
              storageKey: file.storageKey,
              uploadedById: viewer.userId,
              uploadedBy: viewer.name,
              current: true,
            },
          },
        },
        select: { id: true },
      });
      await this.log(tx, viewer, id, `Anexou ${name} v1 (${file.fileName})`);
      return attachment.id;
    });
    return this.attachmentView(attachmentId);
  }

  async addAttachment(
    viewer: ProductionViewer,
    id: string,
    dto: AttachmentDto,
    upload?: UploadedFile,
  ) {
    await this.load(viewer, id);
    const file = this.fileOf(upload);
    if (!dto.name?.trim()) bad('Dê um nome ao anexo');
    await this.assertServerUploadFits(viewer, file.size);
    const storageKey = await this.upload(viewer, id, file);
    return this.createAttachment(viewer, id, dto, { ...file, storageKey });
  }

  /** O anexo novo com o arquivo que o navegador já enviou (vários de uma vez). */
  async addAttachmentDirect(
    viewer: ProductionViewer,
    id: string,
    dto: DirectAttachmentDto,
  ) {
    await this.load(viewer, id);
    const file = await this.receivedFile(viewer, id, dto);
    return this.createAttachment(viewer, id, dto, file);
  }

  private async attachmentOf(taskId: string, attachmentId: string) {
    const attachment = await this.prisma.productionAttachment.findFirst({
      where: { id: attachmentId, taskId },
      select: {
        id: true,
        name: true,
        versions: {
          select: {
            version: true,
            storageKey: true,
            current: true,
            uploadedById: true,
          },
        },
      },
    });
    if (!attachment) throw new NotFoundException(ATTACHMENT_NOT_FOUND);
    return attachment;
  }

  private async createVersion(
    viewer: ProductionViewer,
    id: string,
    attachment: Awaited<ReturnType<ProductionTaskService['attachmentOf']>>,
    file: { fileName: string; mime: string; size: number; storageKey: string },
  ) {
    const version =
      Math.max(0, ...attachment.versions.map((item) => item.version)) + 1;
    await this.prisma.$transaction(async (tx) => {
      await tx.productionAttachmentVersion.updateMany({
        where: { attachmentId: attachment.id },
        data: { current: false },
      });
      await tx.productionAttachmentVersion.create({
        data: {
          attachmentId: attachment.id,
          version,
          fileName: file.fileName,
          size: file.size,
          mime: file.mime,
          storageKey: file.storageKey,
          uploadedById: viewer.userId,
          uploadedBy: viewer.name,
          current: true,
        },
      });
      await this.log(
        tx,
        viewer,
        id,
        `Anexou ${attachment.name} v${version} (${file.fileName})`,
      );
    });
    return this.attachmentView(attachment.id);
  }

  /** A versão nova vira a válida; as anteriores ficam (GP-26). */
  async addVersion(
    viewer: ProductionViewer,
    id: string,
    attachmentId: string,
    upload?: UploadedFile,
  ) {
    await this.load(viewer, id);
    const attachment = await this.attachmentOf(id, attachmentId);
    const file = this.fileOf(upload);
    await this.assertServerUploadFits(viewer, file.size);
    const storageKey = await this.upload(viewer, id, file);
    return this.createVersion(viewer, id, attachment, { ...file, storageKey });
  }

  async addVersionDirect(
    viewer: ProductionViewer,
    id: string,
    attachmentId: string,
    dto: DirectFileDto,
  ) {
    await this.load(viewer, id);
    const attachment = await this.attachmentOf(id, attachmentId);
    const file = await this.receivedFile(viewer, id, dto);
    return this.createVersion(viewer, id, attachment, file);
  }

  /**
   * Apagar libera o espaço: o gerente apaga qualquer arquivo; o operador, só
   * o que ele mesmo enviou.
   */
  private assertCanDelete(
    viewer: ProductionViewer,
    versions: { uploadedById: string | null }[],
  ) {
    if (
      !viewer.manager &&
      versions.some((item) => item.uploadedById !== viewer.userId)
    ) {
      throw new ForbiddenException(
        'Só o gerente apaga arquivos enviados por outra pessoa',
      );
    }
  }

  /** Apaga o anexo com todas as versões. */
  async deleteAttachment(
    viewer: ProductionViewer,
    id: string,
    attachmentId: string,
  ) {
    await this.load(viewer, id);
    const attachment = await this.attachmentOf(id, attachmentId);
    this.assertCanDelete(viewer, attachment.versions);
    await this.prisma.$transaction(async (tx) => {
      await tx.productionAttachment.delete({ where: { id: attachment.id } });
      await this.log(tx, viewer, id, `Apagou o anexo ${attachment.name}`);
    });
    await this.removeFiles(attachment.versions.map((item) => item.storageKey));
    return { deleted: true };
  }

  /**
   * Apaga uma versão. Apagar a válida passa a validade para a mais recente;
   * apagar a única apaga o anexo.
   */
  async deleteVersion(
    viewer: ProductionViewer,
    id: string,
    attachmentId: string,
    version: number,
  ) {
    await this.load(viewer, id);
    const attachment = await this.attachmentOf(id, attachmentId);
    const target = attachment.versions.find((item) => item.version === version);
    if (!target) throw new NotFoundException('Versão não encontrada');
    if (attachment.versions.length === 1) {
      return this.deleteAttachment(viewer, id, attachmentId);
    }
    this.assertCanDelete(viewer, [target]);
    const rest = attachment.versions.filter((item) => item.version !== version);
    const latest = Math.max(...rest.map((item) => item.version));
    await this.prisma.$transaction(async (tx) => {
      await tx.productionAttachmentVersion.deleteMany({
        where: { attachmentId, version },
      });
      if (target.current) {
        await tx.productionAttachmentVersion.updateMany({
          where: { attachmentId, version: latest },
          data: { current: true },
        });
      }
      await this.log(tx, viewer, id, `Apagou ${attachment.name} v${version}`);
    });
    await this.removeFiles([target.storageKey]);
    return this.attachmentView(attachmentId);
  }

  /** O banco já soltou o arquivo: a falha no armazenamento só fica no log. */
  private async removeFiles(keys: string[]) {
    for (const key of keys) {
      await this.storage
        .remove(key)
        .catch((error) =>
          this.logger.warn(`Arquivo não apagado (${key}): ${error.message}`),
        );
    }
  }

  async setCurrentVersion(
    viewer: ProductionViewer,
    id: string,
    attachmentId: string,
    version: number,
  ) {
    await this.load(viewer, id);
    const attachment = await this.attachmentOf(id, attachmentId);
    if (!attachment.versions.some((item) => item.version === version)) {
      throw new NotFoundException('Versão não encontrada');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.productionAttachmentVersion.updateMany({
        where: { attachmentId },
        data: { current: false },
      });
      await tx.productionAttachmentVersion.updateMany({
        where: { attachmentId, version },
        data: { current: true },
      });
      await this.log(
        tx,
        viewer,
        id,
        `Marcou ${attachment.name} v${version} como a válida`,
      );
    });
    return this.attachmentView(attachmentId);
  }
}
