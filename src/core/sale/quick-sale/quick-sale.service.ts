import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from 'nestjs-prisma';
import { QuickSalePayment } from '@prisma/client';
import { PlanControlService } from '../../plan/plan-control.service';
import { QuotationService } from '../quotation/quotation.service';
import { QuotationFinancialService } from '../quotation/quotation-financial.service';
import { QuotationWorkflowService } from '../quotation/quotation-workflow.service';
import { QuickSaleSettingsDto } from './dto/quick-sale.dto';
import { ReceiptDto } from '../../financial/cash-control/dto/receipt-part.dto';
import {
  recordSaleReceipt,
  resolveParts,
  roundingOf,
} from '../../financial/cash-control/sale-receipt';
import {
  CashActor,
  MissingCashDay,
  actorOfUser,
} from '../../financial/cash-control/cash-ledger';
import {
  NOT_AT_CHECKOUT,
  QUICK_SALE_ALREADY_SENT,
  saleReference,
  saleTotalCents,
} from './quick-sale.rules';

const bad = (message: string): never => {
  throw new BadRequestException(message);
};

const ALL_METHODS = ['dinheiro', 'pix', 'cartao'];

export const QUICK_SALE_NOT_CONFIGURED =
  'Venda rápida ainda não configurada: escolha o cliente padrão e a série em Configurações › Vendas › Venda rápida';

/** Quanto a venda rápida sem item espera antes de sair da lista. */
const EMPTY_QUICK_SALE_TTL_HOURS = 12;

/** O arredondamento no balcão sem frente de caixa (FC-18): R$ 1,00. */
const DEFAULT_ROUNDING = { roundingType: 'VALUE' as const, roundingLimit: 100 };

type Settings = {
  enabled: boolean;
  payment: QuickSalePayment;
  cashMethods: string[];
  downPaymentRequired: boolean;
  downPaymentPercent: number;
  clientId: string;
  clientName: string;
  description: string;
  seriesId: string;
  serviceTypeId: string;
  responsibleId: string | null;
  roundingType: 'VALUE' | 'PERCENT';
  roundingLimit: number;
};

/** A situação da venda rápida no caixa (FC-11), em centavos. */
export type CashStatus = {
  quotationId: string;
  path: QuickSalePayment;
  sentAt: string;
  total: number;
  paid: number;
  delivered: boolean;
  cancelled: boolean;
  parts: { method: string; amount: number }[];
  /** O arredondamento no balcão e o troco do último recebimento (FC-16) */
  discount: number;
  change: number;
};

/**
 * A venda rápida (ALT-22, VR-1 a VR-5, FC-1, FC-11, FC-12): a configuração
 * da empresa, o orçamento criado direto com ela, o "Cobrar" na hora e a
 * situação no caixa que o vendedor acompanha.
 */
@Injectable()
export class QuickSaleService {
  private readonly logger = new Logger(QuickSaleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly planControl: PlanControlService,
    private readonly quotations: QuotationService,
    private readonly financial: QuotationFinancialService,
    private readonly workflow: QuotationWorkflowService,
  ) {}

  /**
   * A venda rápida nasce quando a tela abre (ALT-22): quem sai sem lançar
   * item deixa um registro vazio na lista. A tela o exclui ao sair, mas
   * fechar a aba não passa por ali. Toda madrugada, a venda rápida aberta,
   * sem item, que não foi ao caixa e tem mais de 12 horas sai da lista como
   * no "excluir" da tela, inativa (revisão de 23/10/2026).
   */
  @Cron('25 3 * * *', {
    name: 'quick-sale-empty-cleanup',
    timeZone: 'America/Sao_Paulo',
  })
  async cleanupEmpty(now = new Date()) {
    const limit = new Date(
      now.getTime() - EMPTY_QUICK_SALE_TTL_HOURS * 3_600_000,
    );
    try {
      const { count } = await this.prisma.quotation.updateMany({
        where: {
          quickSale: true,
          isActive: true,
          status: 'OPEN',
          createdAt: { lt: limit },
          quotationProduct: { none: {} },
          pendingSale: { is: null },
        },
        data: { isActive: false },
      });
      if (count) this.logger.log(`${count} vendas rápidas sem item retiradas`);
      return count;
    } catch (error) {
      this.logger.error(
        `Vendas rápidas sem item não retiradas: ${error?.message}`,
      );
      return 0;
    }
  }

