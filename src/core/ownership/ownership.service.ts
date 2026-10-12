import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { SubscriptionQuoteService } from '../subscriptions/pricing/subscription-quote.service';
import { SendOwnershipTransferDto } from './dto/ownership.dto';
import { isDeclaredTestEnv } from 'src/shared/utils/app-env';
import {
  ACCEPTANCE_LEASE_MS,
  newInviteToken,
  normalizeEmail,
  TRANSFER_DEADLINE_DAYS,
  transferDaysLeft,
  transferExpiresAt,
  transferStateOf,
} from './ownership.domain';

export interface OwnershipUser {
  userId: string;
  companyId: string;
}

export interface OwnershipPeriodView {
  holderName: string;
  document: string | null;
  email: string | null;
  startedAt: Date;
  endedAt: Date | null;
}

export interface OwnershipView {
  /** Quem está logado é o titular: só ele transfere e cancela a assinatura. */
  isOwner: boolean;
  /** A pessoa titular da conta. */
  owner: { name: string; email: string } | null;
  /** O titular atual, com os dados de hoje do contratante. */
  current: OwnershipPeriodView | null;
  /** Os anteriores, do mais recente para o mais antigo. */
  previous: OwnershipPeriodView[];
  pending: {
    targetEmail: string;
    sentAt: Date;
    expiresAt: Date;
    daysLeft: number;
    sentByName: string;
  } | null;
  /** Por que a transferência não pode ser enviada agora, se não pode. */
  blocked: { code: string; message: string } | null;
  canSend: boolean;
}

/** Os status que ainda disputam a titularidade: a pendente e a em aceite. */
const OPEN_STATUSES = ['PENDING', 'ACCEPTING'];

/**
 * Transferência de titularidade, do lado de quem envia: ver, enviar, cancelar.
 *
 * Só o titular envia e cancela — transferir o ambiente é um dos atos que só ele
 * pratica. O envio pede só o e-mail de destino, exige a confirmação de que o
 * acesso será perdido, e fica pendente por 14 dias. Enquanto pendente, nada
 * muda no ambiente: só o aceite (OwnershipAcceptanceService) move alguma
 * coisa.
 */
@Injectable()
export class OwnershipService {
  private readonly logger = new Logger(OwnershipService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly quoteService: SubscriptionQuoteService,
    private readonly mailer: MailerService,
  ) {}

  async view(
    companyId: string,
    userId: string,
    now: Date = new Date(),
  ): Promise<OwnershipView> {
    const company = await this.loadCompany(companyId);
    const [periods, openTransfers, lastAcceptance, owner, blocked] =
      await Promise.all([
        this.prisma.ownershipPeriod.findMany({
          where: { companyId },
          orderBy: { startedAt: 'desc' },
        }),
        this.prisma.ownershipTransfer.findMany({
          where: { companyId, status: { in: OPEN_STATUSES } },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.contractAcceptance.findFirst({
          where: { companyId },
          orderBy: { createdAt: 'desc' },
          select: { contractorName: true, contractorDocument: true },
        }),
        company.ownerUserId
          ? this.prisma.user.findUnique({
              where: { id: company.ownerUserId },
              select: { name: true, email: true },
            })
          : Promise.resolve(null),
        this.blockedReason(company, now),
      ]);

    const open = periods.find((p) => !p.endedAt) ?? null;
    // O período aberto mostra o contratante de hoje: o nome gravado quando ele
    // abriu (no cadastro, antes da contratação) pode não ser mais o da empresa.
    const current: OwnershipPeriodView | null =
      open || company.ownerUserId
        ? {
            holderName:
              lastAcceptance?.contractorName ??
              open?.holderName ??
              company.legalName ??
              company.name,
            document:
              lastAcceptance?.contractorDocument ??
              open?.document ??
              company.cnpj ??
              null,
            email: owner?.email ?? open?.email ?? null,
            startedAt: open?.startedAt ?? company.createdAt,
            endedAt: null,
          }
        : null;

    const pendingTransfer =
      openTransfers.find((t) => transferStateOf(t, now) === 'PENDING') ?? null;
    const isOwner = !!userId && company.ownerUserId === userId;

    return {
      isOwner,
      owner: owner ? { name: owner.name, email: owner.email } : null,
      current,
      previous: periods
        .filter((p) => p.endedAt)
        .map((p) => ({
          holderName: p.holderName,
          document: p.document,
          email: p.email,
          startedAt: p.startedAt,
          endedAt: p.endedAt,
        })),
      pending: pendingTransfer
        ? {
            targetEmail: pendingTransfer.targetEmail,
            sentAt: pendingTransfer.createdAt,
            expiresAt: transferExpiresAt(pendingTransfer),
            daysLeft: transferDaysLeft(pendingTransfer, now),
            sentByName: pendingTransfer.fromUserName,
          }
        : null,
      blocked,
      canSend: isOwner && !pendingTransfer && !blocked,
    };
  }

  async send(
    user: OwnershipUser,
    dto: SendOwnershipTransferDto,
    now: Date = new Date(),
  ) {
    const company = await this.loadCompany(user.companyId);
    this.assertOwner(
      company,
      user.userId,
      'Somente o titular da conta transfere a titularidade.',
    );
    const blocked = await this.blockedReason(company, now);
    if (blocked) {
      throw new ConflictException(blocked);
    }

    const sender = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.userId },
      select: { id: true, name: true, email: true },
    });
    const targetEmail = normalizeEmail(dto.targetEmail);
    if (targetEmail === normalizeEmail(sender.email)) {
      throw new UnprocessableEntityException({
        code: 'SAME_EMAIL',
        message:
          'Informe o e-mail de quem vai receber o ambiente, não o da sua conta.',
      });
    }

