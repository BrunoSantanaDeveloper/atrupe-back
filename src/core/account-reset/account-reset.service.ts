import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { gzipSync } from 'zlib';
import * as argon2 from 'argon2';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { CompanyService } from '../company/company.service';
import {
  delegateOf,
  GROUP_LABELS,
  RESET_STEPS,
  ResetGroup,
  ResetOptions,
  ResetStep,
  stepsFor,
} from './account-reset.plan';

/** Por quanto tempo a cópia do que foi apagado fica guardada. */
export const BACKUP_DAYS = 30;

const GROUP_ORDER: ResetGroup[] = [
  'documents',
  'registries',
  'financial',
  'stock',
  'payroll',
  'fiscal',
  'settings',
];
const OPTIONAL_GROUPS: ResetGroup[] = ['fiscal', 'settings'];

const normalize = (value: string) =>
  String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

// BigInt não vai para JSON por padrão.
const jsonReplacer = (_key: string, value: unknown) =>
  typeof value === 'bigint' ? value.toString() : value;

export interface ResetRequest {
  password: string;
  confirmation: string;
  includeFiscalDocuments?: boolean;
  restoreDefaults?: boolean;
}

/**
 * "Zerar dados da conta", pelo superadmin: apaga documentos, cadastros e
 * lançamentos de uma empresa e mantém a conta — usuários e permissões,
 * assinatura e cobrança, certificado e configuração fiscal (inclusive a
 * numeração das notas, que fica no emissor). É o caminho para o cliente que
 * quer recomeçar sem perder a assinatura nem os acessos.
 *
 * Tudo numa transação: a cópia do que sai, a exclusão, o registro e o
 * histórico. A cópia fica guardada por {@link BACKUP_DAYS} dias.
 */
@Injectable()
export class AccountResetService {
  private readonly logger = new Logger(AccountResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly companyService: CompanyService,
  ) {}

