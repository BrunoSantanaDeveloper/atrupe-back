import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { AsaasGatewayService } from '../asaas-gateway.service';
import { SubscriptionQuoteService } from '../pricing/subscription-quote.service';
import {
  ComplementsChange,
  computeComplementsChange,
  MAX_ADDITIONAL_USERS,
} from '../pricing/pricing.engine';
import { ComplementsDto, ComplementsQuoteDto } from '../dto/checkout.dto';
import {
  FREE_LIMIT_KEY,
  OFFER_RATIO,
  storageSummary,
  usedBytesOf,
} from '../../production/storage/production-files.service';
import {
  assertSingleStorageTier,
  formatBytes,
  isStorageTier,
} from '../pricing/storage-tiers';
import { ContractAcceptanceService } from './contract-acceptance.service';
import { CompanySessionService } from './company-session.service';
import { RequestMeta } from './checkout.service';
import {
  assertCanContract,
  assertPrincipalAdmin,
  assertTermsAccepted,
  ContractingUser,
  contractorOnFile,
  IN_FLIGHT_WINDOW_MS,
  representativeOnFile,
} from './contracting-steps';

/** Por que os complementos não podem ser alterados agora. */
export type ComplementsRestriction =
  | 'OPEN_CHARGE'
  | 'ANNUAL_CYCLE'
  | 'NOT_BILLED_BY_GATEWAY';

type BillingContext = Awaited<
  ReturnType<SubscriptionQuoteService['getBillingContext']>
>;

interface ChangeRequest {
  addModules: string[];
  removeModules: string[];
  /** Quantos usuários adicionais a assinatura passa a ter. */
  additionalUsers?: number;
}

interface Actor {
  id: string;
  name: string;
  email: string;
}

/** O que foi alterado no Asaas, para desfazer se o registro local falhar. */
interface GatewayChange {
  asaasSubscriptionId: string;
  previousValue: number;
  value: number;
  renewals: { id: string; previous: number; value: number }[];
}

const SUBSCRIPTION_INCLUDE = {
  plan: {
    include: {
      // Só o que o plano inclui hoje: o superadmin liga e desliga no painel.
      planFeatures: { where: { isActive: true }, include: { feature: true } },
    },
  },
  subscriptionFeatures: { include: { feature: true } },
  customer: true,
} satisfies Prisma.SubscriptionInclude;

type LoadedSubscription = Prisma.SubscriptionGetPayload<{
  include: typeof SUBSCRIPTION_INCLUDE;
}>;

type Prepared = Awaited<ReturnType<ComplementsService['prepare']>>;

/**
 * Complementos (módulos e usuários adicionais) numa assinatura em curso.
 *
 * Decisão de produto: o complemento é liberado na hora e entra na PRÓXIMA
 * mensalidade — sem cobrança proporcional agora e, por isso, sem cupom. As
 * renovações que o Asaas já gerou passam a incluí-lo também: a "próxima
 * mensalidade" pode já existir, e deixá-la com o valor antigo daria um ciclo
 * inteiro de graça.
 *
 * A base é a renovação atual da assinatura, não o preço de tabela do plano:
 * incluir um módulo não reprecifica o plano nem apaga um desconto que a
 * assinatura já tem.
 *
 * Tudo acontece sob a trava da empresa, a mesma da contratação: duas
 * alterações simultâneas somariam o mesmo complemento duas vezes no Asaas. O
 * Asaas é alterado antes do banco e desfeito se o banco falhar — a assinatura
 * nunca fica cobrando por um complemento que não foi registrado, nem liberando
 * um que não está sendo cobrado.
 */
@Injectable()
export class ComplementsService {
  private readonly logger = new Logger(ComplementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly asaasGateway: AsaasGatewayService,
    private readonly quoteService: SubscriptionQuoteService,
    private readonly acceptance: ContractAcceptanceService,
    private readonly session: CompanySessionService,
  ) {}

