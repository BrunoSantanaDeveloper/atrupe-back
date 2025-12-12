import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { InvoicyClientService } from '../shared/invoicy-client.service';
import {
  OrderToInvoicyTransformer,
  InvoicyNfePayload,
} from './transformers/order-to-invoicy.transformer';
import { NfeStatus } from '@prisma/client';

export interface EmitNfeDto {
  orderId: string;
  operationNature?: string;
  additionalInfo?: string;
}

export interface CancelNfeDto {
  reason: string;
}

export interface CorrectionDto {
  correction: string;
}

@Injectable()
export class NfeService {
  private readonly logger = new Logger(NfeService.name);

  constructor(
    private prisma: PrismaService,
    private invoicyClient: InvoicyClientService,
    private orderTransformer: OrderToInvoicyTransformer,
  ) {}

  /**
   * Emit NF-e from an Order
   */
  async emitFromOrder(
    companyId: string,
    userId: string,
    dto: EmitNfeDto,
  ): Promise<any> {
    this.logger.log(`Starting NF-e emission for order ${dto.orderId}`);

    // Verify order exists and belongs to company
    const order = await this.prisma.order.findFirst({
      where: {
        id: dto.orderId,
        quotation: { companyId },
      },
      include: {
        quotation: {
          include: {
            client: true,
            company: true,
          },
        },
        nfe: {
          where: {
            status: {
              in: ['AUTORIZADA'],
            },
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Check if order already has authorized NF-e
    if (order.nfe.length > 0) {
      throw new BadRequestException(
        'Order already has an authorized NF-e. Use correction or cancellation instead.',
      );
    }

    // Get invoicy config for this company
    const config = await this.prisma.invoicyConfig.findUnique({
      where: { companyId },
    });

    if (!config) {
      throw new BadRequestException(
        'Invoicy configuration not found. Please configure fiscal settings first.',
      );
    }

    // Transform order to Invoicy payload
    const invoicyPayload = await this.orderTransformer.transform(
      dto.orderId,
      companyId,
    );

    // Override operation nature if provided
    if (dto.operationNature) {
      invoicyPayload.NaturezaOperacao = dto.operationNature;
    }

    // Add additional info
    if (dto.additionalInfo) {
      invoicyPayload.InformacoesComplementares = dto.additionalInfo;
    }

    // Get next NF-e number
    const nfeNumber = config.nfeNextNumber;
    const nfeSeries = config.nfeSeries;

    // Create NF-e record in database with PROCESSANDO status
    const client = order.quotation.client;
    const nfe = await this.prisma.nfe.create({
      data: {
        companyId,
        number: nfeNumber,
        series: nfeSeries,
        model: '55', // NF-e
        type: 'SAIDA',
        purpose: 'NORMAL',
        operationNature: invoicyPayload.NaturezaOperacao,
        status: NfeStatus.PROCESSANDO,
        recipientId: client?.id,
        recipientType: 'CLIENT',
        recipientName: client?.name || 'Consumidor',
        recipientDocument:
          client?.cnpj || client?.cpf || 'Não identificado',
        recipientEmail: client?.email,
        recipientPhone: client?.phone,
        recipientAddress: invoicyPayload.Destinatario.Endereco,
        finalConsumer: invoicyPayload.ConsumidorFinal === 1,
        consumerPresence: 'NAO_SE_APLICA',
        operationDestiny: 'INTERNA',
        freightModality: 'SEM_FRETE',
        totalProducts: this.calculateTotalProducts(invoicyPayload.Produtos),
        totalNfe: this.calculateTotalNfe(invoicyPayload),
        invoicyPayload: invoicyPayload as any,
        orderId: dto.orderId,
        quotationId: order.quotationId,
        additionalInfo: dto.additionalInfo,
        createdBy: userId,
      },
    });

    // Create NF-e items
    const itemsData = invoicyPayload.Produtos.map((produto, index) => ({
      nfeId: nfe.id,
      sequence: index + 1,
      productCode: produto.Codigo,
      productName: produto.Descricao,
      ncm: produto.NCM,
      cfop: produto.CFOP,
      commercialUnit: produto.UnidadeComercial,
      quantity: produto.QuantidadeComercial,
      unitValue: produto.ValorUnitario,
      totalValue: produto.ValorTotal,
      icmsOrigin: produto.ICMS.Origem,
      icmsCst: produto.ICMS.CST,
      icmsBaseValue: produto.ICMS.BaseCalculo,
      icmsRate: produto.ICMS.Aliquota,
      icmsValue: produto.ICMS.Valor,
      pisCst: produto.PIS.CST,
      pisRate: produto.PIS.Aliquota,
      pisValue: produto.PIS.Valor,
      cofinsCst: produto.COFINS.CST,
      cofinsRate: produto.COFINS.Aliquota,
      cofinsValue: produto.COFINS.Valor,
    }));

    await this.prisma.nfeItem.createMany({
      data: itemsData,
    });

    try {
      // Send to Invoicy API
      const invoicyResponse = await this.invoicyClient.post<any>(
        '/nfe/emitir',
        companyId,
        {
          Serie: nfeSeries,
          Numero: nfeNumber,
          ...invoicyPayload,
        },
      );

      // Update NF-e with response
      const updatedNfe = await this.processInvoicyResponse(
        nfe.id,
        config.id,
        invoicyResponse,
      );

      return updatedNfe;
    } catch (error) {
      // Update NF-e status to ERRO
      await this.prisma.nfe.update({
        where: { id: nfe.id },
        data: {
          status: NfeStatus.ERRO,
          statusMessage: error.message || 'Erro ao enviar para Invoicy',
          invoicyResponse: { error: error.message } as any,
        },
      });

      this.logger.error(`Error emitting NF-e: ${error.message}`);
      throw new BadRequestException(`Error emitting NF-e: ${error.message}`);
    }
  }

  /**
   * Process Invoicy API response
   */
  private async processInvoicyResponse(
    nfeId: string,
    configId: string,
    response: any,
  ) {
    const status = response.Status || response.status;
    const isAuthorized =
      status === 'Autorizada' ||
      status === 'AUTORIZADA' ||
      response.cStat === '100';

    const updateData: any = {
      invoicyResponse: response,
      statusSefaz: response.cStat || status,
      statusMessage: response.xMotivo || response.Mensagem || response.message,
    };

    if (isAuthorized) {
      updateData.status = NfeStatus.AUTORIZADA;
      updateData.xmlKey = response.ChaveNFe || response.chNFe;
      updateData.protocolNumber = response.nProt || response.Protocolo;
      updateData.protocolDate = response.dhRecbto
        ? new Date(response.dhRecbto)
        : new Date();
      updateData.xmlContent = response.XML || response.xml;
      updateData.danfeUrl = response.UrlDanfe || response.urlDanfe;

      // Increment next NF-e number
      await this.prisma.invoicyConfig.update({
        where: { id: configId },
        data: {
          nfeNextNumber: { increment: 1 },
        },
      });
    } else if (status === 'Rejeitada' || status === 'REJEITADA') {
      updateData.status = NfeStatus.REJEITADA;
    } else if (status === 'Denegada' || status === 'DENEGADA') {
      updateData.status = NfeStatus.DENEGADA;
    } else {
      updateData.status = NfeStatus.ERRO;
    }

    return this.prisma.nfe.update({
      where: { id: nfeId },
      data: updateData,
      include: {
        items: true,
        client: true,
      },
    });
  }

  /**
   * Cancel an authorized NF-e
   */
  async cancel(
    id: string,
    companyId: string,
    dto: CancelNfeDto,
  ): Promise<any> {
    const nfe = await this.prisma.nfe.findFirst({
      where: { id, companyId },
    });

    if (!nfe) {
      throw new NotFoundException('NF-e not found');
    }

    if (nfe.status !== NfeStatus.AUTORIZADA) {
      throw new BadRequestException('Only authorized NF-e can be cancelled');
    }

    if (!nfe.xmlKey) {
      throw new BadRequestException('NF-e does not have a valid key');
    }

    // Check if within 24h window
    const emissionDate = nfe.protocolDate || nfe.createdAt;
    const hoursSinceEmission =
      (Date.now() - emissionDate.getTime()) / (1000 * 60 * 60);
    if (hoursSinceEmission > 24) {
      throw new BadRequestException(
        'NF-e can only be cancelled within 24 hours of emission',
      );
    }

    try {
      const response = await this.invoicyClient.post<any>(
        '/nfe/cancelar',
        companyId,
        {
          ChaveNFe: nfe.xmlKey,
          Justificativa: dto.reason,
        },
      );

      const isCancelled =
        response.Status === 'Cancelada' ||
        response.status === 'CANCELADA' ||
        response.cStat === '135';

      if (isCancelled) {
        return this.prisma.nfe.update({
          where: { id },
          data: {
            status: NfeStatus.CANCELADA,
            cancelDate: new Date(),
            cancelReason: dto.reason,
            cancelProtocol: response.nProt || response.Protocolo,
            invoicyResponse: response,
          },
        });
      } else {
        throw new BadRequestException(
          response.xMotivo || response.Mensagem || 'Failed to cancel NF-e',
        );
      }
    } catch (error) {
      this.logger.error(`Error cancelling NF-e: ${error.message}`);
      throw new BadRequestException(`Error cancelling NF-e: ${error.message}`);
    }
  }

  /**
   * Create correction letter (Carta de Correção)
   */
  async createCorrection(
    id: string,
    companyId: string,
    dto: CorrectionDto,
  ): Promise<any> {
    const nfe = await this.prisma.nfe.findFirst({
      where: { id, companyId },
      include: { corrections: true },
    });

    if (!nfe) {
      throw new NotFoundException('NF-e not found');
    }

    if (nfe.status !== NfeStatus.AUTORIZADA) {
      throw new BadRequestException(
        'Corrections can only be made to authorized NF-e',
      );
    }

    if (!nfe.xmlKey) {
      throw new BadRequestException('NF-e does not have a valid key');
    }

    // Get next sequence number
    const nextSequence = nfe.corrections.length + 1;

    if (nextSequence > 20) {
      throw new BadRequestException(
        'Maximum number of corrections (20) reached',
      );
    }

    try {
      const response = await this.invoicyClient.post<any>(
        '/nfe/carta-correcao',
        companyId,
        {
          ChaveNFe: nfe.xmlKey,
          SequenciaEvento: nextSequence,
          Correcao: dto.correction,
        },
      );

      const isSuccess =
        response.Status === 'Registrada' ||
        response.cStat === '135' ||
        response.cStat === '573';

      return this.prisma.nfeCorrection.create({
        data: {
          nfeId: id,
          sequence: nextSequence,
          correction: dto.correction,
          protocol: isSuccess
            ? response.nProt || response.Protocolo
            : undefined,
          xmlContent: response.XML || response.xml,
          invoicyResponse: response,
        },
      });
    } catch (error) {
      this.logger.error(`Error creating correction: ${error.message}`);
      throw new BadRequestException(
        `Error creating correction: ${error.message}`,
      );
    }
  }

  /**
   * Get DANFE PDF URL
   */
  async getDanfeUrl(id: string, companyId: string): Promise<string> {
    const nfe = await this.prisma.nfe.findFirst({
      where: { id, companyId },
    });

    if (!nfe) {
      throw new NotFoundException('NF-e not found');
    }

    if (nfe.danfeUrl) {
      return nfe.danfeUrl;
    }

    if (!nfe.xmlKey) {
      throw new BadRequestException('NF-e does not have a valid key');
    }

    // Request DANFE from Invoicy
    const response = await this.invoicyClient.get<any>(
      `/nfe/danfe/${nfe.xmlKey}`,
      companyId,
    );

    if (response.Url || response.url) {
      await this.prisma.nfe.update({
        where: { id },
        data: { danfeUrl: response.Url || response.url },
      });
      return response.Url || response.url;
    }

    throw new BadRequestException('Could not generate DANFE');
  }

  /**
   * Find all NF-e for a company
   */
  async findAll(companyId: string, filters?: any) {
    const where: any = { companyId };

    if (filters?.status) {
      where.status = filters.status;
    }

    if (filters?.clientId) {
      where.recipientId = filters.clientId;
    }

    if (filters?.startDate && filters?.endDate) {
      where.issueDate = {
        gte: new Date(filters.startDate),
        lte: new Date(filters.endDate),
      };
    }

    return this.prisma.nfe.findMany({
      where,
      include: {
        client: {
          select: {
            id: true,
            name: true,
          },
        },
        order: {
          select: {
            id: true,
            quotation: {
              select: {
                id: true,
                quotationNumber: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Find one NF-e by ID
   */
  async findOne(id: string, companyId: string) {
    const nfe = await this.prisma.nfe.findFirst({
      where: { id, companyId },
      include: {
        items: true,
        client: true,
        corrections: {
          orderBy: { sequence: 'asc' },
        },
        order: {
          include: {
            quotation: {
              select: {
                id: true,
                quotationNumber: true,
                description: true,
              },
            },
          },
        },
      },
    });

    if (!nfe) {
      throw new NotFoundException('NF-e not found');
    }

    return nfe;
  }

  private calculateTotalProducts(produtos: InvoicyNfePayload['Produtos']): number {
    return produtos.reduce((total, p) => total + p.ValorTotal, 0);
  }

  private calculateTotalNfe(payload: InvoicyNfePayload): number {
    const totalProdutos = this.calculateTotalProducts(payload.Produtos);
    const totalFrete = payload.Frete?.Modalidade !== 9 ? 0 : 0; // Would add freight value if available
    return totalProdutos + totalFrete;
  }
}