  /** O que sairia e o que fica, sem apagar nada. */
  async preview(companyId: string, options: ResetOptions) {
    const company = await this.loadCompany(companyId);
    const counts = await this.countSteps(this.prisma, companyId, RESET_STEPS);
    const included = new Set(stepsFor(options));

    const groups = GROUP_ORDER.map((group) => {
      const steps = RESET_STEPS.filter((s) => s.group === group);
      return {
        group,
        label: GROUP_LABELS[group],
        optional: OPTIONAL_GROUPS.includes(group),
        included: steps.some((s) => included.has(s)),
        items: steps
          .filter((s) => s.label)
          .map((s) => ({ label: s.label!, count: counts.get(s) ?? 0 })),
        total: steps.reduce((sum, s) => sum + (counts.get(s) ?? 0), 0),
      };
    });

    const [employees, users, certificates, subscription] = await Promise.all([
      this.prisma.employee.count({ where: { companyId } }),
      this.prisma.employee.count({
        where: { companyId, userId: { not: null } },
      }),
      this.prisma.digitalCertificate.count({ where: { companyId } }),
      this.prisma.subscription.findFirst({
        where: { companyId, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
        select: {
          status: true,
          value: true,
          cycle: true,
          plan: { select: { name: true } },
        },
      }),
    ]);

    return {
      company: { id: company.id, name: company.name, cnpj: company.cnpj },
      options,
      groups,
      totalToDelete: groups
        .filter((g) => g.included)
        .reduce((sum, g) => sum + g.total, 0),
      kept: {
        users,
        employees,
        digitalCertificates: certificates,
        subscription: subscription
          ? {
              plan: subscription.plan.name,
              status: subscription.status,
              value: subscription.value,
              cycle: subscription.cycle,
            }
          : null,
      },
    };
  }

  async reset(companyId: string, request: ResetRequest, adminUserId: string) {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminUserId },
      select: { id: true, name: true, password: true },
    });
    if (!admin) {
      throw new UnauthorizedException('Usuário administrador não encontrado.');
    }
    if (!(await argon2.verify(admin.password, request.password))) {
      throw new UnauthorizedException('Senha do administrador incorreta.');
    }

    const company = await this.loadCompany(companyId);
    if (normalize(request.confirmation) !== normalize(company.name)) {
      throw new BadRequestException(
        `Para confirmar, digite o nome da empresa exatamente como aparece: ${company.name}.`,
      );
    }

    const options: ResetOptions = {
      includeFiscalDocuments: !!request.includeFiscalDocuments,
      restoreDefaults: !!request.restoreDefaults,
    };
    const steps = stepsFor(options);
    const backupExpiresAt = new Date(Date.now() + BACKUP_DAYS * 86_400_000);

    this.logger.warn(
      `Zerando os dados da empresa ${company.name} (${companyId}) a pedido de ${admin.name}: ${JSON.stringify(options)}`,
    );

    const { record, summary } = await this.prisma.$transaction(
      async (tx) => {
        const rows: Record<string, unknown[]> = {};
        const summary: Record<string, number> = {};
        for (const step of steps) {
          const delegate = (tx as any)[delegateOf(step.model)];
          const where = step.where(companyId);
          const found = await delegate.findMany({ where });
          if (found.length === 0) continue;
          rows[step.model] = [...(rows[step.model] ?? []), ...found];
          const { count } = await delegate.deleteMany({ where });
          summary[step.model] = (summary[step.model] ?? 0) + count;
        }
        // Com as configurações mantidas, a venda rápida não pode ficar
        // apontando para um cliente que saiu: sem ele, vale o padrão.
        if (!options.restoreDefaults) {
          await tx.quickSaleSettings.updateMany({
            where: { companyId },
            data: { clientId: null },
          });
        }

        const backup = gzipSync(
          Buffer.from(
            JSON.stringify(
              { companyId, companyName: company.name, options, rows },
              jsonReplacer,
            ),
          ),
        );
        const record = await tx.companyDataReset.create({
          data: {
            companyId,
            createdByUserId: admin.id,
            createdByName: admin.name,
            options: { ...options },
            summary,
            backup,
            backupExpiresAt,
          },
        });

        const total = Object.values(summary).reduce((a, b) => a + b, 0);
        await tx.companyHistory.create({
          data: {
            companyId,
            action: 'DATA_RESET',
            description: `Dados da conta zerados pelo superadmin ${admin.name}: ${total} registros apagados${options.restoreDefaults ? ', configurações de conta nova restauradas' : ''}.`,
            metadata: { resetId: record.id, summary, options: { ...options } },
            createdBy: admin.id,
            createdByName: admin.name,
          },
        });

        return { record, summary };
      },
      { maxWait: 10_000, timeout: 180_000 },
    );

    // O padrão de conta nova vem depois e fora da transação: o cadastro o cria
    // item a item, e só o que falta. Se falhar, a exclusão já valeu e o
    // padrão pode ser recriado depois.
    let defaultsRestored = false;
    let warning: string | null = null;
    if (options.restoreDefaults) {
      try {
        const email = await this.ownerEmail(companyId);
        await this.companyService.createDefaultItems(email, companyId);
        defaultsRestored = true;
      } catch (error) {
        warning = `Os dados foram apagados, mas o padrão de conta nova não foi recriado: ${error.message}`;
        this.logger.error(`${warning} (empresa ${companyId})`);
      }
    }

    return {
      resetId: record.id,
      companyId,
      companyName: company.name,
      options,
      summary: this.labelSummary(summary),
      total: Object.values(summary).reduce((a, b) => a + b, 0),
      backupExpiresAt,
      defaultsRestored,
      warning,
    };
  }

  /** As execuções anteriores, sem a cópia (que é pesada). */
  async list(companyId: string) {
    const [resets, withBackup] = await Promise.all([
      this.prisma.companyDataReset.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          createdAt: true,
          createdByName: true,
          options: true,
          summary: true,
          backupExpiresAt: true,
        },
      }),
      this.prisma.companyDataReset.findMany({
        where: { companyId, backup: { not: null } },
        select: { id: true },
      }),
    ]);
    const available = new Set(withBackup.map((r) => r.id));
    return resets.map((r) => ({
      ...r,
      summary: this.labelSummary(r.summary as Record<string, number>),
      backupAvailable: available.has(r.id),
    }));
  }

  /** A cópia do que foi apagado, em JSON compactado. */
  async backupFile(resetId: string) {
    const record = await this.prisma.companyDataReset.findUnique({
      where: { id: resetId },
      select: { backup: true, companyId: true, createdAt: true },
    });
    if (!record) throw new NotFoundException('Registro não encontrado.');
    if (!record.backup) {
      throw new NotFoundException(
        `A cópia já foi descartada: ela fica guardada por ${BACKUP_DAYS} dias.`,
      );
    }
    const day = record.createdAt.toISOString().slice(0, 10);
    return {
      filename: `zerar-dados-${record.companyId}-${day}.json.gz`,
      content: Buffer.from(record.backup),
    };
  }

  /** Descarta as cópias vencidas; o registro do que foi feito continua. */
  @Cron('0 4 * * *', {
    name: 'company-data-reset-backup-purge',
    timeZone: 'America/Sao_Paulo',
  })
  async purgeExpiredBackups(now: Date = new Date()) {
    const { count } = await this.prisma.companyDataReset.updateMany({
      where: { backupExpiresAt: { lt: now }, backup: { not: null } },
      data: { backup: null },
    });
    if (count > 0) {
      this.logger.log(`${count} cópia(s) de "zerar dados" descartada(s).`);
    }
    return count;
  }

  private async loadCompany(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true, cnpj: true, ownerUserId: true },
    });
    if (!company) throw new NotFoundException('Empresa não encontrada.');
    return company;
  }

  private async countSteps(
    client: PrismaService,
    companyId: string,
    steps: ResetStep[],
  ) {
    const counts = new Map<ResetStep, number>();
    for (const step of steps) {
      const delegate = (client as any)[delegateOf(step.model)];
      counts.set(step, await delegate.count({ where: step.where(companyId) }));
    }
    return counts;
  }

  /** O resumo com os nomes da prévia, para quem lê. */
  private labelSummary(summary: Record<string, number>) {
    return Object.entries(summary ?? {}).map(([model, count]) => {
      const step = RESET_STEPS.find((s) => s.model === model);
      return {
        model,
        label: step?.label ?? null,
        group: step ? GROUP_LABELS[step.group] : null,
        count,
      };
    });
  }

  /** O e-mail que o cadastro usa para criar o padrão: o do titular. */
  private async ownerEmail(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { ownerUserId: true },
    });
    if (company?.ownerUserId) {
      const owner = await this.prisma.user.findUnique({
        where: { id: company.ownerUserId },
        select: { email: true },
      });
      if (owner) return owner.email;
    }
    const employee = await this.prisma.employee.findFirst({
      where: { companyId, userId: { not: null } },
      orderBy: { createdAt: 'asc' },
      select: { user: { select: { email: true } } },
    });
    return employee?.user?.email ?? '';
  }
}
