import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  GoneException,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { passwordProblems } from 'src/helpers/validators/password';
import { SessionAccessService } from '../auth/session-access.service';
import { AsaasGatewayService } from '../subscriptions/asaas-gateway.service';
import {
  billingModeOf,
  INSTALLMENT_SUBSCRIPTION_PREFIX,
  isBilledByGateway,
} from '../subscriptions/billing-mode';
import { CompanyRegistryService } from '../subscriptions/checkout/company-registry.service';
import { ContractAcceptanceService } from '../subscriptions/checkout/contract-acceptance.service';
import {
  checkRepresentative,
  resolveCompanyContractor,
  ResolvedContractor,
} from '../subscriptions/checkout/contractor';
import {
  assertTermsAccepted,
  successUrl,
} from '../subscriptions/checkout/contracting-steps';
import { CompanyRegistryRecord } from '../subscriptions/checkout/company-registry.service';
import { addCalendarCycle } from '../subscriptions/pricing/pricing.engine';
import { SubscriptionQuoteService } from '../subscriptions/pricing/subscription-quote.service';
import { AcceptOwnershipTransferDto } from './dto/ownership.dto';
import { resetFiscalIdentity } from './fiscal-identity-reset';
import {
  ACCEPTANCE_LEASE_MS,
  hashInviteToken,
  INVITE_LINK_MESSAGE,
  transferDaysLeft,
  transferExpiresAt,
  transferStateOf,
} from './ownership.domain';
import { CompanyForOwnership, OwnershipService } from './ownership.service';
import { setupFromTemplate } from '../financial/salaries/payroll-math';

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export const INVALID_INVITE_MESSAGE =
  'Este convite não é válido. Confira o link recebido por e-mail.';

export const EMAIL_HAS_ACCOUNT_MESSAGE =
  'Este e-mail já tem uma conta na Atrupe. A transferência exige uma conta nova, porque o ambiente inteiro passa a pertencer a ela. Peça a quem enviou um convite para outro e-mail.';

type TransferRow = Prisma.OwnershipTransferGetPayload<object>;

type CurrentSubscription = NonNullable<
  Awaited<ReturnType<SubscriptionQuoteService['getBillingContext']>>['current']
>;

/** O que o aceite abriu e fechou no Asaas, para desfazer se a gravação falhar. */
interface GatewayMove {
  asaasCustomerId: string;
  /** A linha de cliente do mesmo documento, reaproveitada. */
  reusedCustomerId: string | null;
  newSubscriptionId: string;
  /** A assinatura nova no Asaas (só no recorrente). */
  asaasSubscriptionId: string | null;
  /** As cobranças que ela já gerou, gravadas junto. */
  firstCharges: any[];
  /** De quando a cobrança nova vence. */
  nextDueDate: Date;
  /** As cobranças futuras da anterior, apagadas no Asaas. */
  deletedChargeIds: string[];
  previousClosed: boolean;
}

const toAsaasDate = (date: Date) => date.toISOString().slice(0, 10);
const fromAsaasDate = (value: string) =>
  new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value,
  );

/**
 * Transferência de titularidade, do lado de quem recebe: o convite, e o aceite
 * que efetiva a troca.
 *
 * O aceite exige as três coisas da spec — conta NOVA criada pelo link (o
 * e-mail é o do convite, senha nas cinco regras), a empresa confirmada pela
 * consulta do CNPJ, e o aceite da versão vigente dos Termos — e recusa CNPJ
 * que já tenha ambiente na Atrupe e assinatura com cobrança em aberto.
 *
 * A efetivação não move dados: o ambiente é a mesma empresa, com os mesmos
 * identificadores. Trocam-se a identidade jurídica, o titular, quem consegue
 * entrar e o cliente de cobrança. No Asaas não dá para trocar o cliente de uma
 * assinatura: cria-se a nova, no cliente de quem recebeu, com o mesmo ciclo,
 * valor e vencimento, e a anterior é encerrada — as cobranças que ela gerou
 * continuam no nome de quem as gerou.
 *
 * A ordem no Asaas é a da evolução de plano, que nunca deixa duas cobranças
 * correndo: 1. a assinatura nova; 2. as cobranças futuras da anterior
 * apagadas e ela encerrada; 3. tudo gravado numa transação. Falhando até o 2,
 * a nova é desfeita e a transferência volta a ficar pendente.
 */
@Injectable()
export class OwnershipAcceptanceService {
  private readonly logger = new Logger(OwnershipAcceptanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly asaasGateway: AsaasGatewayService,
    private readonly quoteService: SubscriptionQuoteService,
    private readonly registry: CompanyRegistryService,
    private readonly acceptance: ContractAcceptanceService,
    private readonly ownership: OwnershipService,
    private readonly sessionAccess: SessionAccessService,
    private readonly mailer: MailerService,
  ) {}