    const { token, hash } = newInviteToken();
    const transfer = await this.prisma.$transaction(async (tx) => {
      // Dois envios simultâneos se enfileiram aqui, e o segundo encontra o
      // primeiro: nunca há duas pendentes.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ownership:${user.companyId}`}))`;
      const open = await tx.ownershipTransfer.findMany({
        where: { companyId: user.companyId, status: { in: OPEN_STATUSES } },
      });
      if (open.some((t) => transferStateOf(t, now) === 'PENDING')) {
        throw new ConflictException({
          code: 'TRANSFER_PENDING',
          message:
            'Já existe uma transferência pendente. Cancele-a antes de enviar outra.',
        });
      }

      const created = await tx.ownershipTransfer.create({
        data: {
          companyId: user.companyId,
          companyName: company.name,
          fromUserId: sender.id,
          fromUserName: sender.name,
          targetEmail,
          tokenHash: hash,
        },
      });
      await tx.companyHistory.create({
        data: {
          companyId: user.companyId,
          action: 'OWNERSHIP_TRANSFER_SENT',
          description: `Transferência de titularidade enviada para ${targetEmail}`,
          metadata: { transferId: created.id },
          createdBy: sender.id,
          createdByName: sender.name,
        },
      });
      return created;
    });

    const inviteUrl = inviteUrlOf(token);
    await this.sendInvite({
      to: targetEmail,
      senderName: sender.name,
      companyName: company.name,
      inviteUrl,
      expiresAt: transferExpiresAt(transfer),
    });

