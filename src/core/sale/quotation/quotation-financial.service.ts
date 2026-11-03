import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { Prisma, PaymentStatus } from '@prisma/client';
import { add } from 'date-fns';
import {
  QuotationForFinancial,
  QuotationCommission,
  QuotationDeliveryInfo,
  QuotationInstallment,
} from './quotation-financial.types';

/**
 * QuotationFinancialService
 * Responsável por geração de receivables, payables, comissões e categorias financeiras.
 */
@Injectable()
export class QuotationFinancialService {
  private readonly logger = new Logger(QuotationFinancialService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Gera contas a receber a partir do orçamento
   */
  async generateReceivableFromQuotation(
    quotation: QuotationForFinancial,
    prisma: Prisma.TransactionClient,
  ) {
    const quotationInstallments =
      quotation.quotationPayment.quotationInstallment;
    const downPayment = quotation.quotationPayment.downPayment;
    const downPaymentDueDate = quotation.quotationPayment.downPaymentDueDate;
    const downPaymentadditionalFee =
      quotation.quotationPayment.downPaymentAdditionalFee;
    const paymentCondition =
      quotation?.quotationPayment?.downPaymentConditionId ?? null;
    if (!quotationInstallments || quotationInstallments.length === 0) {
      throw new BadRequestException(
        'Não há parcelas para gerar contas a receber.',
      );
    }

    // A parcela da entrada usa esta data e `dueDate` e NOT NULL. Sem a
    // guarda, o Prisma recusava o create no meio da geracao e a venda
    // ficava aprovada sem nenhum lancamento.
    if (downPayment > 0 && !downPaymentDueDate) {
      throw new BadRequestException(
        'A entrada deste orçamento está sem data de vencimento. Edite as condições de pagamento e informe a data antes de aprovar.',
      );
    }

    // -----------------------------------------------------------------------
    // Validação: verificar se as parcelas estão sincronizadas com o totalValue
    // atual do orçamento. Caso contrário, recalcular proporcionalmente.
    // Isso previne inconsistências quando itens são alterados antes do
    // faturamento sem que as condições de pagamento sejam reabertas/salvas.
    // -----------------------------------------------------------------------
    const deliveryValue = quotation.deliveryInfo?.value || 0;
    const discountTotal = quotation.quotationPayment.discountTotal || 0;
    const commissionTotal =
      quotation.quotationPayment.commission?.type === 'ADD'
        ? quotation.quotationPayment.commission.totalCommission || 0
        : 0;
    const expectedTotal =
      quotation.totalValue +
      deliveryValue -
      discountTotal +
      commissionTotal -
      (quotation.quotationPayment.downPayment || 0);
    const installmentsBaseSum = quotationInstallments.reduce(
      (sum: number, inst: QuotationInstallment) => sum + inst.value,
      0,
    );
    const installmentsFeeSum = quotationInstallments.reduce(
      (sum: number, inst: QuotationInstallment) =>
        sum + (inst.additionalFee || 0),
      0,
    );

    let effectiveInstallments = quotationInstallments;
    if (
      expectedTotal > 0 &&
      installmentsFeeSum === 0 &&
      Math.abs(installmentsBaseSum - expectedTotal) > 1
    ) {
      this.logger.warn(
        `[FINANCIAL] Parcelas desatualizadas no orçamento ${quotation.id}: ` +
          `soma=${installmentsBaseSum}, esperado=${expectedTotal}. ` +
          `Recalculando proporcionalmente antes de gerar o receivable.`,
      );
      const ratio = expectedTotal / installmentsBaseSum;
      effectiveInstallments = quotationInstallments.map(
        (inst: QuotationInstallment) => ({
          ...inst,
          value: inst.value * ratio,
        }),
      );
    }

    // Calcular o valor total das parcelas (usando efetiveInstallments)
    const totalAmount = effectiveInstallments.reduce(
      (sum: number, installment: QuotationInstallment) =>
        sum + installment.value + (installment.additionalFee || 0),
      0,
    );
    const totalValue = effectiveInstallments.reduce(
      (sum: number, installment: QuotationInstallment) =>
        sum + installment.value,
      0,
    );
    const mainAdditionalFee = effectiveInstallments.reduce(
      (sum: number, installment: QuotationInstallment) =>
        sum + (installment.additionalFee || 0),
      0,
    );

    try {
      // Buscar natureza e categoria para receitas de venda
      const { natureId, subCategoryId } = await this.findSalesCategories(
        quotation.companyId,
        prisma,
      );

      // Buscar conta bancária padrão da empresa
      const defaultBankAccount = await prisma.bankAccount.findFirst({
        where: {
          companyId: quotation.companyId,
          isActive: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
      });
      const defaultBankAccountId = defaultBankAccount?.id || null;

      // Criar entrada se houver
      if (downPayment && downPayment > 0) {
        const receivableDownPayment = await prisma.receivable.create({
          data: {
            referenceDate: new Date(),
            description: `Entrada da venda ${quotation.quotationNumber}-${quotation.series.code} - ${quotation.description || ''}`,
            notes: quotation.quotationPayment.description || '',
            totalAmount: downPayment,
            totalValue: downPayment,
            mainAdditionalFee: downPaymentadditionalFee || 0,
            installmentQty: 1,
            status: PaymentStatus.PENDING as PaymentStatus,
            clientId: quotation.clientId,
            companyId: quotation.companyId,
            natureId: natureId,
            subCategoryId: subCategoryId,
            quotationId: quotation.id,
            financialType: 'DOWN_PAYMENT',
          },
        });
        await prisma.receivableInstallment.create({
          data: {
            receivableId: receivableDownPayment.id,
            installmentNumber: 1,
            dueDate: downPaymentDueDate,
            amount: downPayment,
            additionalFee: downPaymentadditionalFee || 0,
            paymentConditionId: paymentCondition,
            bankAccountId: defaultBankAccountId,
            status: PaymentStatus.PENDING as PaymentStatus,
            paidDate: null,
          },
        });
      }

      // Criar o Receivable principal
      const receivable = await prisma.receivable.create({
        data: {
          referenceDate: new Date(),
          description: `Venda ${quotation.quotationNumber}-${quotation.series.code} - ${quotation.description || ''}`,
          notes: quotation.quotationPayment.description || '',
          totalAmount,
          totalValue,
          mainAdditionalFee,
          installmentQty: quotationInstallments.length,
          status: PaymentStatus.PENDING as PaymentStatus,
          clientId: quotation.clientId,
          companyId: quotation.companyId,
          natureId: natureId,
          subCategoryId: subCategoryId,
          quotationId: quotation.id,
          financialType: 'MAIN',
        },
      });

      // Preparar e criar as parcelas (usar effectiveInstallments para garantir
      // que valores recalculados sejam persistidos, não valores stale do DB)
      const installments = effectiveInstallments.map(
        (installment: QuotationInstallment, index: number) => ({
          receivableId: receivable.id,
          installmentNumber: index + 1,
          dueDate: installment.dueDate,
          amount: installment.value,
          additionalFee: installment.additionalFee || 0,
          paymentConditionId: installment.paymentConditionId,
          bankAccountId: defaultBankAccountId,
          status: PaymentStatus.PENDING as PaymentStatus,
          paidDate: null,
        }),
      );

      await prisma.receivableInstallment.createMany({
        data: installments,
      });

      return receivable;
    } catch (error) {
      this.logger.error('Erro ao gerar contas a receber:', error.stack);
      throw new Error(
        'Erro ao gerar contas a receber. Detalhes: ' + error.message,
      );
    }
  }

  /**
   * Gera contas a pagar (comissão e entrega) a partir do orçamento
   */
  async generatePayableFromQuotation(
    quotation: QuotationForFinancial,
    prisma: Prisma.TransactionClient,
  ) {
    const results = {
      payableCommission: null,
      payableDelivery: null,
    };

    // Avaliar comissão independentemente
    const commission = quotation.quotationPayment.commission;
    if (await this.shouldCreateCommissionPayable(commission, prisma)) {
      results.payableCommission = await this.createCommissionPayable(
        quotation,
        commission,
        prisma,
      );
    }

    // Avaliar entrega independentemente
    const delivery = quotation.deliveryInfo;
    if (this.shouldCreateDeliveryPayable(delivery)) {
      results.payableDelivery = await this.createDeliveryPayable(
        quotation,
        delivery,
        prisma,
      );
    }

    return results;
  }

  /**
   * Valida se deve criar conta a pagar de comissão
   */
  async shouldCreateCommissionPayable(
    commission: QuotationCommission | null,
    prisma: Prisma.TransactionClient,
  ): Promise<boolean> {
    if (!commission) return false;

    // Validar valor da comissão
    if (!commission.commissionValue || commission.commissionValue <= 0) {
      this.logger.debug('Commission validation failed: commissionValue <= 0');
      return false;
    }

    if (!commission.totalCommission || commission.totalCommission <= 0) {
      this.logger.debug('Commission validation failed: totalCommission <= 0');
      return false;
    }

    // Validar fornecedor
    if (!commission.supplierId) {
      this.logger.debug('Commission validation failed: no supplierId');
      return false;
    }

    // Verificar se fornecedor existe
    const supplier = await prisma.supplier.findFirst({
      where: { id: commission.supplierId },
    });

    if (!supplier) {
      this.logger.debug('Commission validation failed: supplier not found');
      return false;
    }

    return true;
  }

  /**
   * Valida se deve criar conta a pagar de entrega
   */
  shouldCreateDeliveryPayable(delivery: QuotationDeliveryInfo | null): boolean {
    if (!delivery) return false;

    // Regra simplificada: se tem custo, sempre gera despesa
    if (!delivery.cost || delivery.cost <= 0) {
      this.logger.debug('Delivery validation failed: cost <= 0');
      return false;
    }

    return true;
  }

  /**
   * Cria conta a pagar de comissão
   */
  async createCommissionPayable(
    quotation: QuotationForFinancial,
    commission: QuotationCommission,
    prisma: Prisma.TransactionClient,
  ) {
    // Buscar natureza e categoria para comissão
    const { natureId, subCategoryId } = await this.findCommissionCategories(
      quotation.companyId,
      prisma,
    );

    // Buscar conta bancária padrão da empresa
    const defaultBankAccount = await prisma.bankAccount.findFirst({
      where: {
        companyId: quotation.companyId,
        isActive: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
    const defaultBankAccountId = defaultBankAccount?.id || null;

    // Criar conta a pagar da comissão
    const payableCommission = await prisma.payable.create({
      data: {
        referenceDate: new Date(),
        description: `Comissão da venda ${quotation.quotationNumber}-${quotation.series.code} - ${quotation.description || ''}`,
        notes: quotation.quotationPayment.description || '',
        totalAmount: commission.totalCommission || 0,
        totalValue: commission.totalCommission || 0,
        mainAdditionalFee: 0,
        installmentQty:
          commission.transferMethod === 'PAYMENT_BASED'
            ? quotation.quotationPayment.quotationInstallment.length
            : 1,
        status: PaymentStatus.PENDING as PaymentStatus,
        supplierId: commission.supplierId,
        companyId: quotation.companyId,
        natureId: natureId,
        subCategoryId: subCategoryId,
        quotationId: quotation.id,
        financialType: 'COMMISSION',
        commission: {
          connect: {
            id: commission.id,
          },
        },
      },
    });

    // Criar parcelas de comissão
    if (payableCommission) {
      if (commission.transferMethod === 'SINGLE') {
        await prisma.payableInstallment.create({
          data: {
            payableId: payableCommission.id,
            installmentNumber: 1,
            dueDate: add(new Date(), { days: 30 }),
            amount: commission.totalCommission || 0,
            additionalFee: 0,
            paymentConditionId: null,
            bankAccountId: defaultBankAccountId,
            status: PaymentStatus.PENDING as PaymentStatus,
            paidDate: null,
          },
        });
      } else if (commission.transferMethod === 'PAYMENT_BASED') {
        const installments =
          quotation.quotationPayment.quotationInstallment.map(
            (installment: QuotationInstallment, index: number) => ({
              payableId: payableCommission.id,
              installmentNumber: index + 1,
              dueDate: installment.dueDate,
              amount:
                commission.totalCommission /
                quotation.quotationPayment.quotationInstallment.length,
              additionalFee: 0,
              paymentConditionId: null,
              bankAccountId: defaultBankAccountId,
              status: PaymentStatus.PENDING as PaymentStatus,
              paidDate: null,
            }),
          );

        await prisma.payableInstallment.createMany({
          data: installments,
        });
      }
    }

    return payableCommission;
  }

  /**
   * Cria conta a pagar de entrega
   */
  async createDeliveryPayable(
    quotation: QuotationForFinancial,
    delivery: QuotationDeliveryInfo,
    prisma: Prisma.TransactionClient,
  ) {
    const deliveryCost = delivery.cost || 0;

    // Buscar natureza e categoria para entrega/frete
    const { natureId, subCategoryId } = await this.findDeliveryCategories(
      quotation.companyId,
      prisma,
    );

    // Buscar conta bancária padrão da empresa
    const defaultBankAccount = await prisma.bankAccount.findFirst({
      where: {
        companyId: quotation.companyId,
        isActive: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
    const defaultBankAccountId = defaultBankAccount?.id || null;

    // Criar conta a pagar da entrega
    const payableDelivery = await prisma.payable.create({
      data: {
        referenceDate: new Date(),
        description: `Entrega da venda ${quotation.quotationNumber}-${quotation.series.code} - ${quotation.description || ''}`,
        notes: quotation.quotationPayment.description || '',
        totalAmount: deliveryCost,
        totalValue: deliveryCost,
        mainAdditionalFee: 0,
        installmentQty: 1,
        status: PaymentStatus.PENDING as PaymentStatus,
        supplierId: delivery.supplierId,
        companyId: quotation.companyId,
        natureId: natureId,
        subCategoryId: subCategoryId,
        quotationId: quotation.id,
        financialType: 'DELIVERY',
      },
    });

    // Criar parcela única para a entrega
    if (payableDelivery) {
      await prisma.payableInstallment.create({
        data: {
          payableId: payableDelivery.id,
          installmentNumber: 1,
          dueDate: add(new Date(), { days: 30 }),
          amount: deliveryCost,
          additionalFee: 0,
          paymentConditionId: null,
          bankAccountId: defaultBankAccountId,
          status: PaymentStatus.PENDING as PaymentStatus,
          paidDate: null,
        },
      });
    }

    return payableDelivery;
  }

  /**
   * Busca a natureza e categoria para receitas de venda
   */
  async findSalesCategories(
    companyId: string,
    prisma: Prisma.TransactionClient,
  ) {
    try {
      // Buscar natureza "Vendas"
      const nature = await prisma.nature.findFirst({
        where: {
          companyId,
          isActive: true,
          description: {
            equals: 'Vendas',
            mode: 'insensitive',
          },
        },
      });

      if (!nature) {
        console.warn(
          `Natureza "Vendas" não encontrada para empresa ${companyId}`,
        );
        return {
          natureId: null,
          subCategoryId: null,
        };
      }

      // Buscar subcategoria "Prestação de Serviços"
      const subCategory = await prisma.subCategory.findFirst({
        where: {
          companyId,
          isActive: true,
          natureId: nature.id,
          description: {
            equals: 'Prestação de Serviços',
            mode: 'insensitive',
          },
        },
      });

      if (!subCategory) {
        console.warn(
          `Subcategoria "Prestação de Serviços" não encontrada para natureza "Vendas" na empresa ${companyId}`,
        );
      }

      return {
        natureId: nature.id,
        subCategoryId: subCategory?.id || null,
      };
    } catch (error) {
      console.warn(`Erro ao buscar categorias de venda: ${error.message}`);
      return {
        natureId: null,
        subCategoryId: null,
      };
    }
  }

  /**
   * Busca a natureza e categoria para comissão
   */
  async findCommissionCategories(
    companyId: string,
    prisma: Prisma.TransactionClient,
  ) {
    try {
      // Buscar natureza "Operacional"
      const nature = await prisma.nature.findFirst({
        where: {
          companyId,
          isActive: true,
          description: {
            equals: 'Operacional',
            mode: 'insensitive',
          },
        },
      });

      if (!nature) {
        console.warn(
          `Natureza "Operacional" não encontrada para empresa ${companyId}`,
        );
        return {
          natureId: null,
          subCategoryId: null,
        };
      }

      // Buscar subcategoria "Comissão de Venda"
      const subCategory = await prisma.subCategory.findFirst({
        where: {
          companyId,
          isActive: true,
          natureId: nature.id,
          description: {
            equals: 'Comissão de Venda',
            mode: 'insensitive',
          },
        },
      });

      if (!subCategory) {
        console.warn(
          `Subcategoria "Comissão de Venda" não encontrada para natureza "Operacional" na empresa ${companyId}`,
        );
      }

      return {
        natureId: nature.id,
        subCategoryId: subCategory?.id || null,
      };
    } catch (error) {
      console.warn(`Erro ao buscar categorias de comissão: ${error.message}`);
      return {
        natureId: null,
        subCategoryId: null,
      };
    }
  }

  /**
   * Busca a natureza e categoria para frete/entrega de venda
   */
  async findDeliveryCategories(
    companyId: string,
    prisma: Prisma.TransactionClient,
  ) {
    try {
      // Buscar natureza "Operacional"
      const nature = await prisma.nature.findFirst({
        where: {
          companyId,
          isActive: true,
          description: {
            equals: 'Operacional',
            mode: 'insensitive',
          },
        },
      });

      if (!nature) {
        console.warn(
          `Natureza "Operacional" não encontrada para empresa ${companyId}`,
        );
        return {
          natureId: null,
          subCategoryId: null,
        };
      }

      // Buscar subcategoria "Frete de Venda"
      const subCategory = await prisma.subCategory.findFirst({
        where: {
          companyId,
          isActive: true,
          natureId: nature.id,
          description: {
            equals: 'Frete de Venda',
            mode: 'insensitive',
          },
        },
      });

      if (!subCategory) {
        console.warn(
          `Subcategoria "Frete de Venda" não encontrada para natureza "Operacional" na empresa ${companyId}`,
        );
      }

      return {
        natureId: nature.id,
        subCategoryId: subCategory?.id || null,
      };
    } catch (error) {
      console.warn(`Erro ao buscar categorias de entrega: ${error.message}`);
      return {
        natureId: null,
        subCategoryId: null,
      };
    }
  }

  /**
   * Retorna métodos de pagamento disponíveis para um cliente
   */
  async getAvailablePaymentMethods(
    companyId: string,
    clientId?: string,
  ): Promise<string[]> {
    try {
      // Buscar métodos de pagamento ativos para recebíveis da empresa
      const paymentMethods = await this.prisma.paymentMethod.findMany({
        where: {
          isActive: true,
          paymentCondition: {
            some: {
              companyId,
              isActive: true,
              bankAccountCashControls: {
                some: {
                  acceptIncomes: true,
                  bankAccount: {
                    isActive: true,
                  },
                },
              },
            },
          },
        },
        include: {
          paymentCondition: {
            where: {
              companyId,
              isActive: true,
            },
          },
        },
        orderBy: {
          name: 'asc',
        },
      });

      if (!paymentMethods.length) {
        return [];
      }

      // Se temos cliente específico, filtrar por suas condições de pagamento
      if (clientId) {
        const client = await this.prisma.client.findUnique({
          where: { id: clientId },
          select: {
            type: true,
            status: true,
            maxValue: true,
            minValue: true,
            paymentConditions: {
              where: { isActive: true },
              include: {
                paymentCondition: {
                  include: {
                    paymentMethod: true,
                  },
                },
              },
            },
          },
        });

        if (!client) {
          return [];
        }

        // 1. Verificar se cliente tem condições específicas configuradas
        if (client.paymentConditions.length > 0) {
          // Cliente tem condições específicas no seu cadastro
          const clientPaymentMethods = new Map<
            string,
            { name: string; conditions: string[] }
          >();

          client.paymentConditions.forEach((cpc) => {
            // Verificar se a condição está ativa
            if (cpc.isActive) {
              const method = cpc.paymentCondition;
              if (!clientPaymentMethods.has(method.id)) {
                clientPaymentMethods.set(method.id, {
                  name: method.name,
                  conditions: [],
                });
              }
              clientPaymentMethods
                .get(method.id)
                .conditions.push(cpc.paymentCondition.name);
            }
          });

          return Array.from(clientPaymentMethods.values()).map((method) => {
            const maxInstallments = method.conditions
              .map((condName) => {
                const match = condName.match(/(\d+)x/i);
                return match ? parseInt(match[1]) : 1;
              })
              .reduce((max, current) => Math.max(max, current), 1);

            if (maxInstallments > 1) {
              return `${method.name} até ${maxInstallments}x`;
            }
            return method.name;
          });
        }

        // Se cliente não tem condições específicas, retorna array vazio
        return [];
      }

      // Se não tem cliente específico, retorna array vazio
      return [];
    } catch (error) {
      this.logger.error(
        'Error getting available payment methods:',
        error.stack,
      );
      return [];
    }
  }
}