  /**
   * O que o link do convite mostra. Um convite que não vale mais diz por quê,
   * antes de pedir qualquer dado; o pendente diz de que ambiente é e quantos
   * dias restam, e já avisa se o e-mail tem conta.
   */
  async open(token: string, now: Date = new Date()) {
    const transfer = await this.findByToken(token);
    if (!transfer) {
      return { state: 'INVALID' as const, message: INVALID_INVITE_MESSAGE };
    }
    const state = transferStateOf(transfer, now);
    if (state !== 'PENDING') {
      return { state, message: INVITE_LINK_MESSAGE[state] };
    }

    const [company, emailHasAccount, terms] = await Promise.all([
      this.ownership.loadCompany(transfer.companyId),
      this.emailHasAccount(transfer.targetEmail),
      this.acceptance.currentTerms(),
    ]);
    const blocked =
      company.ownerUserId !== transfer.fromUserId
        ? staleTransfer()
        : await this.ownership.blockedReason(company, now);

    return {
      state,
      message: null,
      companyName: company.name,
      senderName: transfer.fromUserName,
      targetEmail: transfer.targetEmail,
      sentAt: transfer.createdAt,
      expiresAt: transferExpiresAt(transfer),
      daysLeft: transferDaysLeft(transfer, now),
      emailHasAccount,
      blocked,
      terms: {
        contractId: terms.id,
        name: terms.name,
        version: terms.version,
        html: terms.html,
      },
    };
  }

  /** Os dados da empresa de quem aceita, pela consulta pública do CNPJ. */
  async company(token: string, cnpj: string, now: Date = new Date()) {
    const transfer = await this.pendingTransfer(token, now);
    const view = await this.registry.publicView(cnpj);
    const inUse = await this.cnpjInUse(view.cnpj, transfer.companyId);
    return { ...view, inUse };
  }

  async representativeCheck(
    token: string,
    cnpj: string,
    cpf: string,
    now: Date = new Date(),
  ) {
    await this.pendingTransfer(token, now);
    return checkRepresentative(this.registry, cnpj, cpf);
  }

  async accept(
    dto: AcceptOwnershipTransferDto,
    meta: RequestMeta,
    now: Date = new Date(),
  ) {
    const transfer = await this.pendingTransfer(dto.token, now);
    const email = transfer.targetEmail;

    if (await this.emailHasAccount(email)) {
      throw new ConflictException({
        code: 'EMAIL_HAS_ACCOUNT',
        message: EMAIL_HAS_ACCOUNT_MESSAGE,
      });
    }
    const problems = passwordProblems(dto.password);
    if (problems.length > 0) {
      throw new BadRequestException({
        code: 'WEAK_PASSWORD',
        message: `A senha não atende às regras: ${problems.join('; ')}.`,
        problems,
      });
    }

    const terms = await this.acceptance.currentTerms();
    assertTermsAccepted(dto.termsAcceptance, terms);

    const company = await this.ownership.loadCompany(transfer.companyId);
    if (company.ownerUserId !== transfer.fromUserId) {
      throw new ConflictException(staleTransfer());
    }
    const blocked = await this.ownership.blockedReason(company, now);
    if (blocked) throw new ConflictException(blocked);

    const { contractor, record } = await resolveCompanyContractor(
      this.registry,
      this.logger,
      {
        cnpj: dto.company.cnpj,
        email,
        legalName: dto.company.legalName,
        tradeName: dto.company.tradeName,
        representative: dto.representative,
      },
    );
    if (await this.cnpjInUse(contractor.document, company.id)) {
      throw new ConflictException({
        code: 'CNPJ_IN_USE',
        message:
          'Este CNPJ já tem um ambiente na Atrupe. A transferência precisa ser para uma empresa que ainda não tem ambiente.',
      });
    }

    // Quem sai: o titular de hoje, congelado como ele está agora.
    const before = await this.ownership.view(
      company.id,
      transfer.fromUserId,
      now,
    );

    // Reserva: dois aceites ao mesmo tempo não abrem duas assinaturas.
    await this.claim(transfer.id, now);

    let move: GatewayMove | null = null;
    try {
      const ctx = await this.quoteService.getBillingContext(company.id, now);
      const current =
        ctx.current && ctx.current.status === 'ACTIVE' ? ctx.current : null;
      if (current && isBilledByGateway(current)) {
        move = await this.moveBilling(current, contractor, company, now);
      }

      const input = {
        transfer,
        dto,
        company,
        contractor,
        record,
        terms,
        current,
        move,
        before,
        meta,
        now,
      };
      // Uma segunda tentativa antes de desistir: com a anterior encerrada no
      // Asaas, desfazer já não a devolve.
      const result = await this.effectuate(input).catch((error) => {
        if (error instanceof HttpException) throw error;
        const target = error?.meta?.target;
        if (
          error?.code === 'P2002' &&
          (error.meta?.modelName === 'User' ||
            (Array.isArray(target) && target.join(',') === 'email') ||
            target === 'users_email_key')
        ) {
          // A conta com este e-mail surgiu durante o aceite.
          throw new ConflictException({
            code: 'EMAIL_HAS_ACCOUNT',
            message: EMAIL_HAS_ACCOUNT_MESSAGE,
          });
        }
        this.logger.warn(
          `Efetivação da transferência ${transfer.id} falhou; nova tentativa: ${error.message}`,
        );
        return this.effectuate(input);
      });

      // Efetivada: nada abaixo a desfaz.
      this.sessionAccess.forgetUser(transfer.fromUserId);
      await this.notifySender(transfer, contractor.name, now);
      return {
        accepted: true,
        email,
        companyName: result.companyName,
      };
    } catch (error) {
      await this.undo(transfer, move, error);
      if (error instanceof HttpException) throw error;
      this.logger.error(
        `Transferência ${transfer.id} não efetivada: ${error.message}`,
      );
      throw new BadGatewayException({
        code: 'TRANSFER_FAILED',
        message:
          'Não foi possível concluir a transferência agora. Nada mudou no ambiente; tente novamente em instantes.',
      });
    }
  }

