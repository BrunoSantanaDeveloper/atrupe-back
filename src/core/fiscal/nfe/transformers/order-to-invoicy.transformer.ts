import { Injectable } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';

export interface InvoicyNfePayload {
  NaturezaOperacao: string;
  TipoOperacao: number; // 0 = Entrada, 1 = Saída
  Finalidade: number; // 1 = Normal, 2 = Complementar, 3 = Ajuste, 4 = Devolução
  ConsumidorFinal: number; // 0 = Normal, 1 = Consumidor Final
  PresencaComprador: number;
  Destinatario: {
    CpfCnpj: string;
    RazaoSocial: string;
    InscricaoEstadual?: string;
    Email?: string;
    Telefone?: string;
    Endereco: {
      Logradouro: string;
      Numero: string;
      Complemento?: string;
      Bairro: string;
      Municipio: string;
      UF: string;
      CEP: string;
      CodigoMunicipio?: string;
    };
  };
  Produtos: InvoicyProductItem[];
  Frete?: {
    Modalidade: number; // 0=Remetente, 1=Destinatário, 2=Terceiros, 9=Sem frete
    Transportadora?: {
      CpfCnpj?: string;
      RazaoSocial?: string;
    };
  };
  Pagamento: {
    Forma: number; // 01=Dinheiro, 02=Cheque, 03=Cartão Crédito, etc
    Valor: number;
  }[];
  InformacoesComplementares?: string;
}

export interface InvoicyProductItem {
  Codigo: string;
  Descricao: string;
  NCM: string;
  CFOP: string;
  UnidadeComercial: string;
  QuantidadeComercial: number;
  ValorUnitario: number;
  ValorTotal: number;
  ICMS: {
    Origem: string;
    CST: string;
    BaseCalculo?: number;
    Aliquota?: number;
    Valor?: number;
  };
  PIS: {
    CST: string;
    BaseCalculo?: number;
    Aliquota?: number;
    Valor?: number;
  };
  COFINS: {
    CST: string;
    BaseCalculo?: number;
    Aliquota?: number;
    Valor?: number;
  };
}

@Injectable()
export class OrderToInvoicyTransformer {
  constructor(private prisma: PrismaService) {}