  /** O que está contratado hoje: a base da evolução e dos complementos. */
  async current(companyId: string, now: Date = new Date()) {
    this.assertCompany(companyId);
    const ctx = await this.quoteService.getBillingContext(companyId, now);
    if (!ctx.current) {
      return { intent: ctx.intent, restriction: null, subscription: null };
    }

    const [sub, catalog, lastAcceptance, terms] = await Promise.all([
      this.loadSubscription(ctx.current.id),
      this.prisma.feature.findMany({
        where: { isActive: true, price: { gt: 0 } },
        orderBy: [{ storageGb: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.contractAcceptance.findFirst({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
      }),
      this.acceptance.currentTerms().catch(() => null),
    ]);

    const contracted = this.contractedModules(sub);
    const unavailable = new Set([
      ...contracted.map((sf) => sf.feature.key),
      ...this.planFeatureKeys(sub),
    ]);
    // Os complementos que seguem para o plano novo numa evolução: os que ainda
    // são vendidos. Um recurso avulso antigo, que saiu de venda, não é
    // recontratável e travaria o orçamento.
    const sellable = contracted.filter(
      (sf) => sf.feature.isActive && sf.feature.price > 0,
    );
    // O espaço só é lido quando há faixa fora do catálogo para oferecer
    const storage = catalog.some((f) => !f.listed && isStorageTier(f))
      ? await this.storageState(companyId, sub)
      : null;

    return {
      intent: ctx.intent,
      restriction: this.restrictionOf(ctx, sub),
      subscription: {
        id: sub.id,
        planId: sub.planId,
        planName: sub.plan.name,
        planType: sub.plan.planType,
        cycle: sub.cycle,
        billingType: sub.billingType,
        recurringCents: this.recurringCents(sub),
        nextChargeDate: this.nextChargeDate(sub, ctx, now).toISOString(),
        additionalUsers: sub.additionalUsers,
        additionalUserPriceCents: Math.round(sub.plan.additionalUserPrice ?? 0),
        maxAdditionalUsers: MAX_ADDITIONAL_USERS,
        modules: sellable.map((sf) => ({
          key: sf.feature.key,
          name: sf.feature.name,
          priceCents: Math.round(sf.price ?? 0),
        })),
      },
      availableModules: catalog
        .filter((f) => !unavailable.has(f.key))
        // A faixa fora do catálogo (1 TB) aparece só para quem já tem uma
        // faixa e passou de 80% do espaço
        .filter(
          (f) =>
            f.listed !== false ||
            (isStorageTier(f) &&
              !!storage?.nearFull &&
              f.storageGb! > storage.tierGb),
        )
        .map((f) => ({
          key: f.key,
          name: f.name,
          description: f.description ?? null,
          priceCents: Math.round(f.price),
          storageGb: f.storageGb ?? null,
        })),
      contractor: contractorOnFile(lastAcceptance, sub.customer),
      terms: terms ? { id: terms.id, version: terms.version } : null,
    };
  }

  /** Quanto a mensalidade passa a ser, sem alterar nada. */
  async quote(
    companyId: string,
    dto: ComplementsQuoteDto,
    now: Date = new Date(),
  ) {
    this.assertCompany(companyId);
    const prepared = await this.prepare(companyId, this.requestOf(dto), now, {
      requireNoOpenCharge: true,
    });
    return this.quoteView(prepared);
  }

  /** Inclui complementos pela contratação nova, com o aceite dos Termos. */
  async apply(user: ContractingUser, dto: ComplementsDto, meta: RequestMeta) {
    assertCanContract(
      user,
      'Somente administradores da empresa podem contratar complementos.',
    );
    await assertPrincipalAdmin(
      this.prisma,
      user,
      'Somente o administrador principal da conta (Usuário nº 1) pode contratar complementos.',
    );
    const terms = await this.acceptance.currentTerms();
    assertTermsAccepted(dto.termsAcceptance, terms);
    const actor = await this.actor(user.userId);

    const result = await this.change(user, this.requestOf(dto), {
      requireNoOpenCharge: true,
      expectedRecurringCents: dto.expectedRecurringCents,
      actor,
      recordAcceptance: async (tx, prepared) => {
        const lastAcceptance = await tx.contractAcceptance.findFirst({
          where: { companyId: user.companyId },
          orderBy: { createdAt: 'desc' },
        });
        const contractor = contractorOnFile(
          lastAcceptance,
          prepared.sub.customer,
        )!;
        await this.acceptance.record(tx, {
          terms,
          companyId: user.companyId,
          subscriptionId: prepared.sub.id,
          context: 'COMPLEMENTS',
          acceptedBy: {
            userId: actor.id,
            name: actor.name,
            email: actor.email,
          },
          contractor: {
            type: contractor.type,
            document: contractor.document,
            name: contractor.name,
            tradeName: contractor.tradeName,
            email: contractor.email,
          },
          representative: representativeOnFile(lastAcceptance, user.userId),
          ipAddress: meta.ip ?? null,
          userAgent: meta.userAgent ?? null,
        });
      },
    });

    const session = await this.session
      .build(user.companyId, user.userId)
      .catch((error) => {
        this.logger.warn(
          `Sessão não montada após incluir complementos: ${error.message}`,
        );
        return null;
      });

    return { ...result.quote, subscriptionId: result.subscription.id, session };
  }

  /**
   * Retirar um módulo: o acesso sai na hora, e o valor sai das mensalidades
   * ainda não pagas. Com cobrança em aberto também é permitido — a vencida
   * não é alterada, só as renovações futuras.
   */
  async removeModule(
    user: ContractingUser,
    subscriptionId: string,
    moduleKey: string,
  ) {
    assertCanContract(
      user,
      'Somente administradores da empresa podem retirar módulos.',
    );
    await assertPrincipalAdmin(
      this.prisma,
      user,
      'Somente o administrador principal da conta (Usuário nº 1) pode retirar módulos.',
    );
    const actor = await this.actor(user.userId);
    const { subscription } = await this.change(
      user,
      { addModules: [], removeModules: [moduleKey] },
      { subscriptionId, requireNoOpenCharge: false, actor },
    );
    return subscription;
  }

  private async change(
    user: ContractingUser,
    request: ChangeRequest,
    options: {
      requireNoOpenCharge: boolean;
      actor: Actor;
      subscriptionId?: string;
      expectedRecurringCents?: number;
      recordAcceptance?: (
        tx: Prisma.TransactionClient,
        prepared: Prepared,
      ) => Promise<void>;
    },
  ) {
    const now = new Date();
    return this.withCompanyLock(user.companyId, async (tx) => {
      // Uma contratação ou evolução em curso vai substituir a assinatura: o
      // complemento incluído agora se perderia com ela.
      const inFlight = await tx.subscription.findFirst({
        where: {
          companyId: user.companyId,
          status: 'INACTIVE',
          asaasSubscriptionId: { startsWith: 'temp_' },
          createdAt: { gte: new Date(now.getTime() - IN_FLIGHT_WINDOW_MS) },
        },
        select: { id: true },
      });
      if (inFlight) {
        throw new ConflictException({
          code: 'CHECKOUT_IN_PROGRESS',
          message: 'Já existe uma contratação em andamento para esta empresa.',
        });
      }

      const prepared = await this.prepare(user.companyId, request, now, {
        requireNoOpenCharge: options.requireNoOpenCharge,
      });
      if (
        options.subscriptionId &&
        options.subscriptionId !== prepared.sub.id
      ) {
        throw new BadRequestException(
          'Esta não é a assinatura em curso da empresa.',
        );
      }
      if (
        options.expectedRecurringCents != null &&
        options.expectedRecurringCents !== prepared.change.recurringCents
      ) {
        throw new ConflictException({
          code: 'PRICE_CHANGED',
          message:
            'O valor mudou desde que o resumo foi exibido. Confira o novo total.',
          quote: this.quoteView(prepared),
        });
      }

      const gateway = await this.applyInGateway(prepared, now, {
        requireNoOpenCharge: options.requireNoOpenCharge,
      });
      try {
        const subscription = await this.recordLocally(
          tx,
          prepared,
          gateway,
          options.actor,
        );
        await options.recordAcceptance?.(tx, prepared);
        return { subscription, quote: this.quoteView(prepared) };
      } catch (error) {
        await this.revertInGateway(gateway);
        throw error;
      }
    });
  }

  private async prepare(
    companyId: string,
    request: ChangeRequest,
    now: Date,
    options: { requireNoOpenCharge: boolean },
  ) {
    const ctx = await this.quoteService.getBillingContext(companyId, now);
    if (options.requireNoOpenCharge && ctx.intent === 'REGULARIZATION') {
      throw new ConflictException({
        code: 'REGULARIZATION_REQUIRED',
        message:
          'Há uma cobrança em aberto. Regularize-a antes de contratar complementos.',
      });
    }
    const sub = ctx.current
      ? await this.loadSubscription(ctx.current.id)
      : null;
    if (!sub || sub.status !== 'ACTIVE') {
      throw new UnprocessableEntityException({
        code: 'NO_ACTIVE_SUBSCRIPTION',
        message: 'Contrate um plano para incluir complementos.',
      });
    }

    if (sub.cycle === 'YEARLY') {
      throw new UnprocessableEntityException({
        code: 'COMPLEMENTS_NOT_AVAILABLE',
        message:
          'A alteração de complementos no plano anual ainda não está disponível.',
      });
    }
    if (!sub.asaasSubscriptionId?.startsWith('sub_')) {
      throw new UnprocessableEntityException({
        code: 'COMPLEMENTS_NOT_AVAILABLE',
        message:
          'Esta assinatura não é cobrada pelo gateway de pagamento. Fale com a Atrupe para alterar os complementos.',
      });
    }

    const contracted = this.contractedModules(sub);
    const planKeys = new Set(this.planFeatureKeys(sub));

    const addKeys = [
      ...new Set(request.addModules.map((k) => k.trim()).filter(Boolean)),
    ];
    const features = addKeys.length
      ? await this.prisma.feature.findMany({
          where: { key: { in: addKeys }, isActive: true, price: { gt: 0 } },
        })
      : [];
    for (const key of addKeys) {
      const alreadyContracted = contracted.find((sf) => sf.feature.key === key);
      if (alreadyContracted) {
        throw new UnprocessableEntityException({
          code: 'MODULE_ALREADY_CONTRACTED',
          message: `O módulo ${alreadyContracted.feature.name} já está contratado.`,
        });
      }
      if (planKeys.has(key)) {
        throw new UnprocessableEntityException({
          code: 'MODULE_INCLUDED_IN_PLAN',
          message: 'Este módulo já faz parte do seu plano.',
        });
      }
      if (!features.some((f) => f.key === key)) {
        throw new BadRequestException({
          code: 'MODULE_NOT_AVAILABLE',
          message: `Módulo indisponível para contratação: ${key}.`,
        });
      }
    }

    const removing = [...new Set(request.removeModules)].map((key) => {
      if (planKeys.has(key)) {
        throw new UnprocessableEntityException({
          code: 'MODULE_INCLUDED_IN_PLAN',
          message: 'Este módulo faz parte do plano e não pode ser retirado.',
        });
      }
      const sf = contracted.find((c) => c.feature.key === key);
      if (!sf) {
        throw new UnprocessableEntityException({
          code: 'MODULE_NOT_CONTRACTED',
          message: 'Este módulo não está contratado.',
        });
      }
      return sf;
    });

    // A faixa de espaço é uma por assinatura: contratar outra troca a faixa,
    // e nenhuma troca deixa o espaço abaixo do que os arquivos já usam
    removing.push(
      ...(await this.storageTierChange(companyId, sub, features, removing)),
    );

    const targetUsers = request.additionalUsers ?? sub.additionalUsers;
    if (targetUsers < sub.additionalUsers) {
      throw new UnprocessableEntityException({
        code: 'USERS_REDUCTION_NOT_AVAILABLE',
        message: 'Para reduzir usuários adicionais, fale com a Atrupe.',
      });
    }
    if (
      features.length === 0 &&
      removing.length === 0 &&
      targetUsers === sub.additionalUsers
    ) {
      throw new UnprocessableEntityException({
        code: 'NOTHING_TO_CHANGE',
        message: 'Escolha um complemento para incluir.',
      });
    }

    const change = computeComplementsChange({
      currentRecurringCents: this.recurringCents(sub),
      cycle: 'MONTHLY',
      additionalUserPriceCents: Math.round(sub.plan.additionalUserPrice ?? 0),
      currentAdditionalUsers: sub.additionalUsers,
      targetAdditionalUsers: targetUsers,
      addedModules: features.map((f) => ({
        key: f.key,
        name: f.name,
        priceCents: Math.round(f.price),
      })),
      removedModules: removing.map((sf) => ({
        key: sf.feature.key,
        name: sf.feature.name,
        priceCents: Math.round(sf.price ?? 0),
      })),
    });

    return {
      sub,
      change,
      features,
      removing,
      contracted,
      targetUsers,
      nextChargeDate: this.nextChargeDate(sub, ctx, now),
    };
  }

  /**
   * Altera o valor no Asaas: a assinatura e as renovações que ele já gerou.
   * Só as renovações futuras — uma cobrança vencida não muda de valor por
   * causa de um complemento incluído ou retirado depois.
   */
  private async applyInGateway(
    prepared: Prepared,
    now: Date,
    options: { requireNoOpenCharge: boolean },
  ): Promise<GatewayChange> {
    const asaasId = prepared.sub.asaasSubscriptionId;
    const deltaCents = prepared.change.deltaCycleCents;

    // A conta parte do valor registrado; se o Asaas cobra outro, somar ou
    // tirar o complemento dele erraria a mensalidade — cobrando um módulo
    // que já não era cobrado, ou descontando um que nunca foi.
    let remote: Awaited<
      ReturnType<AsaasGatewayService['getAsaasSubscription']>
    >;
    try {
      remote = await this.asaasGateway.getAsaasSubscription(asaasId);
    } catch (error) {
      throw this.gatewayError(error, asaasId);
    }
    const remoteCents = remote ? Math.round(Number(remote.value) * 100) : null;
    if (
      !remote ||
      remote.deleted ||
      remote.status !== 'ACTIVE' ||
      Math.abs(remoteCents - prepared.change.currentRecurringCents) > 1
    ) {
      this.logger.error(
        `RECONCILIAR: complementos da assinatura ${prepared.sub.id} recusados — registrado ${prepared.change.currentRecurringCents} centavos, Asaas ${remote ? `${remoteCents} centavos (${remote.deleted ? 'removida' : remote.status})` : 'sem a assinatura'}.`,
      );
      throw new ConflictException({
        code: 'BILLING_OUT_OF_SYNC',
        message:
          'A cobrança desta assinatura está diferente do registrado. Fale com a Atrupe para ajustar antes de alterar os complementos.',
      });
    }

    let payments: any[];
    try {
      payments = await this.asaasGateway.getAsaasSubscriptionPayments(asaasId);
    } catch (error) {
      throw this.gatewayError(error, asaasId);
    }

    // Quem responde se há cobrança em aberto é o Asaas: o banco pode não ter
    // visto uma que venceu.
    const today = now.toISOString().slice(0, 10);
    if (
      options.requireNoOpenCharge &&
      payments.some(
        (p) =>
          p.status === 'OVERDUE' ||
          p.status === 'AWAITING_RISK_ANALYSIS' ||
          (p.status === 'PENDING' && String(p.dueDate) < today),
      )
    ) {
      throw new ConflictException({
        code: 'REGULARIZATION_REQUIRED',
        message:
          'Há uma cobrança em aberto. Regularize-a antes de contratar complementos.',
      });
    }
    const renewals = payments.filter(
      (p) => p.status === 'PENDING' && String(p.dueDate) >= today,
    );

    const applied: GatewayChange = {
      asaasSubscriptionId: asaasId,
      previousValue: prepared.change.currentRecurringCents / 100,
      value: prepared.change.recurringCents / 100,
      renewals: [],
    };

    try {
      await this.asaasGateway.updateAsaasSubscription(asaasId, {
        value: applied.value,
        updatePendingPayments: false,
      });
    } catch (error) {
      throw this.gatewayError(error, asaasId);
    }

    try {
      for (const renewal of renewals) {
        const previous = Number(renewal.value);
        const value = Math.round(previous * 100 + deltaCents) / 100;
        if (value <= 0) continue;
        await this.asaasGateway.updateAsaasPayment(renewal.id, { value });
        applied.renewals.push({ id: renewal.id, previous, value });
      }
    } catch (error) {
      await this.revertInGateway(applied);
      throw this.gatewayError(error, asaasId);
    }

    return applied;
  }

  private async revertInGateway(applied: GatewayChange) {
    try {
      for (const renewal of applied.renewals) {
        await this.asaasGateway.updateAsaasPayment(renewal.id, {
          value: renewal.previous,
        });
      }
      await this.asaasGateway.updateAsaasSubscription(
        applied.asaasSubscriptionId,
        { value: applied.previousValue, updatePendingPayments: false },
      );
    } catch (error) {
      this.logger.error(
        `RECONCILIAR: a assinatura ${applied.asaasSubscriptionId} ficou com R$ ${applied.value} no Asaas (antes R$ ${applied.previousValue}), mas a alteração de complementos não foi registrada: ${error.message}`,
      );
    }
  }

  private async recordLocally(
    tx: Prisma.TransactionClient,
    prepared: Prepared,
    gateway: GatewayChange,
    actor: Actor,
  ) {
    const { sub, change, features, removing, contracted, targetUsers } =
      prepared;

    for (const feature of features) {
      // O preço do módulo fica travado na assinatura, como já era.
      await tx.subscriptionFeature.upsert({
        where: {
          subscriptionId_featureId: {
            subscriptionId: sub.id,
            featureId: feature.id,
          },
        },
        create: {
          subscriptionId: sub.id,
          featureId: feature.id,
          price: feature.price,
          isActive: true,
        },
        update: { price: feature.price, isActive: true },
      });
    }
    for (const sf of removing) {
      await tx.subscriptionFeature.delete({ where: { id: sf.id } });
    }

    const subscription = await tx.subscription.update({
      where: { id: sub.id },
      data: {
        additionalUsers: targetUsers,
        value: change.recurringCents / 100,
        ...(sub.recurringValueCents != null
          ? { recurringValueCents: change.recurringCents }
          : {}),
      },
      include: { plan: true, customer: true },
    });

    for (const renewal of gateway.renewals) {
      await tx.payment.updateMany({
        where: { asaasPaymentId: renewal.id },
        data: { value: renewal.value },
      });
    }

    const before = contracted.map((sf) => sf.feature.key);
    const removed = removing.map((sf) => sf.feature.key);
    const after = [
      ...before.filter((key) => !removed.includes(key)),
      ...features.map((f) => f.key),
    ];
    const onlyRemoval =
      features.length === 0 && targetUsers === sub.additionalUsers;

    await tx.subscriptionHistory.create({
      data: {
        subscriptionId: sub.id,
        action: onlyRemoval ? 'MODULE_REMOVED' : 'COMPLEMENTS_ADDED',
        description: this.describe(prepared),
        changes: {
          before: {
            value: change.currentRecurringCents / 100,
            additionalUsers: sub.additionalUsers,
            modules: before,
          },
          after: {
            value: change.recurringCents / 100,
            additionalUsers: targetUsers,
            modules: after,
          },
        },
        metadata: {
          added: features.map((f) => f.key),
          removed,
          chargedNowCents: 0,
          nextChargeDate: prepared.nextChargeDate.toISOString(),
          renewalsUpdated: gateway.renewals.map((r) => r.id),
        },
        createdBy: actor.id,
        createdByName: actor.name,
      },
    });

    return subscription;
  }

  private describe(prepared: Prepared): string {
    const { sub, features, removing, targetUsers, nextChargeDate } = prepared;
    const when = nextChargeDate.toLocaleDateString('pt-BR', {
      timeZone: 'UTC',
    });
    const parts = features.map((f) => f.name);
    const newUsers = targetUsers - sub.additionalUsers;
    if (newUsers > 0) {
      parts.push(
        newUsers === 1
          ? '1 usuário adicional'
          : `${newUsers} usuários adicionais`,
      );
    }
    const texts: string[] = [];
    if (parts.length > 0) {
      texts.push(
        `Complementos incluídos: ${parts.join(', ')}. Cobrados a partir da mensalidade de ${when}.`,
      );
    }
    if (removing.length > 0) {
      texts.push(
        `Módulo ${removing.map((sf) => sf.feature.name).join(', ')} retirado.`,
      );
    }
    return texts.join(' ');
  }

  private quoteView(prepared: Prepared) {
    const change: ComplementsChange = prepared.change;
    return {
      ...change,
      additionalUsers: prepared.targetUsers,
      nextChargeDate: prepared.nextChargeDate.toISOString(),
    };
  }

  private restrictionOf(
    ctx: BillingContext,
    sub: LoadedSubscription,
  ): ComplementsRestriction | null {
    if (ctx.hasOpenCharge) return 'OPEN_CHARGE';
    if (sub.cycle === 'YEARLY') return 'ANNUAL_CYCLE';
    if (!sub.asaasSubscriptionId?.startsWith('sub_')) {
      return 'NOT_BILLED_BY_GATEWAY';
    }
    return null;
  }

  /**
   * A renovação atual, como o Asaas a cobra. `value` é o que acompanha o
   * Asaas (inclusive o desconto recorrente das assinaturas antigas).
   */
  private recurringCents(sub: LoadedSubscription): number {
    return Math.round(sub.value * 100);
  }

  /**
   * Quando o complemento começa a ser cobrado: a próxima renovação ainda não
   * paga — a que o Asaas já gerou ou, se não gerou, a do próximo vencimento.
   */
  private nextChargeDate(
    sub: LoadedSubscription,
    ctx: BillingContext,
    now: Date,
  ): Date {
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const upcoming = (ctx.current?.payments ?? [])
      .filter((p) => p.status === 'PENDING' && p.dueDate >= startOfToday)
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];
    return upcoming?.dueDate ?? sub.nextDueDate;
  }

  /**
   * Módulos contratados. Recurso concedido sem cobrança (mantido ao sair do
   * plano ou cortesia, `grantSource`) não é módulo: não aparece, não se
   * retira por aqui e não entra na conta.
   */
  /** A cota grátis do plano da assinatura, em MB (indefinido = partida). */
  private async freeMbOf(sub: LoadedSubscription) {
    const limit = await this.prisma.planLimit.findFirst({
      where: {
        planId: sub.planId,
        isActive: true,
        limit: { key: FREE_LIMIT_KEY },
      },
      select: { value: true },
    });
    return limit?.value;
  }

  /** A maior faixa entre o plano e os complementos indicados. */
  private tierGbOf(
    sub: LoadedSubscription,
    modules: { feature: { storageGb?: number | null } }[],
  ) {
    return Math.max(
      0,
      ...[...sub.plan.planFeatures, ...modules].map(
        (item) => item.feature.storageGb ?? 0,
      ),
    );
  }

  /** O espaço da empresa hoje, para oferecer a faixa seguinte. */
  private async storageState(companyId: string, sub: LoadedSubscription) {
    const tierGb = this.tierGbOf(sub, this.contractedModules(sub));
    const summary = storageSummary({
      usedBytes: await usedBytesOf(this.prisma, companyId),
      freeMb: await this.freeMbOf(sub),
      tier: tierGb ? { key: '', name: '', storageGb: tierGb } : null,
    });
    return {
      usedBytes: summary.usedBytes,
      quotaBytes: summary.quotaBytes,
      tierGb,
      nearFull:
        tierGb > 0 &&
        summary.quotaBytes !== null &&
        summary.usedBytes >= summary.quotaBytes * OFFER_RATIO,
    };
  }

  /**
   * A troca de faixa: incluir uma faixa retira a contratada; e o espaço que
   * resta (a faixa nova, ou só a cota grátis quando a faixa sai) precisa
   * caber os arquivos que a empresa já guarda.
   */
  private async storageTierChange(
    companyId: string,
    sub: LoadedSubscription,
    features: { storageGb?: number | null }[],
    removing: LoadedSubscription['subscriptionFeatures'],
  ) {
    assertSingleStorageTier(features);
    const contracted = this.contractedModules(sub);
    const adding = features.some(isStorageTier);
    const alsoRemove = adding
      ? contracted.filter(
          (sf) => isStorageTier(sf.feature) && !removing.includes(sf),
        )
      : [];
    const leaving = new Set(
      [...removing, ...alsoRemove].map((sf) => sf.feature.key),
    );
    if (!adding && !removing.some((sf) => isStorageTier(sf.feature))) {
      return alsoRemove;
    }
    const remaining = contracted.filter((sf) => !leaving.has(sf.feature.key));
    const tierGb = Math.max(
      this.tierGbOf(sub, remaining),
      ...features.map((f) => f.storageGb ?? 0),
    );
    const summary = storageSummary({
      usedBytes: await usedBytesOf(this.prisma, companyId),
      freeMb: await this.freeMbOf(sub),
      tier: tierGb ? { key: '', name: '', storageGb: tierGb } : null,
    });
    if (summary.quotaBytes !== null && summary.usedBytes > summary.quotaBytes) {
      throw new UnprocessableEntityException({
        code: 'STORAGE_IN_USE',
        message: `Os arquivos de produção ocupam ${formatBytes(summary.usedBytes)}, e o espaço passaria a ${formatBytes(summary.quotaBytes)}. Apague arquivos antes de trocar de faixa.`,
      });
    }
    return alsoRemove;
  }

  private contractedModules(sub: LoadedSubscription) {
    return sub.subscriptionFeatures.filter(
      (sf) => sf.isActive !== false && !!sf.feature?.key && !sf.grantSource,
    );
  }

  private planFeatureKeys(sub: LoadedSubscription): string[] {
    return (sub.plan.planFeatures ?? [])
      .filter((pf) => pf.isActive && pf.feature?.isActive !== false)
      .map((pf) => pf.feature?.key)
      .filter((key): key is string => !!key);
  }

  private loadSubscription(id: string) {
    return this.prisma.subscription.findUniqueOrThrow({
      where: { id },
      include: SUBSCRIPTION_INCLUDE,
    });
  }

  private requestOf(dto: ComplementsQuoteDto): ChangeRequest {
    return {
      addModules: dto.modules ?? [],
      removeModules: [],
      additionalUsers: dto.additionalUsers,
    };
  }

  private actor(userId: string): Promise<Actor> {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    });
  }

  private withCompanyLock<T>(
    companyId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    // A transação fica aberta enquanto o Asaas responde: é o que segura a
    // trava. Operação rara e curta; o prazo cobre o tempo limite do gateway.
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`checkout:${companyId}`}))`;
        return fn(tx);
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
  }

  private gatewayError(error: any, asaasSubscriptionId: string) {
    this.logger.error(
      `Alteração de complementos da assinatura ${asaasSubscriptionId} falhou no gateway: ${error?.message}`,
    );
    return new BadGatewayException({
      code: 'GATEWAY_ERROR',
      message:
        'Não foi possível atualizar a assinatura no gateway de pagamento. Nada foi alterado; tente novamente.',
    });
  }

  private assertCompany(companyId: string | undefined) {
    if (!companyId) {
      throw new BadRequestException(
        'Complementos disponíveis apenas para usuários de uma empresa.',
      );
    }
  }
}
