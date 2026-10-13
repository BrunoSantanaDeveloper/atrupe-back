import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'nestjs-prisma';

export type CostAuditEntry = {
  companyId: string;
  userId?: string | null;
  /** O que mudou: ASSET, ASSET_COST, ASSET_SETUP, ASSET_GROUP, … */
  entity: string;
  entityId: string;
  /** CREATE, UPDATE, DELETE, INACTIVATE, SELL, … */
  action: string;
  before?: unknown;
  after?: unknown;
};

// O registro guarda JSON simples: datas viram texto e campos indefinidos saem
const asJson = (value: unknown) =>
  value === undefined || value === null
    ? Prisma.DbNull
    : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue);

/**
 * O histórico das escritas que mudam custo ou preço (SEG-4): antes, depois,
 * quem e quando. A leitura das telas de método já fica no registro de
 * atividade (rota, método e usuário de toda requisição autenticada). Uma
 * falha aqui não desfaz a escrita: vai para o log.
 */
@Injectable()
export class CostAuditService {
  private readonly logger = new Logger(CostAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: CostAuditEntry) {
    try {
      await this.prisma.costAuditLog.create({
        data: {
          companyId: entry.companyId,
          userId: entry.userId ?? null,
          entity: entry.entity,
          entityId: entry.entityId,
          action: entry.action,
          before: asJson(entry.before),
          after: asJson(entry.after),
        },
      });
    } catch (error) {
      this.logger.error(
        `Histórico de custo não gravado (${entry.entity} ${entry.entityId} ${entry.action}): ${error.message}`,
      );
    }
  }
}
