import { Prisma } from '@prisma/client';
import {
  projectInstant,
  toProjectDateKey,
  toProjectTimeKey,
} from '../fiscal/utils/project-date.util';

/**
 * O projeto de produção acompanhando a venda, dentro da transação de quem
 * muda a venda: a O.S. cancelada cancela o projeto, e a data de entrega
 * fica igual no projeto e na Agenda de entrega (decisões de 15/10/2026).
 * Funções soltas, para a O.S. e o orçamento usarem sem depender do módulo.
 */

type Tx = Prisma.TransactionClient;
type By = { userId: string | null; name: string };

const OPEN_PROJECT = ['STANDBY', 'PRODUCTION'] as const;
const brDate = (day: string | null) =>
  day ? day.split('-').reverse().join('/') : '';
const dayColumn = (day: string) => new Date(`${day}T00:00:00.000Z`);

/** Cancela o projeto: fecha os relógios e cancela as tarefas abertas. */
export async function cancelProjectInTx(
  tx: Tx,
  projectId: string,
  by: By,
  text: { project: string; task: string },
) {
  const now = new Date();
  const open = await tx.productionTask.findMany({
    where: { projectId, status: { notIn: ['DONE', 'CANCELED'] } },
    select: {
      id: true,
      timeEntries: { where: { end: null }, select: { id: true, start: true } },
    },
  });
  for (const task of open) {
    for (const entry of task.timeEntries) {
      await tx.productionTimeEntry.update({
        where: { id: entry.id },
        data: {
          end: now,
          seconds: Math.max(
            0,
            Math.round((now.getTime() - entry.start.getTime()) / 1000),
          ),
        },
      });
    }
  }
  await tx.productionTask.updateMany({
    where: { id: { in: open.map((task) => task.id) } },
    data: { status: 'CANCELED' },
  });
  await tx.productionTaskHistory.createMany({
    data: open.map((task) => ({
      taskId: task.id,
      byUserId: by.userId,
      byName: by.name,
      text: text.task,
    })),
  });
  await tx.productionProject.update({
    where: { id: projectId },
    data: {
      status: 'CANCELED',
      history: {
        create: { byUserId: by.userId, byName: by.name, text: text.project },
      },
    },
  });
  return open.length;
}

/** A O.S. cancelada leva junto o projeto em aberto (stand-by ou produção). */
export async function cancelProjectOfQuotationInTx(
  tx: Tx,
  quotationId: string,
  by: By,
) {
  const project = await tx.productionProject.findUnique({
    where: { quotationId },
    select: { id: true, status: true },
  });
  if (!project || !OPEN_PROJECT.includes(project.status as never)) return;
  await cancelProjectInTx(tx, project.id, by, {
    project: 'Cancelado com a ordem de serviço',
    task: 'Cancelada com a ordem de serviço',
  });
}

/** A entrega da venda mudou: o projeto em aberto vai junto. */
export async function followDeliveryInTx(
  tx: Tx,
  quotationId: string,
  date: Date,
  by: By,
) {
  const project = await tx.productionProject.findUnique({
    where: { quotationId },
    select: { id: true, status: true, due: true },
  });
  if (!project || !OPEN_PROJECT.includes(project.status as never)) return;
  const day = toProjectDateKey(date);
  const before = project.due.toISOString().slice(0, 10);
  if (day === before) return;
  await tx.productionProject.update({
    where: { id: project.id },
    data: {
      due: dayColumn(day),
      history: {
        create: {
          byUserId: by.userId,
          byName: by.name,
          text: `A venda mudou a entrega de ${brDate(before)} para ${brDate(day)}`,
          data: { from: before, to: day },
        },
      },
    },
  });
}

/**
 * A entrega mudou no projeto: a Agenda de entrega da venda vai junto, no
 * mesmo horário, enquanto não saiu para entrega concluída ou cancelada.
 */
export async function moveScheduleInTx(
  tx: Tx,
  quotationId: string,
  day: string,
) {
  const schedule = await tx.deliverySchedule.findFirst({
    where: {
      OR: [{ quotationId }, { deliveryInfo: { quotationId } }],
      status: { in: ['IN_PRODUCTION', 'DELIVERING'] },
    },
    select: { id: true, scheduledDate: true },
  });
  if (!schedule) return false;
  await tx.deliverySchedule.update({
    where: { id: schedule.id },
    data: {
      scheduledDate: projectInstant(
        day,
        toProjectTimeKey(schedule.scheduledDate),
      ),
    },
  });
  return true;
}