    const view = await this.view(user.companyId, user.userId, now);
    // Fora de produção o link volta na resposta, como o código de
    // verificação do cadastro: dá para testar sem caixa de e-mail.
    return exposesInviteUrl() ? { ...view, devInviteUrl: inviteUrl } : view;
  }

  async cancel(user: OwnershipUser, now: Date = new Date()) {
    const company = await this.loadCompany(user.companyId);
    this.assertOwner(
      company,
      user.userId,
      'Somente o titular da conta cancela a transferência.',
    );
    const sender = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.userId },
      select: { id: true, name: true },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ownership:${user.companyId}`}))`;
      const open = await tx.ownershipTransfer.findMany({
        where: { companyId: user.companyId, status: { in: OPEN_STATUSES } },
        orderBy: { createdAt: 'desc' },
      });
      const pending = open.find((t) => transferStateOf(t, now) === 'PENDING');
      if (!pending) {
        throw new NotFoundException({
          code: 'NO_PENDING_TRANSFER',
          message: 'Não há transferência pendente para cancelar.',
        });
      }

      // Um aceite em curso não é interrompido; um que caiu no meio, sim.
      const { count } = await tx.ownershipTransfer.updateMany({
        where: {
          id: pending.id,
          OR: [
            { status: 'PENDING' },
            {
              status: 'ACCEPTING',
              updatedAt: { lt: new Date(now.getTime() - ACCEPTANCE_LEASE_MS) },
            },
          ],
        },
        data: { status: 'CANCELED', canceledAt: now },
      });
      if (count === 0) {
        throw new ConflictException({
          code: 'TRANSFER_BEING_ACCEPTED',
          message:
            'A transferência está sendo aceita neste momento e não pode mais ser cancelada.',
        });
      }

      await tx.companyHistory.create({
        data: {
          companyId: user.companyId,
          action: 'OWNERSHIP_TRANSFER_CANCELED',
          description: `Transferência de titularidade para ${pending.targetEmail} cancelada`,
          metadata: { transferId: pending.id },
          createdBy: sender.id,
          createdByName: sender.name,
        },
      });
    });

    return this.view(user.companyId, user.userId, now);
  }

  /**
   * Por que o ambiente não pode ser transferido agora. Vale para o envio e é
   * repetido no aceite.
   */
  async blockedReason(
    company: CompanyForOwnership,
    now: Date,
  ): Promise<{ code: string; message: string } | null> {
    if (company.principalCompanyId) {
      return {
        code: 'BRANCH_COMPANY',
        message:
          'Esta é uma filial: a titularidade acompanha a empresa principal.',
      };
    }
    if (company._count.subsidiaries > 0) {
      return {
        code: 'BRANCHES_NOT_SUPPORTED',
        message:
          'Este ambiente tem filiais, e a transferência de um ambiente com filiais é feita com a Atrupe. Fale com a gente.',
      };
    }
    const ctx = await this.quoteService.getBillingContext(company.id, now);
    if (ctx.hasOpenCharge) {
      return {
        code: 'OPEN_CHARGE',
        message:
          'Há uma cobrança em aberto na assinatura. A transferência só pode ser feita com a assinatura em dia.',
      };
    }
    return null;
  }

  async loadCompany(companyId: string): Promise<CompanyForOwnership> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: COMPANY_FOR_OWNERSHIP,
    });
    if (!company) {
      throw new NotFoundException('Empresa não encontrada.');
    }
    return company;
  }

  private assertOwner(
    company: CompanyForOwnership,
    userId: string,
    message: string,
  ) {
    if (!userId || company.ownerUserId !== userId) {
      throw new ForbiddenException({ code: 'OWNER_ONLY', message });
    }
  }

  private async sendInvite(input: {
    to: string;
    senderName: string;
    companyName: string;
    inviteUrl: string;
    expiresAt: Date;
  }) {
    await this.mailer
      .sendMail({
        to: input.to,
        subject: `${input.senderName} quer transferir o ambiente ${input.companyName} para você`,
        template: 'ownership-transfer-invite',
        context: {
          senderName: input.senderName,
          companyName: input.companyName,
          inviteLink: input.inviteUrl,
          deadlineDays: TRANSFER_DEADLINE_DAYS,
          expiresAt: input.expiresAt.toLocaleDateString('pt-BR', {
            timeZone: 'America/Sao_Paulo',
          }),
        },
      })
      .catch((error) => {
        // O convite fica pendente mesmo assim: cancelar e reenviar gera outro.
        this.logger.error(
          `Falha ao enviar o convite de transferência para ${input.to}: ${error.message}`,
        );
      });
  }
}

export const COMPANY_FOR_OWNERSHIP = {
  id: true,
  name: true,
  legalName: true,
  cnpj: true,
  createdAt: true,
  ownerUserId: true,
  principalCompanyId: true,
  _count: { select: { subsidiaries: true } },
} as const;

export interface CompanyForOwnership {
  id: string;
  name: string;
  legalName: string | null;
  cnpj: string | null;
  createdAt: Date;
  ownerUserId: string | null;
  principalCompanyId: string | null;
  _count: { subsidiaries: number };
}

export function inviteUrlOf(token: string): string {
  return `${process.env.FRONTEND_URL}/convite-de-transferencia?token=${encodeURIComponent(token)}`;
}

function exposesInviteUrl(): boolean {
  // O link do convite vale a titularidade: com APP_ENV ausente, a resposta é
  // a de produção (antes, ausente expunha o link)
  return isDeclaredTestEnv();
}