  /** Quem age: o colaborador da sessão (CX-2). */
  actorOf(user: { userId?: string; companyId: string }) {
    return actorOfUser(this.prisma, user);
  }

  /* ---------------------------------------------------- configuração */

  /**
   * Os padrões de quem nunca salvou: a série padrão que não é de
   * treinamento, o atendimento "Venda Direta" e o cliente de balcão (um
   * "Consumidor", o "Cliente Exemplo" de toda conta nova, ou o primeiro).
   */
  private async defaults(companyId: string) {
    const [series, sources] = await Promise.all([
      this.prisma.saleSeries.findMany({
        where: { companyId, isActive: true },
        select: { id: true, isDefault: true, isTraining: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.contactSource.findMany({
        where: {
          OR: [{ companyId }, { companyId: null }],
          hiddenByCompanies: { none: { companyId } },
        },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    const serie =
      series.find((item) => item.isDefault && !item.isTraining) ??
      series.find((item) => item.isDefault) ??
      series.find((item) => !item.isTraining) ??
      series[0];
    const source =
      sources.find((item) => item.name.trim() === 'Venda Direta') ?? sources[0];
    let client: { id: string; name: string } | null = null;
    for (const name of ['Consumidor', 'Cliente Exemplo']) {
      client = await this.prisma.client.findFirst({
        where: {
          companyId,
          status: { not: 'INACTIVE' },
          name: { contains: name, mode: 'insensitive' },
        },
        select: { id: true, name: true },
        orderBy: { createdAt: 'asc' },
      });
      if (client) break;
    }
    client ??= await this.prisma.client.findFirst({
      where: { companyId, status: { not: 'INACTIVE' } },
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    });
    return {
      seriesId: serie?.id ?? '',
      serviceTypeId: source?.id ?? '',
      clientId: client?.id ?? '',
      clientName: client?.name ?? '',
    };
  }

  async settings(companyId: string): Promise<Settings> {
    const saved = await this.prisma.quickSaleSettings.findUnique({
      where: { companyId },
    });
    // O que a empresa não escolheu vem do padrão: o atalho já cria o
    // orçamento na primeira vez
    const fallback =
      saved?.clientId && saved?.seriesId
        ? null
        : await this.defaults(companyId);
    const clientId = saved?.clientId || fallback?.clientId || '';
    const clientName =
      saved?.clientId && saved.clientId === clientId
        ? ((
            await this.prisma.client.findFirst({
              where: { id: clientId, companyId },
              select: { name: true },
            })
          )?.name ?? '')
        : (fallback?.clientName ?? '');
    return {
      enabled: saved?.enabled ?? true,
      payment: saved?.payment ?? 'CASH_ONLY',
      cashMethods: saved?.cashMethods ?? ALL_METHODS,
      downPaymentRequired: saved?.downPaymentRequired ?? false,
      downPaymentPercent: saved?.downPaymentPercent ?? 50,
      clientId,
      clientName,
      description: saved?.description ?? '',
      seriesId: saved?.seriesId || fallback?.seriesId || '',
      serviceTypeId: saved?.serviceTypeId || fallback?.serviceTypeId || '',
      responsibleId: saved?.responsibleId ?? null,
      // O arredondamento no balcão da frente padrão (FC-18), para o "Cobrar"
      ...(await this.rounding(companyId)),
    };
  }

  async saveSettings(companyId: string, dto: QuickSaleSettingsDto) {
    const clientId = dto.clientId || null;
    const seriesId = dto.seriesId || null;
    const serviceTypeId = dto.serviceTypeId || null;
    const responsibleId = dto.responsibleId || null;
    if (dto.enabled && !clientId) {
      bad('Escolha o cliente padrão da venda rápida');
    }
    if (
      dto.downPaymentRequired &&
      (dto.downPaymentPercent < 1 || dto.downPaymentPercent > 100)
    ) {
      bad('O sinal precisa ser um percentual entre 1% e 100%');
    }
    // `payment` e `cashMethods` ficam gravados por compatibilidade, mas não
    // decidem mais nada: o recebimento é da série (VR-5, 26/10/2026)
    // Cadastros da empresa da sessão
    if (clientId) {
      const client = await this.prisma.client.findFirst({
        where: { id: clientId, companyId },
        select: { id: true },
      });
      if (!client) bad('Cliente não encontrado');
    }
    if (seriesId) {
      const series = await this.prisma.saleSeries.findFirst({
        where: { id: seriesId, companyId, isActive: true },
        select: { id: true },
      });
      if (!series) bad('Série não encontrada');
    }
    if (serviceTypeId) {
      const source = await this.prisma.contactSource.findFirst({
        where: {
          id: serviceTypeId,
          OR: [{ companyId }, { companyId: null }],
        },
        select: { id: true },
      });
      if (!source) bad('Atendimento não encontrado');
    }
    if (responsibleId) {
      const contact = await this.prisma.contact.findFirst({
        where: { id: responsibleId, clientId: clientId ?? undefined },
        select: { id: true },
      });
      if (!contact || !clientId) {
        bad('O responsável precisa ser um contato do cliente padrão');
      }
    }
    const data = {
      enabled: dto.enabled,
      payment: dto.payment ?? 'CASH_ONLY',
      cashMethods: [...new Set(dto.cashMethods ?? ALL_METHODS)],
      downPaymentRequired: dto.downPaymentRequired,
      downPaymentPercent: dto.downPaymentPercent,
      clientId,
      description: dto.description?.trim() ?? '',
      seriesId,
      serviceTypeId,
      responsibleId,
    };
    await this.prisma.quickSaleSettings.upsert({
      where: { companyId },
      create: { companyId, ...data },
      update: data,
    });
    return this.settings(companyId);
  }

  /* -------------------------------------------------------- orçamento */

  /**
   * Cria o orçamento de venda rápida com os padrões (ALT-22, VR-1, VR-2): o
   * vendedor é o colaborador da sessão.
   */
  async create(user: { userId: string; companyId: string }) {
    const settings = await this.settings(user.companyId);
    if (!settings.enabled) {
      bad(
        'A venda rápida está desligada em Configurações › Vendas › Venda rápida',
      );
    }
    if (!settings.clientId || !settings.seriesId)
      bad(QUICK_SALE_NOT_CONFIGURED);
    const seller = await this.prisma.employee.findFirst({
      where: { userId: user.userId, companyId: user.companyId },
      select: { id: true },
    });
    if (!seller) {
      bad(
        'Seu usuário não tem colaborador vinculado: a venda rápida precisa de um vendedor',
      );
    }
    return this.quotations.create(
      {
        companyId: user.companyId,
        sellerId: seller.id,
        clientId: settings.clientId,
        contactId: settings.responsibleId ?? undefined,
        seriesId: settings.seriesId,
        contactSourceId: settings.serviceTypeId || null,
        description: settings.description || undefined,
        quickSale: true,
      } as Parameters<QuotationService['create']>[0],
      user.userId,
      user.companyId,
    );
  }

  /**
   * O arredondamento no balcão (FC-18): o da frente de caixa padrão, em
   * valor ou em percentual.
   */
  private async rounding(companyId: string) {
    const front = await this.prisma.cashFront.findFirst({
      where: { companyId, isActive: true },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      select: { roundingType: true, roundingLimit: true },
    });
    return front ?? DEFAULT_ROUNDING;
  }

  /**
   * Cobrar na hora, só à vista (VR-5): recebe as partes e aprova na mesma
   * transação. O dinheiro entra realizado na conta Caixa; PIX e cartão como
   * previsão na conta padrão da forma, pelo valor cheio (FC-10).
   */
  async charge(
    quotationId: string,
    user: { userId: string; companyId: string },
    dto: ReceiptDto,
    actor: CashActor,
  ) {
    // O recebimento é da série (VR-10, 14/11/2026): só o orçamento cuja
    // série cobra na venda é cobrado à vista pelo vendedor, em dinheiro, PIX
    // ou cartão. A série da frente de caixa só envia ao caixa
    const quotation = await this.prisma.quotation.findFirst({
      where: { id: quotationId, companyId: user.companyId },
      select: {
        id: true,
        status: true,
        quickSale: true,
        pendingSale: { select: { id: true } },
        quotationPayment: { select: { billing: true } },
      },
    });
    if (!quotation) throw new NotFoundException('Orçamento não encontrado');
    if (quotation.quotationPayment?.billing !== 'ON_SALE') {
      bad(NOT_AT_CHECKOUT);
    }
    if (quotation.pendingSale)
      throw new ConflictException(QUICK_SALE_ALREADY_SENT);
    if (quotation.status !== 'OPEN') bad('A venda já não está aberta');
    const discount = dto.discount ?? 0;
    const rounding = await this.rounding(user.companyId);
    const date = new Date();
    let state: CashStatus | null = null;
    try {
      await this.workflow.approve(quotationId, user.userId, undefined, {
        charge: async (tx, approved) => {
          const total = saleTotalCents(approved);
          if (discount > roundingOf(rounding, total)) {
            bad('Arredondamento acima do limite do balcão');
          }
          const paid = dto.parts.reduce((sum, part) => sum + part.amount, 0);
          if (paid + discount !== total) {
            bad(
              'O "Cobrar" recebe pelo total. Para parcelar ou cobrar depois, use uma série que fatura no pedido',
            );
          }
          const parts = await resolveParts(tx, user.companyId, dto.parts, {
            cashNeedsAccount: true,
          });
          const categories = await this.financial.findSalesCategories(
            approved.companyId,
            tx,
          );
          await recordSaleReceipt(tx, {
            companyId: approved.companyId,
            quotationId,
            clientId: approved.clientId,
            reference: saleReference(approved),
            total: total - discount,
            parts,
            mode: 'direct',
            date,
            actor,
            ...categories,
          });
          const sale = await tx.pendingSale.create({
            data: {
              companyId: approved.companyId,
              quotationId,
              kind: quotation.quickSale ? 'QUICK' : 'QUOTATION',
              path: 'CASH_ONLY',
              total: total - discount,
              paid,
              discount,
              change: dto.change ?? 0,
              delivered: true,
              goesToCash: false,
              approvedAt: approved.approvedAt ?? date,
              sentAt: date,
              parts,
            },
          });
          state = this.statusOf(sale);
        },
      });
    } catch (error) {
      if (error instanceof MissingCashDay) {
        bad(`${error.message}: o dinheiro da venda entra no caixa do dia`);
      }
      throw error;
    }
    return state as CashStatus | null;
  }

  private statusOf(sale: {
    quotationId: string;
    path: QuickSalePayment;
    sentAt: Date;
    total: number;
    paid: number;
    delivered: boolean;
    cancelled: boolean;
    parts: unknown;
    discount: number;
    change: number;
  }): CashStatus {
    const parts = Array.isArray(sale.parts)
      ? (sale.parts as { method: string; amount: number }[])
      : [];
    return {
      quotationId: sale.quotationId,
      path: sale.path,
      sentAt: sale.sentAt.toISOString(),
      total: sale.total,
      paid: sale.paid,
      delivered: sale.delivered,
      cancelled: sale.cancelled,
      discount: sale.discount,
      change: sale.change,
      parts: parts.map((part) => ({
        method: part.method,
        amount: part.amount,
      })),
    };
  }

  /** A situação no caixa, ou nula quando ainda não foi enviada nem cobrada. */
  async cashStatus(quotationId: string, companyId: string) {
    const quotation = await this.prisma.quotation.findFirst({
      where: { id: quotationId, companyId },
      select: { pendingSale: true },
    });
    if (!quotation) throw new NotFoundException('Orçamento não encontrado');
    return quotation.pendingSale ? this.statusOf(quotation.pendingSale) : null;
  }
}
