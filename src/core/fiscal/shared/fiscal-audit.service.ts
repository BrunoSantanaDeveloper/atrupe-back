import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../config/prisma/prisma.service';
import {
  FiscalConfigAction,
  ActorType,
  FiscalEnvironment,
  FiscalConfigHistoryResult,
  Prisma,
} from '@prisma/client';
import * as crypto from 'crypto';

export interface FiscalAuditActionData {
  companyId: string;
  invoicyConfigId?: string;
  emissorName: string;
  action: FiscalConfigAction;
  actorType: ActorType;
  createdBy: string;
  createdByName: string;
  environment?: FiscalEnvironment;
  description: string;
  changes?: any;
}

@Injectable()
export class FiscalAuditService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly ALLOWED_AUDIT_FIELDS = new Set([
    'name',
    'isDefault',
    'environment',
    'ambiente',
    'emitCrt',
    'isActive',
    'contingenciaNfceAtiva',
    'activeEnvironment',
    'status',
    'nfceSeries',
    'nfceNextNumber',
  ]);

  sanitizeChanges(changes: any): any {
    if (!changes || typeof changes !== 'object') return null;
    const sanitized: any = {};
    for (const [key, val] of Object.entries(changes)) {
      if (this.ALLOWED_AUDIT_FIELDS.has(key)) {
        sanitized[key] = val;
      } else {
        sanitized[key] = '[MASKED_SECRET]';
      }
    }
    return sanitized;
  }

  classifyAndSanitizeError(error: any): {
    errorCode: string;
    httpStatus: number;
    category: string;
  } {
    const msg = String(error?.message || '').toLowerCase();
    if (
      msg.includes('unauthorized') ||
      msg.includes('accesskey') ||
      msg.includes('access key') ||
      msg.includes('autentica') ||
      msg.includes('credential') ||
      msg.includes('credencial')
    ) {
      return {
        errorCode: 'PROVIDER_AUTH_ERROR',
        httpStatus: 401,
        category: 'AUTHENTICATION',
      };
    }
    if (
      msg.includes('timeout') ||
      msg.includes('etimedout') ||
      msg.includes('network')
    ) {
      return {
        errorCode: 'PROVIDER_TIMEOUT_ERROR',
        httpStatus: 504,
        category: 'NETWORK',
      };
    }
    if (
      msg.includes('unique constraint') ||
      msg.includes('prismaclientknownrequesterror')
    ) {
      return {
        errorCode: 'DATABASE_CONSTRAINT_VIOLATION',
        httpStatus: 400,
        category: 'DATABASE',
      };
    }
    return {
      errorCode: 'INTERNAL_SERVER_ERROR',
      httpStatus: 500,
      category: 'SYSTEM',
    };
  }

  /**
   * Grava estado + registro de auditoria atomicamente na mesma transação.
   * O resultado (SUCCESS/FAILED) é predeterminado pelo chamador — útil quando
   * a action já executou e precisamos persistir o desfecho sem um segundo try/catch.
   */
  async commitWithOutcome<T>(
    auditData: {
      companyId: string;
      invoicyConfigId?: string;
      emissorName: string;
      action: FiscalConfigAction;
      actorType: ActorType;
      createdBy?: string;
      createdByName: string;
      environment?: FiscalEnvironment;
      description: string;
      changes?: any;
      result: FiscalConfigHistoryResult;
      metadata?: any;
    },
    actionFn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const correlationId = crypto.randomUUID();
    const sanitizedChanges = this.sanitizeChanges(auditData.changes);
    return this.prisma.$transaction(async (tx) => {
      const value = await actionFn(tx);
      await tx.invoicyConfigHistory.create({
        data: {
          companyId: auditData.companyId,
          invoicyConfigId: auditData.invoicyConfigId,
          emissorName: auditData.emissorName,
          action: auditData.action,
          actorType: auditData.actorType,
          createdBy: auditData.createdBy,
          createdByName: auditData.createdByName,
          environment: auditData.environment,
          description: auditData.description,
          changes: sanitizedChanges || Prisma.JsonNull,
          result: auditData.result,
          correlationId,
          metadata: auditData.metadata ?? Prisma.JsonNull,
        },
      });
      return value;
    });
  }

  async runAuditedAction<T>(
    auditData: FiscalAuditActionData,
    actionFn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const correlationId = crypto.randomUUID();
    const sanitizedChanges = this.sanitizeChanges(auditData.changes);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const result = await actionFn(tx);
        await tx.invoicyConfigHistory.create({
          data: {
            companyId: auditData.companyId,
            invoicyConfigId: auditData.invoicyConfigId,
            emissorName: auditData.emissorName,
            action: auditData.action,
            actorType: auditData.actorType,
            createdBy: auditData.createdBy,
            createdByName: auditData.createdByName,
            environment: auditData.environment,
            description: auditData.description,
            changes: sanitizedChanges || Prisma.JsonNull,
            result: 'SUCCESS',
            correlationId,
          },
        });
        return result;
      });
    } catch (error) {
      await this.recordFailedAction(auditData, error);
      throw error;
    }
  }

  /**
   * Registra uma falha ocorrida antes da transação de negócio, como a validação
   * remota de uma credencial. O erro bruto nunca é persistido.
   */
  async recordFailedAction(
    auditData: FiscalAuditActionData,
    error: unknown,
  ): Promise<void> {
    const correlationId = crypto.randomUUID();
    const sanitizedChanges = this.sanitizeChanges(auditData.changes);
    const classified = this.classifyAndSanitizeError(error);

    await this.prisma.invoicyConfigHistory.create({
      data: {
        companyId: auditData.companyId,
        invoicyConfigId: auditData.invoicyConfigId,
        emissorName: auditData.emissorName,
        action: auditData.action,
        actorType: auditData.actorType,
        createdBy: auditData.createdBy,
        createdByName: auditData.createdByName,
        environment: auditData.environment,
        description: `FALHA: ${auditData.description} (Erro Classificado: ${classified.errorCode}, Categoria: ${classified.category}, Status HTTP: ${classified.httpStatus})`,
        changes: sanitizedChanges || Prisma.JsonNull,
        result: 'FAILED',
        correlationId,
        metadata: {
          errorCode: classified.errorCode,
          category: classified.category,
          httpStatus: classified.httpStatus,
        },
      },
    });
  }
}