  /**
   * Transform an Order to Invoicy NF-e payload format
   */
  async transform(orderId: string, companyId: string): Promise<InvoicyNfePayload> {
    // Fetch order with all related data
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        quotation: {
          include: {
            company: {
              include: {
                address: true,
              },
            },
            client: {
              include: {
                address: true,
              },
            },
            quotationProduct: {
              include: {
                product: {
                  include: {
                    fiscalData: true,
                  },
                },
                items: true,
              },
            },
            quotationPayment: {
              include: {
                paymentCondition: {
                  include: {
                    paymentMethod: true,
                  },
                },
              },
            },
            deliveryInfo: {
              include: {
                supplier: true,
                clientAddress: true,
              },
            },
          },
        },
      },
    });

    if (!order) {
      throw new Error('Order not found');
    }

    const quotation = order.quotation;
    const client = quotation.client;
    const config = await this.getInvoicyConfig(companyId);

    // Build recipient data
    const clientAddress = client?.address?.[0];
    const destinatario = this.buildDestinatario(client, clientAddress);

    // Build products
    const produtos = await this.buildProdutos(
      quotation.quotationProduct,
      companyId,
      config?.defaultCfop || '5102',
    );

    // Build payment
    const pagamento = this.buildPagamento(quotation.quotationPayment);

    // Build freight
    const frete = this.buildFrete(quotation.deliveryInfo);

    return {
      NaturezaOperacao: config?.defaultOperationNature || 'Venda de mercadoria',
      TipoOperacao: 1, // Saída
      Finalidade: 1, // Normal
      ConsumidorFinal: client?.type === 'PERSON' ? 1 : 0,
      PresencaComprador: 0, // Não se aplica
      Destinatario: destinatario,
      Produtos: produtos,
      Frete: frete,
      Pagamento: pagamento,
      InformacoesComplementares: config?.taxInfoText || undefined,
    };
  }

  private async getInvoicyConfig(companyId: string) {
    return this.prisma.invoicyConfig.findUnique({
      where: { companyId },
    });
  }

  private buildDestinatario(client: any, address: any) {
    const document = client?.cnpj || client?.cpf || '';
    const cleanDocument = document.replace(/\D/g, '');

    return {
      CpfCnpj: cleanDocument,
      RazaoSocial: client?.corporateName || client?.name || 'Consumidor',
      InscricaoEstadual: client?.type === 'COMPANY' ? 'ISENTO' : undefined,
      Email: client?.email || undefined,
      Telefone: client?.phone || client?.mobile || undefined,
      Endereco: {
        Logradouro: address?.street || 'Não informado',
        Numero: address?.number || 'S/N',
        Complemento: address?.complement || undefined,
        Bairro: address?.neighborhood || 'Não informado',
        Municipio: address?.city || 'Não informado',
        UF: address?.state || 'SP',
        CEP: address?.zipcode?.replace(/\D/g, '') || '00000000',
      },
    };
  }

  private async buildProdutos(
    quotationProducts: any[],
    companyId: string,
    defaultCfop: string,
  ): Promise<InvoicyProductItem[]> {
    const produtos: InvoicyProductItem[] = [];

    for (const qp of quotationProducts) {
      const product = qp.product;
      const fiscalData = product?.fiscalData;

      // For each item in the quotation product
      for (const item of qp.items) {
        produtos.push({
          Codigo: product?.code || item.productItemId,
          Descricao: item.name || product?.name || 'Produto',
          NCM: fiscalData?.ncm || '00000000',
          CFOP: fiscalData?.cfopInState || defaultCfop,
          UnidadeComercial: this.mapUnitKind(item.unitKind),
          QuantidadeComercial: item.quantity || 1,
          ValorUnitario: item.unitCost || 0,
          ValorTotal: item.totalValue || item.unitCost * (item.quantity || 1),
          ICMS: {
            Origem: fiscalData?.icmsOrigin || '0',
            CST: fiscalData?.icmsCst || '00',
            BaseCalculo: item.totalValue || 0,
            Aliquota: fiscalData?.icmsRate || 0,
            Valor: fiscalData?.icmsRate
              ? (item.totalValue || 0) * (fiscalData.icmsRate / 100)
              : 0,
          },
          PIS: {
            CST: fiscalData?.pisCst || '07',
            BaseCalculo: fiscalData?.pisRate ? item.totalValue : undefined,
            Aliquota: fiscalData?.pisRate || undefined,
            Valor: fiscalData?.pisRate
              ? (item.totalValue || 0) * (fiscalData.pisRate / 100)
              : undefined,
          },
          COFINS: {
            CST: fiscalData?.cofinsCst || '07',
            BaseCalculo: fiscalData?.cofinsRate ? item.totalValue : undefined,
            Aliquota: fiscalData?.cofinsRate || undefined,
            Valor: fiscalData?.cofinsRate
              ? (item.totalValue || 0) * (fiscalData.cofinsRate / 100)
              : undefined,
          },
        });
      }
    }

    return produtos;
  }

  private mapUnitKind(unitKind: string | null): string {
    const unitMap: Record<string, string> = {
      UNITY: 'UN',
      LENGTH: 'M',
      WEIGHT: 'KG',
      CAPACITY: 'L',
      DISTANCE: 'KM',
      DURATION: 'HR',
      AREA: 'M2',
    };
    return unitMap[unitKind || 'UNITY'] || 'UN';
  }

  private buildPagamento(quotationPayment: any): { Forma: number; Valor: number }[] {
    if (!quotationPayment) {
      return [{ Forma: 99, Valor: 0 }]; // Outros
    }

    const paymentMethodCode = quotationPayment.paymentCondition?.paymentMethod?.code;
    const forma = this.mapPaymentMethod(paymentMethodCode);
    const valor = quotationPayment.finalValue || quotationPayment.totalValue || 0;

    return [{ Forma: forma, Valor: valor }];
  }

  private mapPaymentMethod(methodCode: string | undefined): number {
    const methodMap: Record<string, number> = {
      DINHEIRO: 1,
      CHEQUE: 2,
      CARTAO_CREDITO: 3,
      CARTAO_DEBITO: 4,
      CREDITO_LOJA: 5,
      VALE_ALIMENTACAO: 10,
      VALE_REFEICAO: 11,
      VALE_PRESENTE: 12,
      VALE_COMBUSTIVEL: 13,
      BOLETO: 15,
      PIX: 17,
      TRANSFERENCIA: 18,
      SEM_PAGAMENTO: 90,
      OUTROS: 99,
    };
    return methodMap[methodCode || 'OUTROS'] || 99;
  }

  private buildFrete(deliveryInfo: any): InvoicyNfePayload['Frete'] | undefined {
    if (!deliveryInfo) {
      return { Modalidade: 9 }; // Sem frete
    }

    const modalidadeMap: Record<string, number> = {
      INSTALLATION: 0, // Por conta do remetente
      CARRIER: 1, // Por conta do destinatário
      PICKUP: 9, // Sem frete (cliente retira)
    };

    return {
      Modalidade: modalidadeMap[deliveryInfo.deliveryType] || 9,
      Transportadora: deliveryInfo.supplier
        ? {
            CpfCnpj: deliveryInfo.supplier.cnpj?.replace(/\D/g, '') || undefined,
            RazaoSocial: deliveryInfo.supplier.name || undefined,
          }
        : undefined,
    };
  }
}