  /**
   * A cobrança passa para quem recebeu: o cliente dele no Asaas e, no
   * recorrente, a assinatura nova; depois, a anterior deixa de cobrar.
   *
   * A assinatura nova vence quando venceria a cobrança seguinte da anterior —
   * a que o Asaas já tivesse gerado é apagada e volta a ser gerada no cliente
   * novo, na mesma data.
   */
  private async moveBilling(
    current: CurrentSubscription,
    contractor: ResolvedContractor,
    company: CompanyForOwnership,
    now: Date,
  ): Promise<GatewayMove> {
    const mode = billingModeOf(current);
    const charges = await this.asaasGateway.getChargesOf(current);
    const today = toAsaasDate(now);
    const open = charges.some(
      (p) =>
        p.status === 'OVERDUE' ||
        p.status === 'AWAITING_RISK_ANALYSIS' ||
        (p.status === 'PENDING' && String(p.dueDate) < today),
    );
    if (open) {
      throw new ConflictException({
        code: 'OPEN_CHARGE',
        message:
          'Há uma cobrança em aberto na assinatura deste ambiente. A transferência só pode ser aceita depois que ela for paga — avise quem enviou o convite.',
      });
    }
    const future = charges.filter((p) => p.status === 'PENDING');
    const nextDueDate = future.length
      ? future
          .map((p) => fromAsaasDate(String(p.dueDate)))
          .reduce((a, b) => (a.getTime() <= b.getTime() ? a : b))
      : current.nextDueDate;

    const customer = await this.provisionCustomer(company.id, contractor);
    const move: GatewayMove = {
      asaasCustomerId: customer.asaasCustomerId,
      reusedCustomerId: customer.reusedCustomerId,
      newSubscriptionId: randomUUID(),
      asaasSubscriptionId: null,
      firstCharges: [],
      nextDueDate,
      deletedChargeIds: [],
      previousClosed: false,
    };

    if (mode === 'ASAAS_SUBSCRIPTION') {
      const subscription = await this.asaasGateway.createSubscription({
        customer: customer.asaasCustomerId,
        billingType: current.billingType,
        value: current.value,
        nextDueDate,
        cycle: current.cycle,
        description: `Assinatura ${current.plan.name}`,
        externalReference: move.newSubscriptionId,
        callback: { successUrl: successUrl() },
      });
      move.asaasSubscriptionId = subscription.id;
      // A primeira cobrança nasce junto e é gravada na mesma transação: o
      // aviso do Asaas pode chegar antes de a assinatura existir aqui.
      move.firstCharges = await this.asaasGateway
        .getAsaasSubscriptionPayments(subscription.id)
        .catch(() => []);
    }

    // A anterior deixa de cobrar: as futuras apagadas antes de encerrá-la.
    for (const charge of future) {
      await this.asaasGateway.deleteAsaasPayment(charge.id);
      move.deletedChargeIds.push(charge.id);
    }
    if (mode === 'ASAAS_SUBSCRIPTION') {
      await this.asaasGateway.cancelAsaasSubscription(
        current.asaasSubscriptionId,
      );
    }
    move.previousClosed = true;
    return move;
  }

