import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { InvoicyHttpService } from './invoicy-http.service';
import {
  InvoicyResponse,
  InvoicyNfeRequest,
  InvoicyNfseRequest,
  INVOICY_SUCCESS_CODES,
} from './invoicy.types';
import { FiscalCredentialResolverService } from '../shared/fiscal-credential-resolver.service';
import { FiscalEnvironment } from '@prisma/client';

/**
 * InvoicyApiService - Domain API Layer for Fiscal Documents
 *
 * This service provides a domain-specific API for fiscal document operations
 * (NF-e, NFS-e, NFC-e) using the InvoicyHttpService for HTTP transport.
 *
 * Separation of concerns:
 * - InvoicyHttpService: Auth, retry, HTTP transport
 * - InvoicyApiService: Fiscal document operations (this service)
 * - InvoicyService: Config CRUD, incrementers
 */
@Injectable()
export class InvoicyApiService {
  private readonly logger = new Logger(InvoicyApiService.name);

  /**
   * Teto de espera para eventos fiscais (CC-e, cancelamento). Precisa ser menor
   * que o timeout da transação que persiste o resultado, senão o evento pode ser
   * registrado na SEFAZ sem que o sistema consiga gravá-lo.
   */
  private readonly FISCAL_EVENT_TIMEOUT_MS = 45000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoicyHttpService: InvoicyHttpService,
    private readonly fiscalCredentialResolver: FiscalCredentialResolverService,
  ) {}

  // ============================================
  // NF-e / NFC-e Operations
  // ============================================

  /**
   * Emit NF-e or NFC-e document
   */
  async emitNfe(
    companyId: string,
    documents: InvoicyNfeRequest[],
    invoicyConfigId?: string,
  ): Promise<InvoicyResponse[]> {
    this.logger.log(`Emitting NF-e/NFC-e for company ${companyId}`);

    const response = await this.invoicyHttpService.makeRequest<
      InvoicyResponse[]
    >(
      companyId,
      'POST',
      '/senddocuments/nfe?type=Emissao',
      documents,
      invoicyConfigId,
    );

    // Check for errors in response
    if (
      response.length > 0 &&
      response[0].Codigo !== INVOICY_SUCCESS_CODES.DOCUMENTS_PROCESSED
    ) {
      this.logger.warn(
        `Invoicy returned non-success code: ${response[0].Codigo} - ${
          response[0].Descricao || response[0].ErrorInvoicy || 'Sem descricao'
        }`,
      );
    }

    return response;
  }

  /**
   * Cancel NF-e or NFC-e document
   */
  async cancelNfe(
    companyId: string,
    chaveAcesso: string,
    justificativa: string,
    ambiente?: number,
  ): Promise<InvoicyResponse[]> {
    this.logger.log(`Canceling NF-e ${chaveAcesso} for company ${companyId}`);

    const cancelRequest = [
      {
        Documento: {
          ModeloDocumento: 'NFe',
          Versao: 4,
          Evento: {
            ChaveNFe: chaveAcesso,
            TipoEvento: 110111, // Cancelamento
            nSeqEvento: 1,
            Justificativa: justificativa,
          },
        },
      },
    ];

    const forceEnvironment =
      ambiente !== undefined
        ? ambiente === 1
          ? FiscalEnvironment.PRODUCAO
          : FiscalEnvironment.HOMOLOGACAO
        : undefined;

    // Ver comentário em sendCorrectionLetter: evento fiscal não é idempotente.
    return this.invoicyHttpService.makeRequest<InvoicyResponse[]>(
      companyId,
      'POST',
      '/senddocuments/nfe?type=Evento',
      cancelRequest,
      undefined,
      AbortSignal.timeout(this.FISCAL_EVENT_TIMEOUT_MS),
      forceEnvironment,
      true,
    );
  }

  /**
   * Send correction letter (Carta de Correção) for NF-e
   */
  async sendCorrectionLetter(
    companyId: string,
    chaveAcesso: string,
    correcao: string,
    sequenciaEvento: number = 1,
    ambiente?: number,
  ): Promise<InvoicyResponse[]> {
    this.logger.log(
      `Sending correction letter for NF-e ${chaveAcesso}, company ${companyId}`,
    );

    const correctionRequest = [
      {
        Documento: {
          ModeloDocumento: 'NFe',
          Versao: 4,
          Evento: {
            ChaveNFe: chaveAcesso,
            TipoEvento: 110110, // Carta de Correção
            nSeqEvento: sequenciaEvento,
            Correcao: correcao,
          },
        },
      },
    ];

    const forceEnvironment =
      ambiente !== undefined
        ? ambiente === 1
          ? FiscalEnvironment.PRODUCAO
          : FiscalEnvironment.HOMOLOGACAO
        : undefined;

    // Evento fiscal não é idempotente: um reenvio após timeout de leitura pode
    // registrar a mesma CC-e duas vezes na SEFAZ. O AbortSignal garante que a
    // resposta chegue dentro da janela em que o chamador ainda consegue persistir.
    return this.invoicyHttpService.makeRequest<InvoicyResponse[]>(
      companyId,
      'POST',
      '/senddocuments/nfe?type=Evento',
      correctionRequest,
      undefined,
      AbortSignal.timeout(this.FISCAL_EVENT_TIMEOUT_MS),
      forceEnvironment,
      true,
    );
  }

  /**
   * Inutilize NFC-e number range
   */
  async inutilizarNfce(
    companyId: string,
    serie: number,
    numeroInicial: number,
    numeroFinal: number,
    justificativa: string,
    invoicyConfigId?: string,
  ): Promise<InvoicyResponse[]> {
    this.logger.log(
      `Inutilizing NFC-e range ${numeroInicial}-${numeroFinal} for company ${companyId}`,
    );

    let config = invoicyConfigId
      ? await this.prisma.invoicyConfig.findUnique({
          where: { id: invoicyConfigId },
        })
      : await this.prisma.invoicyConfig.findFirst({
          where: { companyId, isDefault: true },
        });

    if (!config) {
      // orderBy determinístico para empresas com mais de um emissor.
      config = await this.prisma.invoicyConfig.findFirst({
        where: { companyId },
        orderBy: { createdAt: 'asc' },
      });
    }

    const configId = config?.id;
    if (!configId) {
      throw new Error(
        `Configuração do Invoicy não encontrada para empresa ${companyId}`,
      );
    }

    const environment =
      await this.fiscalCredentialResolver.resolveOperationalEnvironment(
        companyId,
        configId,
      );
    const credentials = await this.invoicyHttpService.getCompanyCredentials(
      companyId,
      configId,
    );

    const inutRequest = [
      {
        Documento: {
          ModeloDocumento: 'NFCe',
          Versao: 4,
          Inutilizacao: {
            Ano: new Date().getFullYear(),
            CNPJ: credentials.cnpj.replace(/\D/g, ''),
            Serie: serie,
            NumeroInicial: numeroInicial,
            NumeroFinal: numeroFinal,
            Justificativa: justificativa,
            tpAmb: environment === 'PRODUCAO' ? 1 : 2,
          },
        },
      },
    ];

    return this.invoicyHttpService.makeRequest<InvoicyResponse[]>(
      companyId,
      'POST',
      '/senddocuments/nfe?type=Inutilizacao',
      inutRequest,
      configId,
    );
  }

  /**
   * Inutilize NF-e number range (model 55)
   */
  async inutilizarNfe(
    companyId: string,
    serie: number,
    numeroInicial: number,
    numeroFinal: number,
    justificativa: string,
    invoicyConfigId?: string,
  ): Promise<InvoicyResponse[]> {
    this.logger.log(
      `Inutilizing NF-e range ${numeroInicial}-${numeroFinal} for company ${companyId}`,
    );

    let config = invoicyConfigId
      ? await this.prisma.invoicyConfig.findUnique({
          where: { id: invoicyConfigId },
        })
      : await this.prisma.invoicyConfig.findFirst({
          where: { companyId, isDefault: true },
        });

    if (!config) {
      // orderBy determinístico para empresas com mais de um emissor.
      config = await this.prisma.invoicyConfig.findFirst({
        where: { companyId },
        orderBy: { createdAt: 'asc' },
      });
    }

    const configId = config?.id;
    if (!configId) {
      throw new Error(
        `Configuração do Invoicy não encontrada para empresa ${companyId}`,
      );
    }

    const environment =
      await this.fiscalCredentialResolver.resolveOperationalEnvironment(
        companyId,
        configId,
      );
    const credentials = await this.invoicyHttpService.getCompanyCredentials(
      companyId,
      configId,
    );

    const inutRequest = [
      {
        Documento: {
          ModeloDocumento: 'NFe',
          Versao: 4,
          Inutilizacao: {
            Ano: new Date().getFullYear(),
            CNPJ: credentials.cnpj.replace(/\D/g, ''),
            Serie: serie,
            NumeroInicial: numeroInicial,
            NumeroFinal: numeroFinal,
            Justificativa: justificativa,
            tpAmb: environment === 'PRODUCAO' ? 1 : 2,
          },
        },
      },
    ];

    return this.invoicyHttpService.makeRequest<InvoicyResponse[]>(
      companyId,
      'POST',
      '/senddocuments/nfe?type=Inutilizacao',
      inutRequest,
      configId,
    );
  }

  // ============================================
  // NFS-e Operations
  // ============================================

  /**
   * Emit NFS-e document
   */
  async emitNfse(
    companyId: string,
    documents: InvoicyNfseRequest[],
  ): Promise<InvoicyResponse[]> {
    this.logger.log(`Emitting NFS-e for company ${companyId}`);

    return this.invoicyHttpService.makeRequest<InvoicyResponse[]>(
      companyId,
      'POST',
      '/senddocuments/nfse?type=Emissao',
      documents,
    );
  }

  /**
   * Cancel NFS-e document
   */
  async cancelNfse(
    companyId: string,
    numero: number,
    codigoVerificacao: string,
    motivo: string,
    ambiente?: number,
  ): Promise<InvoicyResponse[]> {
    this.logger.log(`Canceling NFS-e ${numero} for company ${companyId}`);

    const cancelRequest = [
      {
        Documento: {
          ModeloDocumento: 'NFSE',
          Versao: 1,
          Cancelamento: {
            NumeroNFSe: numero,
            CodigoVerificacao: codigoVerificacao,
            Motivo: motivo,
          },
        },
      },
    ];

    const forceEnvironment =
      ambiente !== undefined
        ? ambiente === 1
          ? FiscalEnvironment.PRODUCAO
          : FiscalEnvironment.HOMOLOGACAO
        : undefined;

    return this.invoicyHttpService.makeRequest<InvoicyResponse[]>(
      companyId,
      'POST',
      '/senddocuments/nfse?type=Evento',
      cancelRequest,
      undefined,
      undefined,
      forceEnvironment,
    );
  }

  // ============================================
  // Health Check
  // ============================================

  /**
   * Test connection to Invoicy API for a company
   */
  async testConnection(companyId: string): Promise<boolean> {
    try {
      await this.invoicyHttpService.authenticate(companyId);
      return true;
    } catch (error) {
      this.logger.error(
        `Connection test failed for company ${companyId}: ${error.message}`,
      );
      return false;
    }
  }

  // ============================================
  // Contingency Operations
  // ============================================

  /**
   * Sync contingency NFC-e to SEFAZ
   * Tries to transmit an offline NFC-e that was saved during contingency mode
   */
  async syncContingency(
    companyId: string,
    chaveOuId: string,
  ): Promise<InvoicyResponse[]> {
    this.logger.log(
      `Syncing contingency NFC-e ${chaveOuId} for company ${companyId}`,
    );

    const syncRequest = [
      {
        Documento: {
          ModeloDocumento: 'NFCe',
          Versao: 4,
          Consulta: {
            Chave: chaveOuId,
            TipoConsulta: 'Sincronizacao',
          },
        },
      },
    ];

    return this.invoicyHttpService.makeRequest<InvoicyResponse[]>(
      companyId,
      'POST',
      '/senddocuments/nfe?type=ConsultaSincronizacao',
      syncRequest,
    );
  }

  /**
   * Consulta o status real de uma NF-e específica na SEFAZ via Invoicy
   */
  async consultNfeSefaz(
    companyId: string,
    chaveAcesso: string,
    invoicyConfigId?: string,
  ): Promise<InvoicyResponse[]> {
    this.logger.log(
      `Consultando status NF-e ${chaveAcesso} para empresa ${companyId}`,
    );

    const consultRequest = [
      {
        Documento: {
          ModeloDocumento: 'NFe',
          Versao: 4,
          Consulta: {
            Chave: chaveAcesso,
            TipoConsulta: 'ConsultaChave',
          },
        },
      },
    ];

    return this.invoicyHttpService.makeRequest<InvoicyResponse[]>(
      companyId,
      'POST',
      '/senddocuments/nfe?type=ConsultaSincronizacao',
      consultRequest,
      invoicyConfigId,
    );
  }

  /**
   * Check SEFAZ availability status
   * Returns true if SEFAZ is responding, false otherwise
   */
  async checkSefazStatus(
    companyId: string,
  ): Promise<{ available: boolean; message?: string }> {
    this.logger.debug(`Checking SEFAZ status for company ${companyId}`);

    try {
      const statusRequest = [
        {
          Documento: {
            ModeloDocumento: 'NFCe',
            Versao: 4,
            Consulta: {
              TipoConsulta: 'StatusServico',
            },
          },
        },
      ];

      const response = await this.invoicyHttpService.makeRequest<
        InvoicyResponse[]
      >(
        companyId,
        'POST',
        '/senddocuments/nfe?type=StatusServico',
        statusRequest,
      );

      // Status 107 = Serviço em operação
      const isAvailable =
        response[0]?.Codigo === 107 ||
        response[0]?.Codigo === INVOICY_SUCCESS_CODES.DOCUMENTS_PROCESSED;

      return {
        available: isAvailable,
        message: response[0]?.Descricao,
      };
    } catch (error) {
      this.logger.warn(`SEFAZ status check failed: ${error.message}`);
      return {
        available: false,
        message: error.message,
      };
    }
  }
}
