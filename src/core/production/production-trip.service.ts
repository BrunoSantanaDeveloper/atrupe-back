import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from 'src/config/prisma/prisma.service';
import {
  ProductionAccessService,
  ProductionViewer,
} from './production-access.service';
import {
  CancelTripDto,
  CloseTripDto,
  CreateTripDto,
  StartTripDto,
  StopResultDto,
  VehicleRequestDto,
} from './dto/production-trip.dto';
import { allocateKm, tripAt, tripConflict } from './engine/trips';

const bad = (message: string): never => {
  throw new BadRequestException(message);
};
const TRIP_NOT_FOUND = 'Saída não encontrada';
const OPEN_TASK = ['NOT_STARTED', 'IN_PROGRESS', 'PAUSED', 'PENDING'] as const;

const TRIP_INCLUDE = {
  vehicle: { select: { id: true, name: true, plate: true } },
  driver: { select: { id: true, name: true } },
  stops: { orderBy: { position: 'asc' as const } },
};

/**
 * Veículos, fase 1 (Maicol, 23/11/2026, ELITE): a saída é sempre a mesma
 * (veículo, quem dirige, equipe, partida, volta e km) e a diferença fica nas
 * paradas: de trabalho (a tarefa da produção, com o km previsto dela) ou
 * livre (banco, cartório, buscar material, levar alguém, com o setor que
 * pediu). O veículo só sai de novo depois de fechar a saída anterior; na
 * volta, o km é repartido pelo previsto e quem fecha pode ajustar.
 */