  /** Tudo o que a transferência muda, numa transação só. */
  private async effectuate(input: {
    transfer: TransferRow;
    dto: AcceptOwnershipTransferDto;
    company: CompanyForOwnership;
    contractor: ResolvedContractor;
    record: CompanyRegistryRecord | null;
    terms: Awaited<ReturnType<ContractAcceptanceService['currentTerms']>>;
    current: CurrentSubscription | null;
    move: GatewayMove | null;
    before: Awaited<ReturnType<OwnershipService['view']>>;
    meta: RequestMeta;
    now: Date;
  }) {
    const { transfer, dto, company, contractor, current, move, now } = input;
    const previousCnpj = company.cnpj ? company.cnpj.replace(/\D/g, '') : null;
    const cnpjChanged = previousCnpj !== contractor.document;
    const passwordHash = await argon2.hash(dto.password);

    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`checkout:${company.id}`}))`;

        const { count } = await tx.ownershipTransfer.updateMany({
          where: { id: transfer.id, status: 'ACCEPTING' },
          data: {
            status: 'ACCEPTED',
            acceptedAt: now,
            previousCnpj,
            newCnpj: contractor.document,
          },
        });
        if (count === 0) {
          throw new ConflictException({
            code: 'TRANSFER_CHANGED',
            message:
              'A transferência mudou enquanto era aceita. Recarregue a página.',
          });
        }

        // 1. A conta nova, que entra como titular e administradora.
        const user = await tx.user.create({
          data: {
            email: transfer.targetEmail,
            name: dto.name.trim(),
            password: passwordHash,
            isActive: true,
          },
        });
        await tx.ownershipTransfer.update({
          where: { id: transfer.id },
          data: { acceptedByUserId: user.id },
        });
        const employee = await this.createOwnerEmployee(tx, {
          companyId: company.id,
          userId: user.id,
          name: user.name,
          cpf: contractor.representative?.isSessionUser
            ? contractor.representative.cpf
            : null,
        });

        // 2. Quem enviou sai: o colaborador fica, sem usuário; o histórico
        // dele continua no ambiente, no nome dele.
        const senderEmployees = await tx.employee.findMany({
          where: { companyId: company.id, userId: transfer.fromUserId },
          select: { id: true },
        });
        await tx.employee.updateMany({
          where: { companyId: company.id, userId: transfer.fromUserId },
          data: { userId: null },
        });
        for (const senderEmployee of senderEmployees) {
          await tx.employeeHistory.create({
            data: {
              employeeId: senderEmployee.id,
              action: 'USER_UNLINKED',
              description: `Usuário desvinculado pela transferência de titularidade para ${contractor.name}`,
              metadata: { transferId: transfer.id },
              createdBy: transfer.fromUserId,
              createdByName: transfer.fromUserName,
            },
          });
        }
        const otherLinks = await tx.employee.count({
          where: { userId: transfer.fromUserId },
        });
        if (otherLinks === 0) {
          // Sem outro ambiente, a conta não alcança mais nada: desativada, e o
          // login explica o motivo (SessionAccessService.transferredAccess).
          await tx.user.update({
            where: { id: transfer.fromUserId },
            data: { isActive: false },
          });
        }

        // 3. A empresa registrada passa a ser a de quem aceitou.
        await tx.company.update({
          where: { id: company.id },
          data: {
            ownerUserId: user.id,
            cnpj: contractor.document,
            legalName: contractor.name,
            ...(cnpjChanged
              ? {
                  name: contractor.tradeName || contractor.name,
                  stateRegistration: null,
                  municipalRegistration: null,
                  cnae: null,
                  accessKey: null,
                  partnerKey: null,
                  fiscalResetAt: now,
                }
              : {}),
          },
        });
        const fiscal = cnpjChanged
          ? await resetFiscalIdentity(tx, {
              companyId: company.id,
              previousCnpj,
              now,
            })
          : null;
        if (cnpjChanged && input.record) {
          await this.replaceMainAddress(tx, company.id, input.record.address);
        }

        // 4. A cobrança, no nome de quem recebeu.
        let subscriptionId = current?.id ?? null;
        if (move) {
          const moved = await this.transferSubscription(tx, {
            current: current!,
            move,
            transfer,
            contractor,
          });
          subscriptionId = moved.subscriptionId;
          await tx.user.update({
            where: { id: user.id },
            data: { customerId: moved.customerId },
          });
        }

        // 5. Os períodos de titularidade: fecha o de quem sai, abre o de quem
        // entra, na mesma data.
        const openPeriods = await tx.ownershipPeriod.count({
          where: { companyId: company.id, endedAt: null },
        });
        const leaving = input.before.current;
        if (openPeriods > 0) {
          await tx.ownershipPeriod.updateMany({
            where: { companyId: company.id, endedAt: null },
            data: {
              endedAt: now,
              transferId: transfer.id,
              ...(leaving
                ? {
                    holderName: leaving.holderName,
                    document: leaving.document,
                    email: leaving.email,
                  }
                : {}),
            },
          });
        } else if (leaving) {
          await tx.ownershipPeriod.create({
            data: {
              companyId: company.id,
              userId: transfer.fromUserId,
              holderName: leaving.holderName,
              document: leaving.document,
              email: leaving.email,
              startedAt: leaving.startedAt,
              endedAt: now,
              transferId: transfer.id,
            },
          });
        }
        await tx.ownershipPeriod.create({
          data: {
            companyId: company.id,
            userId: user.id,
            holderName: contractor.name,
            document: contractor.document,
            email: transfer.targetEmail,
            startedAt: now,
            transferId: transfer.id,
          },
        });

        // 6. O aceite dos Termos, com as partes nomeadas.
        await this.acceptance.record(tx, {
          terms: input.terms,
          companyId: company.id,
          subscriptionId,
          context: 'OWNERSHIP_TRANSFER',
          acceptedBy: { userId: user.id, name: user.name, email: user.email },
          contractor: {
            type: contractor.type,
            document: contractor.document,
            name: contractor.name,
            tradeName: contractor.tradeName,
            email: contractor.email,
          },
          representative: contractor.representative,
          registrySnapshot: contractor.registrySnapshot,
          ipAddress: input.meta.ip ?? null,
          userAgent: input.meta.userAgent ?? null,
        });

        await tx.companyHistory.create({
          data: {
            companyId: company.id,
            action: 'OWNERSHIP_TRANSFERRED',
            description: `Titularidade transferida para ${contractor.name}`,
            changes: {
              before: {
                ownerUserId: transfer.fromUserId,
                cnpj: previousCnpj,
                legalName: company.legalName,
                name: company.name,
              },
              after: {
                ownerUserId: user.id,
                cnpj: contractor.document,
                legalName: contractor.name,
              },
            },
            metadata: {
              transferId: transfer.id,
              employeeId: employee.id,
              subscriptionId,
              fiscalReset: fiscal,
            },
            createdBy: user.id,
            createdByName: user.name,
          },
        });

        return {
          companyName: cnpjChanged
            ? contractor.tradeName || contractor.name
            : company.name,
        };
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
  }

  /**
   * A assinatura em curso passa para o cliente de quem recebeu. Uma linha
   * nova, com o mesmo plano, complementos, ciclo, valor e vencimento: a
   * anterior fica encerrada (TRANSFERRED) com as cobranças que gerou, que
   * continuam no nome de quem as gerou. O que foi pago nela segue valendo na
   * nova (SubscriptionQuoteService.withTransferredPayments).
   */
  private async transferSubscription(
    tx: Prisma.TransactionClient,
    input: {
      current: CurrentSubscription;
      move: GatewayMove;
      transfer: TransferRow;
      contractor: ResolvedContractor;
    },
  ): Promise<{ subscriptionId: string; customerId: string }> {
    const { current, move, transfer } = input;
    const mode = billingModeOf(current);
    const installment = mode === 'ASAAS_INSTALLMENT';

    const customer = move.reusedCustomerId
      ? await tx.customer.update({
          where: { id: move.reusedCustomerId },
          data: {
            name: input.contractor.name,
            email: input.contractor.email,
          },
        })
      : await tx.customer.create({
          data: {
            name: input.contractor.name,
            email: input.contractor.email,
            document: input.contractor.document,
            asaasCustomerId: move.asaasCustomerId,
            companyId: current.companyId,
          },
        });

    await tx.subscription.create({
      data: {
        id: move.newSubscriptionId,
        companyId: current.companyId,
        customerId: customer.id,
        planId: current.planId,
        additionalUsers: current.additionalUsers,
        asaasSubscriptionId: installment
          ? `${INSTALLMENT_SUBSCRIPTION_PREFIX}${move.newSubscriptionId}`
          : move.asaasSubscriptionId!,
        // O parcelamento pago é de quem o pagou; o do ano seguinte, a
        // renovação cria no cliente novo.
        asaasInstallmentId: null,
        billingMode: mode,
        installmentCount: current.installmentCount,
        nextDueDate: move.nextDueDate,
        value: current.value,
        status: 'ACTIVE',
        billingType: current.billingType,
        cycle: current.cycle,
        contractedAt: current.contractedAt,
        recurringValueCents: current.recurringValueCents,
        pricingSnapshot: (current.pricingSnapshot ?? undefined) as any,
        previousSubscriptionId: current.id,
      },
    });

    // Módulos contratados e recursos concedidos (mantidos ao sair do plano ou
    // cortesia) seguem com a assinatura nova, com a origem de cada um.
    const features = await tx.subscriptionFeature.findMany({
      where: { subscriptionId: current.id, isActive: true },
      select: {
        featureId: true,
        price: true,
        grantSource: true,
        grantedBy: true,
        grantedByName: true,
        grantReason: true,
        expiresAt: true,
      },
    });
    if (features.length > 0) {
      await tx.subscriptionFeature.createMany({
        data: features.map((f) => ({
          subscriptionId: move.newSubscriptionId,
          featureId: f.featureId,
          price: f.price,
          isActive: true,
          grantSource: f.grantSource,
          grantedBy: f.grantedBy,
          grantedByName: f.grantedByName,
          grantReason: f.grantReason,
          expiresAt: f.expiresAt,
        })),
      });
    }

    await tx.subscription.update({
      where: { id: current.id },
      data: { status: 'CANCELED', endedReason: 'TRANSFERRED' },
    });
    // As futuras da anterior foram apagadas no Asaas.
    await tx.payment.updateMany({
      where: { subscriptionId: current.id, status: 'PENDING' },
      data: { status: 'CANCELED' },
    });

    for (const charge of move.firstCharges) {
      const exists = await tx.payment.findUnique({
        where: { asaasPaymentId: charge.id },
        select: { id: true },
      });
      if (exists) continue;
      const dueDate = fromAsaasDate(String(charge.dueDate));
      await tx.payment.create({
        data: {
          subscriptionId: move.newSubscriptionId,
          asaasPaymentId: charge.id,
          asaasCustomerId: move.asaasCustomerId,
          value: charge.value,
          dueDate,
          billingType: (charge.billingType ?? current.billingType) as any,
          description: charge.description,
          externalReference: charge.id,
          status: this.asaasGateway.mapAsaasPaymentStatus(charge.status),
          invoiceUrl: charge.invoiceUrl,
          bankSlipUrl: charge.bankSlipUrl,
          periodStart: dueDate,
          periodEnd: addCalendarCycle(
            dueDate,
            current.cycle === 'YEARLY' ? 'YEARLY' : 'MONTHLY',
          ),
        },
      });
    }

    await tx.subscriptionHistory.create({
      data: {
        subscriptionId: current.id,
        action: 'TRANSFERRED',
        description: `Assinatura transferida com o ambiente para ${input.contractor.name}`,
        changes: {
          before: { status: 'ACTIVE' },
          after: { status: 'CANCELED' },
        },
        metadata: {
          transferId: transfer.id,
          newSubscriptionId: move.newSubscriptionId,
          deletedCharges: move.deletedChargeIds,
        },
        createdBy: transfer.fromUserId,
        createdByName: transfer.fromUserName,
      },
    });
    await tx.subscriptionHistory.create({
      data: {
        subscriptionId: move.newSubscriptionId,
        action: 'TRANSFER_RECEIVED',
        description: `Assinatura recebida por transferência de titularidade, no nome de ${input.contractor.name}`,
        metadata: {
          transferId: transfer.id,
          fromSubscriptionId: current.id,
          asaasSubscriptionId: move.asaasSubscriptionId,
          nextDueDate: move.nextDueDate,
        },
        createdByName: input.contractor.name,
      },
    });

    return { subscriptionId: move.newSubscriptionId, customerId: customer.id };
  }

  /**
   * O colaborador de quem aceitou: no cargo de administrador da empresa, no
   * setor Administração, com o perfil de vendas do administrador — o mesmo
   * que o cadastro dá a quem cria a conta.
   */
  private async createOwnerEmployee(
    tx: Prisma.TransactionClient,
    input: {
      companyId: string;
      userId: string;
      name: string;
      cpf: string | null;
    },
  ) {
    const sector = await tx.companySector.findFirst({
      where: { companyId: input.companyId, name: 'Administração' },
      select: { id: true },
    });
    const role =
      (await tx.role.findFirst({
        where: { companyId: input.companyId, isAdmin: true, isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true },
      })) ??
      (await tx.role.create({
        data: {
          name: 'Admin',
          companyId: input.companyId,
          isAdmin: true,
          sectorId: sector?.id ?? null,
        },
        select: { id: true },
      }));
    const sellerProfile =
      (await tx.sellerProfile.findFirst({
        where: { companyId: input.companyId, name: 'Admin', isActive: true },
        select: { id: true },
      })) ??
      (await tx.sellerProfile.create({
        data: {
          name: 'Admin',
          companyId: input.companyId,
          commission: 0,
          maxDiscount: 100,
          minValue: 0,
          canApprovePreRegistration: true,
          canCancelSale: true,
        },
        select: { id: true },
      }));

    const employee = await tx.employee.create({
      data: {
        name: input.name,
        companyId: input.companyId,
        roleId: role.id,
        userId: input.userId,
        sectorId: sector?.id ?? null,
        sellerProfileId: sellerProfile.id,
        ...(input.cpf ? { cpf: input.cpf } : {}),
      },
    });

    const templates = await tx.payrollTemplate.findMany({
      where: { companyId: input.companyId },
    });
    for (const template of templates) {
      await tx.payrollSetup.create({
        data: {
          ...setupFromTemplate(template),
          company: { connect: { id: input.companyId } },
          employee: { connect: { id: employee.id } },
          payrollTemplate: { connect: { id: template.id } },
        },
      });
    }

    await tx.employeeHistory.create({
      data: {
        employeeId: employee.id,
        action: 'CREATE',
        description: `Titular da conta, pela transferência de titularidade`,
        createdBy: input.userId,
        createdByName: input.name,
      },
    });
    return employee;
  }

  /** O endereço principal passa a ser o do CNPJ novo, pela consulta pública. */
  private async replaceMainAddress(
    tx: Prisma.TransactionClient,
    companyId: string,
    address: CompanyRegistryRecord['address'],
  ) {
    const data = {
      street: address.street || null,
      number: address.number || null,
      complement: address.complement || null,
      neighborhood: address.neighborhood || null,
      zipcode: address.zipcode || null,
      city: address.city || null,
      state: address.state || null,
    };
    const main = await tx.address.findFirst({
      where: { companyId, type: 'Principal' },
      select: { id: true },
    });
    if (main) {
      await tx.address.update({ where: { id: main.id }, data });
    } else {
      await tx.address.create({
        data: {
          ...data,
          country: '1058',
          type: 'Principal',
          ownerType: 'COMPANY',
          companyId,
        },
      });
    }
  }

  /**
   * O cliente de cobrança de quem recebeu. O do mesmo documento é
   * reaproveitado (a mesma empresa, com outro titular); senão, um cliente
   * novo no Asaas — o do titular anterior segue intacto, com as cobranças que
   * gerou.
   */
  private async provisionCustomer(
    companyId: string,
    contractor: ResolvedContractor,
  ): Promise<{ asaasCustomerId: string; reusedCustomerId: string | null }> {
    const sameDocument = await this.prisma.customer.findFirst({
      where: { companyId, document: contractor.document },
    });
    if (!sameDocument) {
      const sameEmail = await this.prisma.customer.findFirst({
        where: { companyId, email: contractor.email },
        select: { id: true },
      });
      if (sameEmail) {
        throw new ConflictException({
          code: 'BILLING_EMAIL_IN_USE',
          message:
            'Este e-mail já é o de cobrança deste ambiente, em nome de outra empresa. Peça a quem enviou um convite para outro e-mail.',
        });
      }
    }

    const data = {
      name: contractor.name,
      cpfCnpj: contractor.document,
      email: contractor.email,
    };
    try {
      if (sameDocument?.asaasCustomerId?.startsWith('cus_')) {
        await this.asaasGateway.updateAsaasCustomer(
          sameDocument.asaasCustomerId,
          data,
        );
        return {
          asaasCustomerId: sameDocument.asaasCustomerId,
          reusedCustomerId: sameDocument.id,
        };
      }
      const created = await this.asaasGateway.createAsaasCustomer({
        ...data,
        externalReference: companyId,
      });
      if (sameDocument) {
        // A linha do documento existe, mas sem cliente no Asaas.
        await this.prisma.customer.update({
          where: { id: sameDocument.id },
          data: { asaasCustomerId: created.id },
        });
      }
      return {
        asaasCustomerId: created.id,
        reusedCustomerId: sameDocument?.id ?? null,
      };
    } catch (error) {
      throw new BadRequestException({
        code: 'CUSTOMER_REJECTED',
        message:
          error.message || 'O meio de pagamento recusou os dados da empresa.',
      });
    }
  }

  /**
   * Desfaz o que o aceite fez no Asaas e devolve a transferência a pendente.
   * Com a anterior já encerrada, desfazer não a traz de volta: precisa de
   * gente.
   */
  private async undo(transfer: TransferRow, move: GatewayMove | null, error) {
    if (move?.previousClosed) {
      this.logger.error(
        `RECONCILIAR: a cobrança da empresa ${transfer.companyId} foi encerrada no Asaas pela transferência ${transfer.id}, que não foi registrada (cobranças apagadas: ${move.deletedChargeIds.join(', ') || 'nenhuma'}): ${error?.message}`,
      );
    } else if (move?.deletedChargeIds.length) {
      this.logger.error(
        `RECONCILIAR: transferência ${transfer.id} não concluída; as cobranças ${move.deletedChargeIds.join(', ')} da assinatura em curso foram apagadas no Asaas: ${error?.message}`,
      );
    }
    if (move?.asaasSubscriptionId) {
      await this.asaasGateway
        .cancelAsaasSubscription(move.asaasSubscriptionId)
        .catch((undoError) =>
          this.logger.error(
            `RECONCILIAR: a assinatura ${move.asaasSubscriptionId} ficou aberta no Asaas após falha na transferência ${transfer.id}: ${undoError.message}`,
          ),
        );
    }
    await this.prisma.ownershipTransfer
      .updateMany({
        where: { id: transfer.id, status: 'ACCEPTING' },
        data: { status: 'PENDING' },
      })
      .catch((releaseError) =>
        this.logger.error(
          `Transferência ${transfer.id} ficou reservada após falha: ${releaseError.message}`,
        ),
      );
  }

  /** Reserva o aceite; uma reserva que caiu no meio vence e é retomada. */
  private async claim(transferId: string, now: Date) {
    const { count } = await this.prisma.ownershipTransfer.updateMany({
      where: {
        id: transferId,
        OR: [
          { status: 'PENDING' },
          {
            status: 'ACCEPTING',
            updatedAt: { lt: new Date(now.getTime() - ACCEPTANCE_LEASE_MS) },
          },
        ],
      },
      data: { status: 'ACCEPTING' },
    });
    if (count === 0) {
      throw new ConflictException({
        code: 'TRANSFER_IN_PROGRESS',
        message:
          'Esta transferência já está sendo aceita. Aguarde alguns instantes e recarregue a página.',
      });
    }
  }

  private async notifySender(
    transfer: TransferRow,
    newHolderName: string,
    now: Date,
  ) {
    const sender = await this.prisma.user.findUnique({
      where: { id: transfer.fromUserId },
      select: { name: true, email: true },
    });
    if (!sender) return;
    await this.mailer
      .sendMail({
        to: sender.email,
        subject: `O ambiente ${transfer.companyName} foi transferido`,
        template: 'ownership-transfer-completed',
        context: {
          name: sender.name,
          companyName: transfer.companyName,
          newHolderName,
          acceptedAt: now.toLocaleDateString('pt-BR', {
            timeZone: 'America/Sao_Paulo',
          }),
        },
      })
      .catch((error) =>
        this.logger.error(
          `Falha ao avisar ${sender.email} da transferência ${transfer.id}: ${error.message}`,
        ),
      );
  }

  private async findByToken(token: string) {
    if (!token) return null;
    return this.prisma.ownershipTransfer.findUnique({
      where: { tokenHash: hashInviteToken(token) },
    });
  }

  /** A transferência do convite, se ainda pendente; senão, o motivo. */
  private async pendingTransfer(token: string, now: Date) {
    const transfer = await this.findByToken(token);
    if (!transfer) {
      throw new GoneException({
        code: 'INVITE_INVALID',
        message: INVALID_INVITE_MESSAGE,
      });
    }
    const state = transferStateOf(transfer, now);
    if (state !== 'PENDING') {
      throw new GoneException({
        code: `TRANSFER_${state}`,
        message: INVITE_LINK_MESSAGE[state],
      });
    }
    return transfer;
  }

  private async emailHasAccount(email: string): Promise<boolean> {
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    });
    return !!user;
  }

  /**
   * CNPJ que já tem ambiente na Atrupe: o de outra empresa, ou o de quem
   * contratou por outra empresa. Comparado só pelos dígitos, porque cadastros
   * antigos gravaram o CNPJ formatado.
   */
  private async cnpjInUse(cnpj: string, companyId: string): Promise<boolean> {
    const digits = String(cnpj ?? '').replace(/\D/g, '');
    if (!digits) return false;
    const companies = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "companies"
      WHERE "id" <> ${companyId}
        AND regexp_replace(COALESCE("cnpj", ''), '[^0-9]', '', 'g') = ${digits}
      LIMIT 1`;
    if (companies.length > 0) return true;
    const customer = await this.prisma.customer.findFirst({
      where: {
        document: digits,
        companyId: { not: companyId },
        asaasCustomerId: { startsWith: 'cus_' },
      },
      select: { id: true },
    });
    return !!customer;
  }
}

function staleTransfer() {
  return {
    code: 'TRANSFER_STALE',
    message:
      'A titularidade deste ambiente mudou depois do envio do convite. Peça um novo convite a quem responde por ele hoje.',
  };
}
