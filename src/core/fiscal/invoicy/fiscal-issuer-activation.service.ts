import {
  Injectable,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../../config/prisma/prisma.service';
import { FiscalRolloutPolicyService } from '../shared/fiscal-rollout-policy.service';
import { FiscalAuditService } from '../shared/fiscal-audit.service';
import { FiscalIssuerReadinessService } from './fiscal-issuer-readiness.service';
import { InvoicyCompanyRegistrationService } from './invoicy-company-registration.service';
import {
  FiscalEnvironment,
  FiscalActivationStatus,
  FiscalEnvironmentStatus,
  FiscalConfigAction,
  ActorType,
  Prisma,
} from '@prisma/client';
import * as crypto from 'crypto';

const LEASE_TTL_MS = 10 * 60 * 1000; // 10 minutos
const HEARTBEAT_INTERVAL_MS = Math.floor(LEASE_TTL_MS / 3); // ~3min 20s

export interface ActivationResult {
  success: boolean;
  replayed?: boolean;
  resultSnapshot?: any;
}

class ReadinessFailedError extends Error {
  constructor(
    public readonly errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'ReadinessFailedError';
  }
}

@Injectable()
export class FiscalIssuerActivationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rolloutPolicy: FiscalRolloutPolicyService,
    private readonly fiscalAuditService: FiscalAuditService,
    private readonly readinessService: FiscalIssuerReadinessService,
    private readonly registrationService: InvoicyCompanyRegistrationService,
  ) {}

  async activate(
    companyId: string,
    invoicyConfigId: string,
    environment: FiscalEnvironment,
    options: {
      idempotencyKey?: string;
      confirmFiscalValidity?: boolean;
      docType?: 'NFE' | 'NFSE' | 'NFCE';
      actorUserId?: string;
      actorUserName?: string;
    } = {},
  ): Promise<ActivationResult> {
    // 1. Verificar propriedade
    const emissor = await this.prisma.invoicyConfig.findUnique({
      where: { id: invoicyConfigId },
    });
    if (!emissor || emissor.companyId !== companyId) {
      throw new NotFoundException('Emissor não encontrado');
    }

    // 2. Gate de rollout
    const rolloutEnabled =
      await this.rolloutPolicy.isRolloutActivationEnabled();
    if (!rolloutEnabled) {
      throw new ForbiddenException('ACTIVATION_ROLLOUT_DISABLED');
    }

    // 3. Gate de produção
    if (environment === FiscalEnvironment.PRODUCAO) {
      if (!this.rolloutPolicy.isProductionActivationEnabled()) {
        throw new ForbiddenException('PRODUCTION_ACTIVATION_DISABLED');
      }
      if (!options.confirmFiscalValidity) {
        throw new BadRequestException(
          'Para ativar produção, envie confirmFiscalValidity=true',
        );
      }
    }

    // Normalizar chave de idempotência
    const idempotencyKey = options.idempotencyKey?.trim() ?? null;

    // 4. Adquirir lease (serializa por emissor+docType via FOR UPDATE)
    const { attemptId, replayed, resultSnapshot } = await this.acquireLease(
      invoicyConfigId,
      environment,
      idempotencyKey,
      options.docType ?? 'NFCE',
    );

    if (replayed) {
      return { success: true, replayed: true, resultSnapshot };
    }

    // 5. Iniciar heartbeat
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    const abortController = new AbortController();
    const { signal } = abortController;
    let heartbeatFailed = false;

    heartbeatTimer = setInterval(async () => {
      try {
        const renewed = await this.renewLease(attemptId);
        if (!renewed) {
          // Lease tomado por outra instância ou expirado: abortar ativação.
          heartbeatFailed = true;
          abortController.abort();
          if (heartbeatTimer) clearInterval(heartbeatTimer);
        }
      } catch {
        // Falha de banco: abortar de forma segura em vez de gerar rejeição não tratada.
        heartbeatFailed = true;
        abortController.abort();
        if (heartbeatTimer) clearInterval(heartbeatTimer);
      }
    }, HEARTBEAT_INTERVAL_MS);

    try {
      // 6. Checks locais
      const { localReady, checks } =
        await this.readinessService.checkLocalReadiness(
          companyId,
          invoicyConfigId,
          environment,
          options.docType,
        );
      if (!localReady) {
        const failedChecks = checks
          .filter((c) => c.status === 'FAIL')
          .map((c) => c.message ?? c.check)
          .join('; ');
        throw new ReadinessFailedError(
          'LOCAL_READINESS_FAILED',
          `Readiness local falhou: ${failedChecks}`,
        );
      }

      // 7. Cadastrar no Invoicy se necessário
      await this.registrationService.ensureRegistered(
        companyId,
        invoicyConfigId,
        environment,
        signal,
      );

      // 8. Readiness completo (inclui provider)
      const fullReadiness = await this.readinessService.checkFullReadiness(
        companyId,
        invoicyConfigId,
        environment,
        options.docType,
        signal,
      );
      if (!fullReadiness.ready) {
        const failedChecks = fullReadiness.checks
          .filter((c) => c.status === 'FAIL')
          .map((c) => c.message ?? c.check)
          .join('; ');
        throw new ReadinessFailedError(
          'PROVIDER_READINESS_FAILED',
          `Readiness do provider falhou: ${failedChecks}`,
        );
      }

      // 9. Commit sucesso
      if (heartbeatFailed || signal.aborted) {
        throw new ConflictException('LEASE_LOST');
      }
      const snapshot = { environment, activatedAt: new Date().toISOString() };
      await this.commitSuccess(
        companyId,
        invoicyConfigId,
        environment,
        options.docType ?? 'NFCE',
        attemptId,
        snapshot,
        options.actorUserId,
        options.actorUserName ?? 'sistema',
      );

      return { success: true };
    } catch (error) {
      await this.commitFailure(
        companyId,
        invoicyConfigId,
        environment,
        options.docType ?? 'NFCE',
        attemptId,
        error instanceof ReadinessFailedError
          ? error.errorCode
          : 'INTERNAL_ERROR',
        options.actorUserName ?? 'sistema',
      );
      if (error instanceof ReadinessFailedError) {
        throw new UnprocessableEntityException({
          errorCode: error.errorCode,
          message: error.message,
        });
      }
      throw error;
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      abortController.abort();
    }
  }

  private async acquireLease(
    invoicyConfigId: string,
    environment: FiscalEnvironment,
    idempotencyKey: string | null,
    docType: 'NFE' | 'NFSE' | 'NFCE',
  ): Promise<{ attemptId: string; replayed: boolean; resultSnapshot?: any }> {
    return this.prisma.$transaction(async (tx) => {
      // Lock no emissor para serializar ativações por emissor
      await tx.$queryRaw`
        SELECT id FROM invoicy_configs WHERE id = ${invoicyConfigId} FOR UPDATE
      `;

      // Travar tentativas RUNNING deste emissor+docType com FOR UPDATE.
      // Permite ativações concorrentes de docTypes diferentes (NFE e NFC-e independentes).
      const lockedRunning = await tx.$queryRaw<
        { id: string; expired: boolean }[]
      >`
        SELECT id, ("leaseExpiresAt" <= NOW()) AS expired
        FROM fiscal_activation_attempts
        WHERE "invoicyConfigId" = ${invoicyConfigId}
          AND "docType" = ${docType}::"FiscalDocType"
          AND status = 'RUNNING'::"FiscalActivationStatus"
        FOR UPDATE
      `;

      // Se qualquer tentativa RUNNING ainda tem lease vigente, há ativação em curso.
      if (lockedRunning.some((r) => !r.expired)) {
        throw new ConflictException('ACTIVATION_IN_PROGRESS');
      }

      // Todas as RUNNING travadas estão expiradas → marcar FAILED.
      // Como seguramos o lock, nenhum heartbeat consegue renová-las antes do commit;
      // após o commit, o WHERE status='RUNNING' do heartbeat não casa mais → aborta.
      if (lockedRunning.length > 0) {
        await tx.$executeRaw`
          UPDATE fiscal_activation_attempts
          SET status = 'FAILED'::"FiscalActivationStatus",
              "errorCode" = 'LEASE_EXPIRED'
          WHERE "invoicyConfigId" = ${invoicyConfigId}
            AND status = 'RUNNING'::"FiscalActivationStatus"
        `;
      }

      const attemptId = crypto.randomUUID();
      // Ancorar a expiração no relógio do banco: lemos NOW() do Postgres e
      // derivamos o vencimento a partir dele. Assim criação, renovação e o
      // critério de expiração/CAS usam a mesma referência temporal (sem drift
      // entre instâncias da aplicação).
      const [{ now: dbNow }] = await tx.$queryRaw<
        { now: Date }[]
      >`SELECT NOW() as now`;
      const leaseExpiresAt = new Date(dbNow.getTime() + LEASE_TTL_MS);

      // Idempotência: localizar tentativa pré-existente com a mesma chave.
      // Nesse ponto, qualquer RUNNING-vigente já teria lançado ACTIVATION_IN_PROGRESS
      // e qualquer RUNNING-expirada já foi marcada FAILED nesta tx. Então o registro
      // existente só pode ser SUCCEEDED (replay) ou FAILED (reaproveitar a linha,
      // evitando violação da unique constraint).
      if (idempotencyKey) {
        const existing = await tx.fiscalActivationAttempt.findUnique({
          where: {
            invoicyConfigId_environment_docType_idempotencyKey: {
              invoicyConfigId,
              environment,
              docType,
              idempotencyKey,
            },
          },
        });

        if (existing) {
          if (existing.status === FiscalActivationStatus.SUCCEEDED) {
            return {
              attemptId: existing.attemptId,
              replayed: true,
              resultSnapshot: existing.resultSnapshot,
            };
          }

          // FAILED (ou recém-marcada FAILED): reaproveitar a linha existente.
          await tx.fiscalActivationAttempt.update({
            where: { id: existing.id },
            data: {
              status: FiscalActivationStatus.RUNNING,
              attemptId,
              leaseExpiresAt,
              errorCode: null,
              resultSnapshot: Prisma.DbNull,
            },
          });

          await tx.invoicyEnvironmentConfig.upsert({
            where: {
              invoicyConfigId_environment_docType: {
                invoicyConfigId,
                environment,
                docType,
              },
            },
            create: {
              invoicyConfigId,
              environment,
              docType,
              status: FiscalEnvironmentStatus.VALIDATING,
            },
            update: { status: FiscalEnvironmentStatus.VALIDATING },
          });

          return { attemptId, replayed: false };
        }
      }

      await tx.fiscalActivationAttempt.create({
        data: {
          invoicyConfigId,
          environment,
          docType,
          idempotencyKey,
          status: FiscalActivationStatus.RUNNING,
          attemptId,
          leaseExpiresAt,
        },
      });

      // Marcar InvoicyEnvironmentConfig como VALIDATING por docType
      await tx.invoicyEnvironmentConfig.upsert({
        where: {
          invoicyConfigId_environment_docType: {
            invoicyConfigId,
            environment,
            docType,
          },
        },
        create: {
          invoicyConfigId,
          environment,
          docType,
          status: FiscalEnvironmentStatus.VALIDATING,
        },
        update: { status: FiscalEnvironmentStatus.VALIDATING },
      });

      return { attemptId, replayed: false };
    });
  }

  private async renewLease(attemptId: string): Promise<boolean> {
    // Expiração ancorada no relógio do banco (NOW()), igual ao critério de
    // expiração/CAS — evita drift entre instâncias da aplicação.
    const result = await this.prisma.$executeRaw`
      UPDATE fiscal_activation_attempts
      SET "leaseExpiresAt" = NOW() + (${LEASE_TTL_MS} * interval '1 millisecond')
      WHERE "attemptId" = ${attemptId}
        AND status = 'RUNNING'::"FiscalActivationStatus"
    `;
    return (result as number) > 0;
  }

  private async commitSuccess(
    companyId: string,
    invoicyConfigId: string,
    environment: FiscalEnvironment,
    docType: 'NFE' | 'NFSE' | 'NFCE',
    attemptId: string,
    snapshot: any,
    actorUserId: string | undefined,
    actorUserName: string,
  ): Promise<void> {
    const emissor = await this.prisma.invoicyConfig.findUnique({
      where: { id: invoicyConfigId },
      select: { name: true },
    });

    await this.fiscalAuditService.commitWithOutcome(
      {
        companyId,
        invoicyConfigId,
        emissorName: emissor?.name ?? '',
        action: FiscalConfigAction.ENVIRONMENT_ACTIVATED,
        actorType: ActorType.USER,
        createdBy: actorUserId,
        createdByName: actorUserName,
        environment,
        description: `Ambiente ${environment} ativado com sucesso`,
        result: 'SUCCESS',
      },
      async (tx) => {
        // Ordem de locks consistente com acquireLease (emissor → attempt) para
        // evitar deadlock entre ativações concorrentes.
        await tx.$queryRaw`
          SELECT id FROM invoicy_configs WHERE id = ${invoicyConfigId} FOR UPDATE
        `;

        // CAS: só gravar se o attempt ainda é o nosso
        const updated = await tx.$executeRaw`
          UPDATE fiscal_activation_attempts
          SET status = 'SUCCEEDED'::"FiscalActivationStatus",
              "resultSnapshot" = ${JSON.stringify(snapshot)}::jsonb
          WHERE "attemptId" = ${attemptId}
            AND status = 'RUNNING'::"FiscalActivationStatus"
            AND "leaseExpiresAt" > NOW()
        `;

        if ((updated as number) === 0) {
          throw new ConflictException('LEASE_LOST');
        }

        await tx.invoicyEnvironmentConfig.update({
          where: {
            invoicyConfigId_environment_docType: {
              invoicyConfigId,
              environment,
              docType,
            },
          },
          data: {
            status: FiscalEnvironmentStatus.READY,
            activatedAt: new Date(),
            activatedBy: actorUserId,
            lastValidationAt: new Date(),
            lastValidationError: null,
          },
        });

        // Atualiza activeEnvironment global (legado) e o campo específico por docType
        const docTypeField =
          docType === 'NFE'
            ? 'activeEnvironmentNfe'
            : docType === 'NFSE'
              ? 'activeEnvironmentNfse'
              : 'activeEnvironmentNfce';
        await tx.invoicyConfig.update({
          where: { id: invoicyConfigId },
          data: {
            activeEnvironment: environment,
            [docTypeField]: environment,
          },
        });
      },
    );
  }

  private async commitFailure(
    companyId: string,
    invoicyConfigId: string,
    environment: FiscalEnvironment,
    docType: 'NFE' | 'NFSE' | 'NFCE',
    attemptId: string,
    errorCode: string,
    actorUserName: string,
  ): Promise<void> {
    const emissor = await this.prisma.invoicyConfig.findUnique({
      where: { id: invoicyConfigId },
      select: { name: true },
    });

    try {
      await this.fiscalAuditService.commitWithOutcome(
        {
          companyId,
          invoicyConfigId,
          emissorName: emissor?.name ?? '',
          action: FiscalConfigAction.VALIDATION_RUN,
          actorType: ActorType.USER,
          createdByName: actorUserName,
          environment,
          description: `Ativação de ${environment} falhou: ${errorCode}`,
          result: 'FAILED',
          metadata: { errorCode },
        },
        async (tx) => {
          // Ordem de locks consistente com acquireLease (emissor → attempt).
          await tx.$queryRaw`
            SELECT id FROM invoicy_configs WHERE id = ${invoicyConfigId} FOR UPDATE
          `;

          // CAS: só marcar FAILED se o lease ainda é nosso
          const updated = await tx.$executeRaw`
            UPDATE fiscal_activation_attempts
            SET status = 'FAILED'::"FiscalActivationStatus",
                "errorCode" = ${errorCode}
            WHERE "attemptId" = ${attemptId}
              AND status = 'RUNNING'::"FiscalActivationStatus"
          `;

          if ((updated as number) > 0) {
            await tx.invoicyEnvironmentConfig.update({
              where: {
                invoicyConfigId_environment_docType: {
                  invoicyConfigId,
                  environment,
                  docType,
                },
              },
              data: {
                status: FiscalEnvironmentStatus.ERROR,
                lastValidationAt: new Date(),
                lastValidationError: errorCode,
              },
            });
          }
        },
      );
    } catch {
      // Falha ao gravar falha: não relançar para não mascarar o erro original
    }
  }
}
