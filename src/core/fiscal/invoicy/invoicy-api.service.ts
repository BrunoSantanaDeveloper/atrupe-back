import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { InvoicyHttpService } from './invoicy-http.service';
import {
  InvoicyResponse,
  InvoicyNfeRequest,
  InvoicyNfseRequest,
  INVOICY_SUCCESS_CODES,
} from './invoicy.types';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoicyHttpService: InvoicyHttpService,
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
  ): Promise<InvoicyResponse[]> {
    this.logger.log(`Emitting NF-e/NFC-e for company ${companyId}`);

    const response = await this.invoicyHttpService.makeRequest<
      InvoicyResponse[]
    >(companyId, 'POST', '/senddocuments/nfe?type=Emissao', documents);

    // Check for errors in response
    if (
      response.length > 0 &&
      response[0].Codigo !== INVOICY_SUCCESS_CODES.DOCUMENTS_PROCESSED
    ) {
      this.logger.warn(
        `Invoicy returned non-success code: ${response[0].Codigo}`,
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
            Justificativa: justificativa,
          },
        },
      },
    ];

    return this.invoicyHttpService.makeRequest<InvoicyResponse[]>(
      companyId,
      'POST',
      '/senddocuments/nfe?type=Evento',
      cancelRequest,
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

    return this.invoicyHttpService.makeRequest<InvoicyResponse[]>(
      companyId,
      'POST',
      '/senddocuments/nfe?type=Evento',
      correctionRequest,
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
  ): Promise<InvoicyResponse[]> {
    this.logger.log(
      `Inutilizing NFC-e range ${numeroInicial}-${numeroFinal} for company ${companyId}`,
    );

    const credentials =
      await this.invoicyHttpService.getCompanyCredentials(companyId);
    const config = await this.prisma.invoicyConfig.findFirst({
      where: { companyId, isDefault: true },
    });

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
            tpAmb: config?.ambiente || 2,
          },
        },
      },
    ];

    return this.invoicyHttpService.makeRequest<InvoicyResponse[]>(
      companyId,
      'POST',
      '/senddocuments/nfe?type=Inutilizacao',
      inutRequest,
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
  ): Promise<InvoicyResponse[]> {
    this.logger.log(
      `Inutilizing NF-e range ${numeroInicial}-${numeroFinal} for company ${companyId}`,
    );

    const credentials =
      await this.invoicyHttpService.getCompanyCredentials(companyId);
    const config = await this.prisma.invoicyConfig.findFirst({
      where: { companyId, isDefault: true },
    });

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
            tpAmb: config?.ambiente || 2,
          },
        },
      },
    ];

    return this.invoicyHttpService.makeRequest<InvoicyResponse[]>(
      companyId,
      'POST',
      '/senddocuments/nfe?type=Inutilizacao',
      inutRequest,
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

    return this.invoicyHttpService.makeRequest<InvoicyResponse[]>(
      companyId,
      'POST',
      '/senddocuments/nfse?type=Evento',
      cancelRequest,
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