@Injectable()
export class ProductionTripService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProductionAccessService,
  ) {}

  /** As saídas do período, os pedidos abertos e o que precisa de saída. */
  async overview(viewer: ProductionViewer, from: string, to: string) {
    const start = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T23:59:59.999`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      bad('Informe o período (from e to, AAAA-MM-DD)');
    }
    const companyId = viewer.companyId;
    const [trips, vehicles, requests, pending, people] = await Promise.all([
      this.prisma.productionTrip.findMany({
        where: {
          companyId,
          departAt: { lte: end },
          returnAt: { gte: start },
        },
        include: TRIP_INCLUDE,
        orderBy: { departAt: 'asc' },
      }),
      this.prisma.productionVehicle.findMany({
        where: { companyId, isActive: true },
        select: { id: true, name: true, plate: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.productionVehicleRequest.findMany({
        where: { companyId, status: 'OPEN' },
        orderBy: { date: 'asc' },
      }),
      // As tarefas abertas com veículo reservado e sem saída que as leve
      this.prisma.productionTask.findMany({
        where: {
          companyId,
          status: { in: [...OPEN_TASK] },
          vehicleId: { not: null },
          tripStops: {
            none: {
              status: { in: ['PENDING', 'DONE'] },
              trip: { status: { not: 'CANCELED' } },
            },
          },
        },
        select: {
          id: true,
          code: true,
          stageName: true,
          itemName: true,
          km: true,
          vehicleId: true,
          scheduleDate: true,
        },
        orderBy: { scheduleDate: 'asc' },
      }),
      this.prisma.employee.findMany({
        where: { companyId },
        select: { id: true, name: true },
      }),
    ]);
    const nameOf = new Map(people.map((person) => [person.id, person.name]));
    // A saída de ontem ainda aberta: o alerta depois da volta prevista
    const now = new Date();
    return {
      trips: trips.map((trip) => ({
        ...this.view(trip, nameOf),
        overdue:
          (trip.status === 'SCHEDULED' || trip.status === 'ON_ROUTE') &&
          trip.returnAt < now,
      })),
      vehicles,
      requests: requests.map((request) => ({
        ...request,
        date: request.date.toISOString().slice(0, 10),
      })),
      pending: pending.map((task) => ({
        ...task,
        scheduleDate: task.scheduleDate?.toISOString().slice(0, 10) ?? null,
      })),
    };
  }

  /** Agenda uma saída (VE-2, VE-3). */
  async create(viewer: ProductionViewer, dto: CreateTripDto) {
    const companyId = viewer.companyId;
    const vehicle = await this.prisma.productionVehicle.findFirst({
      where: { id: dto.vehicleId, companyId, isActive: true },
      select: { id: true, name: true },
    });
    if (!vehicle) throw new NotFoundException('Veículo não encontrado');
    const departAt = new Date(dto.departAt);
    const returnAt = new Date(dto.returnAt);
    if (!(departAt < returnAt)) bad('A volta precisa ser depois da partida');
    const driver = dto.driverId
      ? await this.access.collaborator(companyId, dto.driverId)
      : null;
    const team = [];
    for (const id of [...new Set(dto.teamIds ?? [])]) {
      if (id === driver?.id) continue;
      team.push(await this.access.collaborator(companyId, id));
    }
    const others = await this.prisma.productionTrip.findMany({
      where: {
        companyId,
        status: { not: 'CANCELED' },
        departAt: { lt: returnAt },
        returnAt: { gt: departAt },
      },
      select: {
        id: true,
        vehicleId: true,
        driverId: true,
        teamIds: true,
        departAt: true,
        returnAt: true,
        status: true,
      },
    });
    const conflict = tripConflict(
      {
        vehicleId: vehicle.id,
        driverId: driver?.id ?? null,
        teamIds: team.map((person) => person.id),
        departAt,
        returnAt,
      },
      others,
    );
    if (conflict === 'VEHICLE') {
      throw new ConflictException(
        `${vehicle.name} já tem uma saída nesse horário`,
      );
    }
    if (conflict === 'PERSON') {
      throw new ConflictException(
        'Alguém da equipe já está em outra saída nesse horário',
      );
    }

    const stops = await this.stopsOf(companyId, dto.stops);
    const requests = dto.requestIds?.length
      ? await this.prisma.productionVehicleRequest.findMany({
          where: { id: { in: dto.requestIds }, companyId, status: 'OPEN' },
        })
      : [];
    for (const request of requests) {
      stops.push({
        kind: 'FREE',
        taskId: null,
        description: request.reason,
        address: request.destination,
        sectorId: request.sectorId,
        sectorName: request.sectorName,
        plannedKm: null,
      });
    }
    if (!stops.length) bad('Acrescente ao menos uma parada');

    const trip = await this.prisma.$transaction(async (tx) => {
      const last = await tx.productionTrip.findFirst({
        where: { companyId },
        orderBy: { number: 'desc' },
        select: { number: true },
      });
      const created = await tx.productionTrip.create({
        data: {
          companyId,
          number: (last?.number ?? 0) + 1,
          vehicleId: vehicle.id,
          driverId: driver?.id ?? null,
          teamIds: team.map((person) => person.id),
          departAt,
          returnAt,
          note: dto.note?.trim() || null,
          createdByName: viewer.name,
          stops: {
            create: stops.map((stop, position) => ({ ...stop, position })),
          },
        },
      });
      if (requests.length) {
        await tx.productionVehicleRequest.updateMany({
          where: { id: { in: requests.map((request) => request.id) } },
          data: { status: 'SCHEDULED', tripId: created.id },
        });
      }
      return created;
    });
    return this.read(companyId, trip.id);
  }

  private async stopsOf(companyId: string, dtos: CreateTripDto['stops']) {
    const stops: {
      kind: 'WORK' | 'FREE';
      taskId: string | null;
      description: string;
      address: string;
      sectorId: string | null;
      sectorName: string;
      plannedKm: number | null;
    }[] = [];
    for (const stop of dtos) {
      if (stop.kind === 'WORK') {
        const task = stop.taskId
          ? await this.prisma.productionTask.findFirst({
              where: { id: stop.taskId, companyId },
              select: {
                id: true,
                code: true,
                stageName: true,
                itemName: true,
                km: true,
                sectorId: true,
                sectorName: true,
              },
            })
          : null;
        if (!task) throw new NotFoundException('Tarefa não encontrada');
        stops.push({
          kind: 'WORK',
          taskId: task.id,
          description: `${task.code} · ${task.stageName} · ${task.itemName}`,
          address: stop.address?.trim() ?? '',
          sectorId: task.sectorId,
          sectorName: task.sectorName,
          // O km previsto vem da venda, quando o veículo é cobrado
          plannedKm: task.km ?? null,
        });
      } else {
        const description = stop.description?.trim();
        if (!description) bad('Diga o motivo da parada');
        const sector = stop.sectorId
          ? await this.prisma.companySector.findFirst({
              where: { id: stop.sectorId, companyId },
              select: { id: true, name: true },
            })
          : null;
        stops.push({
          kind: 'FREE',
          taskId: null,
          description: description!,
          address: stop.address?.trim() ?? '',
          sectorId: sector?.id ?? null,
          sectorName: sector?.name ?? '',
          plannedKm: null,
        });
      }
    }
    return stops;
  }

  /**
   * Saiu: marca a partida e o odômetro. O veículo só sai de novo depois de
   * fechada a saída anterior (Maicol, 23/11/2026).
   */
  async start(viewer: ProductionViewer, id: string, dto: StartTripDto) {
    const trip = await this.find(viewer.companyId, id);
    if (trip.status !== 'SCHEDULED') bad('Esta saída já saiu ou fechou');
    const open = await this.prisma.productionTrip.findFirst({
      where: {
        companyId: viewer.companyId,
        vehicleId: trip.vehicleId,
        id: { not: id },
        OR: [
          { status: 'ON_ROUTE' },
          { status: 'SCHEDULED', returnAt: { lt: trip.departAt } },
        ],
      },
      select: { number: true, status: true },
    });
    if (open) {
      throw new ConflictException(
        `Feche a saída ${open.number} deste veículo antes: ${open.status === 'ON_ROUTE' ? 'ela ainda está em rota' : 'ela ficou sem fechar'}`,
      );
    }
    await this.prisma.productionTrip.update({
      where: { id },
      data: {
        status: 'ON_ROUTE',
        startedAt: new Date(),
        odometerStart: dto.odometerStart ?? null,
      },
    });
    return this.read(viewer.companyId, id);
  }

  /** Concluir uma parada no caminho (o celular da equipe, a fase 2). */
  async stopResult(
    viewer: ProductionViewer,
    id: string,
    stopId: string,
    dto: StopResultDto,
  ) {
    const trip = await this.find(viewer.companyId, id);
    if (trip.status === 'DONE' || trip.status === 'CANCELED') {
      bad('Esta saída já fechou');
    }
    const stop = trip.stops.find((item) => item.id === stopId);
    if (!stop) throw new NotFoundException('Parada não encontrada');
    if (dto.status === 'NOT_DONE' && !dto.reason?.trim()) {
      bad('Diga por que a parada não foi feita');
    }
    // A parada de trabalho concluída no caminho pede a foto do trabalho
    // pronto (Maicol, 23/11/2026): uma imagem anexada à tarefa depois que
    // a saída começou
    if (dto.status === 'DONE' && stop.kind === 'WORK' && stop.taskId) {
      const since = trip.startedAt ?? trip.departAt;
      const photo = await this.prisma.productionAttachmentVersion.count({
        where: {
          attachment: { taskId: stop.taskId },
          uploadedAt: { gte: since },
          mime: { startsWith: 'image/' },
        },
      });
      if (!photo) bad('Tire a foto do trabalho pronto antes de concluir');
    }
    await this.prisma.productionTripStop.update({
      where: { id: stopId },
      data: {
        status: dto.status,
        reason: dto.reason?.trim() || null,
        doneAt: new Date(),
        doneByName: viewer.name,
      },
    });
    return this.read(viewer.companyId, id);
  }

  /**
   * Fechar na volta (VE-5): o km (pelo odômetro ou informado) repartido
   * entre as paradas de trabalho pelo previsto, ou como quem fecha ajustou;
   * as paradas abertas ficam feitas ou não feitas (a não feita volta para
   * "precisam de saída").
   */
  async close(viewer: ProductionViewer, id: string, dto: CloseTripDto) {
    const trip = await this.find(viewer.companyId, id);
    if (trip.status === 'DONE' || trip.status === 'CANCELED') {
      bad('Esta saída já fechou');
    }
    const km =
      dto.odometerEnd !== undefined && trip.odometerStart !== null
        ? dto.odometerEnd - trip.odometerStart
        : dto.km;
    if (km === undefined || km === null || !(km >= 0)) {
      bad(
        trip.odometerStart !== null
          ? 'Informe o odômetro na volta'
          : 'Informe o km rodado',
      );
    }
    if (dto.odometerEnd !== undefined && km! < 0) {
      bad('O odômetro da volta é menor que o da saída');
    }
    const results = new Map(
      (dto.stops ?? []).map((item) => [item.stopId, item]),
    );
    for (const stop of trip.stops) {
      if (stop.status !== 'PENDING') continue;
      const result = results.get(stop.id);
      if (!result) bad(`Diga se a parada "${stop.description}" foi feita`);
      if (result!.status === 'NOT_DONE' && !result!.reason?.trim()) {
        bad(`Diga por que "${stop.description}" não foi feita`);
      }
    }
    const allocation = dto.allocations?.length
      ? new Map(dto.allocations.map((item) => [item.stopId, item.km]))
      : allocateKm(
          trip.stops.map((stop) => ({
            id: stop.id,
            kind: stop.kind,
            plannedKm: stop.plannedKm,
          })),
          km!,
        );
    const finishedAt = dto.finishedAt ? new Date(dto.finishedAt) : new Date();
    await this.prisma.$transaction(async (tx) => {
      for (const stop of trip.stops) {
        const result = results.get(stop.id);
        await tx.productionTripStop.update({
          where: { id: stop.id },
          data: {
            km: allocation.get(stop.id) ?? 0,
            ...(stop.status === 'PENDING' && result
              ? {
                  status: result.status,
                  reason: result.reason?.trim() || null,
                  doneAt: finishedAt,
                  doneByName: viewer.name,
                }
              : {}),
          },
        });
      }
      await tx.productionTrip.update({
        where: { id },
        data: {
          status: 'DONE',
          startedAt: trip.startedAt ?? trip.departAt,
          finishedAt,
          odometerEnd: dto.odometerEnd ?? null,
          km: km!,
          closedByName: viewer.name,
        },
      });
    });
    return this.read(viewer.companyId, id);
  }

  async cancel(viewer: ProductionViewer, id: string, dto: CancelTripDto) {
    const trip = await this.find(viewer.companyId, id);
    if (trip.status !== 'SCHEDULED') bad('Só a saída agendada se cancela');
    const reason = dto.reason?.trim() || bad('Diga o motivo');
    await this.prisma.$transaction(async (tx) => {
      await tx.productionTrip.update({
        where: { id },
        data: { status: 'CANCELED', cancelReason: reason },
      });
      // Os pedidos voltam a esperar uma saída
      await tx.productionVehicleRequest.updateMany({
        where: { tripId: id },
        data: { status: 'OPEN', tripId: null },
      });
    });
    return this.read(viewer.companyId, id);
  }

  /**
   * Quem estava com o veículo (VE-2): pela placa e o momento, para quando
   * chega uma multa. Vale para as saídas livres e as de vários dias.
   */
  async whoWas(viewer: ProductionViewer, plate: string, at: string) {
    const when = new Date(at);
    if (!plate?.trim() || Number.isNaN(when.getTime())) {
      bad('Informe a placa, o dia e a hora');
    }
    const normalized = plate.replace(/[^a-z0-9]/gi, '').toUpperCase();
    const vehicles = await this.prisma.productionVehicle.findMany({
      where: { companyId: viewer.companyId },
      select: { id: true, name: true, plate: true },
    });
    const vehicle = vehicles.find(
      (item) =>
        item.plate.replace(/[^a-z0-9]/gi, '').toUpperCase() === normalized,
    );
    if (!vehicle) throw new NotFoundException('Placa não encontrada');
    const day = 86_400_000 * 10;
    const trips = await this.prisma.productionTrip.findMany({
      where: {
        vehicleId: vehicle.id,
        departAt: { lte: new Date(when.getTime() + day) },
        returnAt: { gte: new Date(when.getTime() - day) },
      },
      include: TRIP_INCLUDE,
      orderBy: { departAt: 'asc' },
    });
    const trip = tripAt(trips, when);
    if (!trip) return { vehicle, trip: null };
    const people = await this.prisma.employee.findMany({
      where: { id: { in: trip.teamIds } },
      select: { id: true, name: true },
    });
    return {
      vehicle,
      trip: this.view(trip, new Map(people.map((p) => [p.id, p.name]))),
    };
  }

  /* --------------------------------------------------- pedir veículo */

  async request(viewer: ProductionViewer, dto: VehicleRequestDto) {
    const reason = dto.reason?.trim() || bad('Diga para quê');
    const sector = dto.sectorId
      ? await this.prisma.companySector.findFirst({
          where: { id: dto.sectorId, companyId: viewer.companyId },
          select: { id: true, name: true },
        })
      : null;
    return this.prisma.productionVehicleRequest.create({
      data: {
        companyId: viewer.companyId,
        requestedById: viewer.userId,
        requestedByName: viewer.name,
        sectorId: sector?.id ?? null,
        sectorName: sector?.name ?? '',
        reason,
        destination: dto.destination?.trim() ?? '',
        date: new Date(`${dto.date}T00:00:00Z`),
      },
    });
  }

  async cancelRequest(viewer: ProductionViewer, id: string) {
    const request = await this.prisma.productionVehicleRequest.findFirst({
      where: { id, companyId: viewer.companyId },
    });
    if (!request) throw new NotFoundException('Pedido não encontrado');
    if (request.status !== 'OPEN') bad('O pedido já foi agendado');
    return this.prisma.productionVehicleRequest.update({
      where: { id },
      data: { status: 'CANCELED' },
    });
  }

  /* ------------------------------------------------------------ apoio */

  private async find(companyId: string, id: string) {
    const trip = await this.prisma.productionTrip.findFirst({
      where: { id, companyId },
      include: TRIP_INCLUDE,
    });
    if (!trip) throw new NotFoundException(TRIP_NOT_FOUND);
    return trip;
  }

  async read(companyId: string, id: string) {
    const trip = await this.find(companyId, id);
    const people = await this.prisma.employee.findMany({
      where: { id: { in: trip.teamIds } },
      select: { id: true, name: true },
    });
    return this.view(trip, new Map(people.map((p) => [p.id, p.name])));
  }

  private view(
    trip: Awaited<ReturnType<ProductionTripService['find']>>,
    nameOf: Map<string, string>,
  ) {
    return {
      id: trip.id,
      number: trip.number,
      status: trip.status,
      vehicle: trip.vehicle,
      driver: trip.driver,
      team: trip.teamIds.map((id) => ({ id, name: nameOf.get(id) ?? '' })),
      departAt: trip.departAt.toISOString(),
      returnAt: trip.returnAt.toISOString(),
      startedAt: trip.startedAt?.toISOString() ?? null,
      finishedAt: trip.finishedAt?.toISOString() ?? null,
      odometerStart: trip.odometerStart,
      odometerEnd: trip.odometerEnd,
      km: trip.km,
      note: trip.note,
      cancelReason: trip.cancelReason,
      createdBy: trip.createdByName,
      closedBy: trip.closedByName,
      stops: trip.stops.map((stop) => ({
        id: stop.id,
        kind: stop.kind,
        taskId: stop.taskId,
        description: stop.description,
        address: stop.address,
        sector: stop.sectorName,
        plannedKm: stop.plannedKm,
        km: stop.km,
        status: stop.status,
        reason: stop.reason,
        doneAt: stop.doneAt?.toISOString() ?? null,
        doneBy: stop.doneByName,
      })),
    };
  }
}
