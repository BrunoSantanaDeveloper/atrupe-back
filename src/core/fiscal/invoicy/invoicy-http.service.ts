import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'nestjs-prisma';
import axios, { AxiosInstance } from 'axios';
import * as jwt from 'jsonwebtoken';
import {
  InvoicyAuthResponse,
  InvoicyTokenCache,
  InvoicyEnvironment,
  InvoicyResponse,
  InvoicyNfeRequest,
  InvoicyNfseRequest,
  INVOICY_SUCCESS_CODES,
} from './invoicy.types';

@Injectable()
export class InvoicyHttpService {
  private readonly logger = new Logger(InvoicyHttpService.name);
  private readonly tokenCache = new Map<string, InvoicyTokenCache>();
  private readonly httpClient: AxiosInstance;

  // Retry configuration
  private readonly MAX_RETRIES = 3;
  private readonly INITIAL_DELAY_MS = 1000;

  // Base URLs for Invoicy API
  private readonly INVOICY_URLS = {
    HOMOLOGACAO: 'https://apibrhomolog.invoicy.com.br',
    PRODUCAO: 'https://apibr.invoicy.com.br',
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.httpClient = axios.create({
      timeout: 60000, // 60 seconds for fiscal operations
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Get base URL based on environment
   */
  private getBaseUrl(environment: InvoicyEnvironment = 'HOMOLOGACAO'): string {
    return this.INVOICY_URLS[environment] || this.INVOICY_URLS.HOMOLOGACAO;
  }

  /**
   * Get global partner key from environment
   */
  private getPartnerKey(): string {
    return this.configService.get<string>('INVOICY_PARTNER_KEY') || '';
  }

  /**
   * Get company credentials from database
   */
  async getCompanyCredentials(companyId: string) {
    const config = await this.prisma.invoicyConfig.findFirst({
      where: { companyId, isDefault: true },
      include: {
        company: true,
      },
    });

    if (!config) {
      throw new Error(
        `Configuração do Invoicy não encontrada para empresa ${companyId}`,
      );
    }

    if (!config.company?.accessKey) {
      throw new Error(
        `Chave de acesso (accessKey) não configurada para empresa ${companyId}. ` +
          `Entre em contato com o suporte para obter sua chave de acesso Invoicy.`,
      );
    }

    return {
      cnpj: config.company.cnpj || '',
      accessKey: config.company.accessKey,
      environment: (config.environment as InvoicyEnvironment) || 'HOMOLOGACAO',
    };
  }

  /**
   * Generate authentication token for a company
   * Implements JWT generation and OAuth2 authentication as per Invoicy API docs
   */
  async authenticate(companyId: string): Promise<string> {
    // Check cache first
    const cached = this.tokenCache.get(companyId);
    const now = Math.floor(Date.now() / 1000);

    // If token exists and is still valid (with 5 min buffer), return it
    if (cached && cached.expiresAt > now + 300) {
      return cached.token;
    }

    this.logger.log(
      `Generating new Invoicy token for company ${this.maskCompanyId(companyId)}`,
    );

    const credentials = await this.getCompanyCredentials(companyId);
    const partnerKey = this.getPartnerKey();

    if (!partnerKey) {
      throw new Error(
        'INVOICY_PARTNER_KEY não configurada nas variáveis de ambiente',
      );
    }

    // Generate JWT token locally as per Invoicy documentation
    // The JWT must contain: iat, exp, sub (CNPJ), and partnerKey
    const jwtPayload = {
      iat: now,
      exp: now + 120, // Maximum 120 seconds as per docs
      sub: credentials.cnpj.replace(/\D/g, ''), // CNPJ without formatting
      partnerKey: partnerKey,
    };

    this.logger.debug(
      `Generating JWT for CNPJ: ${this.maskCnpj(credentials.cnpj)}`,
    );

    // Sign the JWT with the accessKey as string
    const jwtToken = jwt.sign(jwtPayload, credentials.accessKey, {
      algorithm: 'HS256',
    });

    const baseUrl = this.getBaseUrl(credentials.environment);

    try {
      this.logger.log(
        `Authenticating with Invoicy at ${baseUrl}/oauth2/invoicy/auth`,
      );

      // Try sending JWT in body as 'token' field
      const response = await this.httpClient.post<InvoicyAuthResponse>(
        `${baseUrl}/oauth2/invoicy/auth`,
        { token: jwtToken },
        {
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );

      const { accessToken, accessTokenExpireAt } = response.data;

      // Cache the token
      this.tokenCache.set(companyId, {
        token: accessToken,
        expiresAt: accessTokenExpireAt,
        companyId,
      });

      this.logger.log(
        `Successfully authenticated with Invoicy for company ${this.maskCompanyId(companyId)}`,
      );
      return accessToken;
    } catch (error) {
      this.logger.error(
        `Failed to authenticate with Invoicy: ${error.message}`,
      );

      // Log error status without exposing sensitive data
      if (error.response) {
        this.logger.error(`Response status: ${error.response.status}`);
        // Only log error code/message, not full response
        const errorCode =
          error.response.data?.codigo || error.response.data?.code;
        const errorMsg =
          error.response.data?.mensagem || error.response.data?.message;
        if (errorCode || errorMsg) {
          this.logger.error(`Error: ${errorCode} - ${errorMsg}`);
        }
      }

      throw new Error(`Falha na autenticação com Invoicy: ${error.message}`);
    }
  }

  /**
   * Clear cached token for a company (useful when credentials change)
   */
  clearTokenCache(companyId: string): void {
    this.tokenCache.delete(companyId);
  }

  /**
   * Make authenticated request to Invoicy API with retry logic
   */
  async makeRequest<T>(
    companyId: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    data?: unknown,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        return await this.executeRequest<T>(companyId, method, endpoint, data);
      } catch (error) {
        lastError = error;

        // Don't retry client errors (4xx) except 401 (handled in executeRequest)
        if (this.isClientError(error) && error.response?.status !== 401) {
          throw error;
        }

        // Don't retry on last attempt
        if (attempt < this.MAX_RETRIES && this.isRetryableError(error)) {
          const delay = this.INITIAL_DELAY_MS * Math.pow(2, attempt - 1);
          this.logger.warn(
            `Request to ${endpoint} failed (attempt ${attempt}/${this.MAX_RETRIES}), retrying in ${delay}ms...`,
          );
          await this.delay(delay);
        }
      }
    }

    throw lastError || new Error('Request failed after retries');
  }

  /**
   * Execute a single request (without retry logic)
   */
  private async executeRequest<T>(
    companyId: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    data?: unknown,
  ): Promise<T> {
    const token = await this.authenticate(companyId);
    const credentials = await this.getCompanyCredentials(companyId);
    const baseUrl = this.getBaseUrl(credentials.environment);

    try {
      const fullUrl = `${baseUrl}${endpoint}`;
      const requestHeaders = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      };

      const response = await this.httpClient.request<T>({
        method,
        url: fullUrl,
        data,
        headers: requestHeaders,
      });

      return response.data;
    } catch (error) {
      // If unauthorized, clear cache and retry once with new token
      if (error.response?.status === 401) {
        this.logger.warn(
          `Token expired for company ${this.maskCompanyId(companyId)}, refreshing...`,
        );
        this.clearTokenCache(companyId);
        const newToken = await this.authenticate(companyId);

        const retryResponse = await this.httpClient.request<T>({
          method,
          url: `${baseUrl}${endpoint}`,
          data,
          headers: {
            Authorization: `Bearer ${newToken}`,
            'Content-Type': 'application/json',
          },
        });

        return retryResponse.data;
      }

      throw error;
    }
  }

  /**
   * Check if error is retryable (server errors, timeouts, network issues)
   */
  private isRetryableError(error: any): boolean {
    // Network errors
    if (
      error.code === 'ECONNRESET' ||
      error.code === 'ETIMEDOUT' ||
      error.code === 'ENOTFOUND'
    ) {
      return true;
    }
    // Server errors (5xx)
    if (error.response?.status >= 500) {
      return true;
    }
    // Axios timeout
    if (error.code === 'ECONNABORTED') {
      return true;
    }
    return false;
  }

  /**
   * Check if error is a client error (4xx)
   */
  private isClientError(error: any): boolean {
    return error.response?.status >= 400 && error.response?.status < 500;
  }

  /**
   * Delay execution for specified milliseconds
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Mask CNPJ for safe logging
   */
  private maskCnpj(cnpj: string): string {
    const clean = cnpj.replace(/\D/g, '');
    if (clean.length >= 8) {
      return `${clean.substring(0, 2)}.xxx.xxx/${clean.substring(8, 12)}-xx`;
    }
    return 'xx.xxx.xxx/xxxx-xx';
  }

  /**
   * Mask company ID for safe logging
   */
  private maskCompanyId(companyId: string): string {
    if (companyId.length > 8) {
      return `${companyId.substring(0, 4)}...${companyId.substring(companyId.length - 4)}`;
    }
    return '****';
  }

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

    const response = await this.makeRequest<InvoicyResponse[]>(
      companyId,
      'POST',
      '/senddocuments/nfe?type=Emissao',
      documents,
    );

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

    return this.makeRequest<InvoicyResponse[]>(
      companyId,
      'POST',
      '/nfe',
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

    return this.makeRequest<InvoicyResponse[]>(
      companyId,
      'POST',
      '/nfe',
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

    const credentials = await this.getCompanyCredentials(companyId);
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

    return this.makeRequest<InvoicyResponse[]>(
      companyId,
      'POST',
      '/nfe',
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

    return this.makeRequest<InvoicyResponse[]>(
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

    return this.makeRequest<InvoicyResponse[]>(
      companyId,
      'POST',
      '/nfse',
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
      await this.authenticate(companyId);
      return true;
    } catch (error) {
      this.logger.error(
        `Connection test failed for company ${companyId}: ${error.message}`,
      );
      return false;
    }
  }

  // ============================================
  // Partner-Level Operations (Company Registration)
  // ============================================

  /**
   * Authenticate as partner (Atrupe) to manage companies.
   * Uses the same JWT format as company auth (sub = CNPJ),
   * but with Atrupe's own CNPJ and accessKey.
   */
  async authenticateAsPartner(
    environment: InvoicyEnvironment = 'HOMOLOGACAO',
  ): Promise<string> {
    const cacheKey = `partner_${environment}`;
    const cached = this.tokenCache.get(cacheKey);
    const now = Math.floor(Date.now() / 1000);

    if (cached && cached.expiresAt > now + 300) {
      return cached.token;
    }

    const partnerKey = this.getPartnerKey();
    const accessKey = this.configService.get<string>('INVOICY_ACCESS_KEY');
    // Atrupe's own CNPJ — used as JWT sub for partner-level auth
    const partnerCnpj =
      this.configService.get<string>('INVOICY_PARTNER_CNPJ') ||
      '13205998000102';

    if (!partnerKey || !accessKey) {
      throw new Error(
        'INVOICY_PARTNER_KEY ou INVOICY_ACCESS_KEY não configuradas',
      );
    }

    // Invoicy always expects sub = CNPJ (not partnerKey)
    const jwtPayload = {
      iat: now,
      exp: now + 120,
      sub: partnerCnpj,
      partnerKey: partnerKey,
    };

    const jwtToken = jwt.sign(jwtPayload, accessKey, { algorithm: 'HS256' });
    const baseUrl = this.getBaseUrl(environment);

    try {
      const response = await this.httpClient.post<InvoicyAuthResponse>(
        `${baseUrl}/oauth2/invoicy/auth`,
        { token: jwtToken },
      );

      const { accessToken, accessTokenExpireAt } = response.data;

      this.tokenCache.set(cacheKey, {
        token: accessToken,
        expiresAt: accessTokenExpireAt,
        companyId: cacheKey,
      });

      this.logger.log('Successfully authenticated as partner with Invoicy');
      return accessToken;
    } catch (error) {
      this.logger.error(`Partner authentication failed: ${error.message}`);
      if (error.response?.data) {
        this.logger.error(
          `Invoicy error: ${JSON.stringify(error.response.data)}`,
        );
      }
      throw new Error(`Falha na autenticação de parceiro: ${error.message}`);
    }
  }

  /**
   * Register a new company in Invoicy via partner API.
   * Returns the EmpAK (Access Key) needed for future operations.
   */
  async registerCompany(data: {
    cnpj: string;
    razaoSocial: string;
    nomeFantasia?: string;
    ie?: string;
    im?: string;
    uf?: string;
    codigoIbge?: string;
    cep?: string;
    logradouro?: string;
    numero?: string;
    bairro?: string;
    cidade?: string;
    complemento?: string;
    certificate?: string;
    certificatePassword?: string;
    certificateType?: string;
  }): Promise<{ accessKey: string; cryptoKey?: string }> {
    this.logger.log(
      `Registering company ${this.maskCnpj(data.cnpj)} in Invoicy`,
    );

    // First check if company already exists
    try {
      const existing = await this.consultCompany(data.cnpj);
      if (existing?.EmpAK) {
        this.logger.log(
          'Company already registered in Invoicy, returning existing key',
        );
        return {
          accessKey: existing.EmpAK,
          cryptoKey: existing.ChaveCriptografia,
        };
      }
    } catch {
      // Company not found — proceed with registration
    }

    const token = await this.authenticateAsPartner();
    const baseUrl = this.getBaseUrl('HOMOLOGACAO');

    const payload = [
      {
        EmpCNPJ: data.cnpj.replace(/\D/g, ''),
        EmpRazSocial: data.razaoSocial,
        EmpNomFantasia: data.nomeFantasia || data.razaoSocial,
        EmpIE: data.ie || 'ISENTO',
        EmpIM: data.im || '',
        MunCodigo: data.codigoIbge || '',
        EmpEndereco: data.logradouro || '',
        EmpNumero: data.numero || 'S/N',
        EmpBairro: data.bairro || '',
        EmpCEP: data.cep?.replace(/\D/g, '') || '',
        EmpComplemento: data.complemento || '',
        ...(data.certificate
          ? {
              Certificado: {
                ArquivoPFX: data.certificate,
                Senha: data.certificatePassword || '',
                TipoCertificado: data.certificateType || 'A1',
              },
            }
          : {}),
      },
    ];

    try {
      const response = await this.httpClient.post(
        `${baseUrl}/companies`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      const result = response.data;
      this.logger.log(
        `Invoicy company registration response: ${JSON.stringify(result).substring(0, 200)}`,
      );

      // Extract EmpAK from response
      // Response structure: { Codigo, Mensagem, RetornoCadastro: [{ EmpAK, ChaveCriptografia }] }
      if (result?.RetornoCadastro?.length > 0) {
        const cadastro = result.RetornoCadastro[0];
        if (cadastro.EmpAK) {
          return {
            accessKey: cadastro.EmpAK,
            cryptoKey: cadastro.ChaveCriptografia,
          };
        }
      }

      // Handle array response format
      if (Array.isArray(result) && result.length > 0) {
        const first = result[0];
        if (first.RetornoCadastro?.length > 0) {
          const cadastro = first.RetornoCadastro[0];
          if (cadastro.EmpAK) {
            return {
              accessKey: cadastro.EmpAK,
              cryptoKey: cadastro.ChaveCriptografia,
            };
          }
        }
        // Check for success code 100
        if (first.Codigo === 100 || first.Codigo === '100') {
          // Try to get company data via GET
          const companyData = await this.consultCompany(data.cnpj);
          if (companyData?.EmpAK) {
            return {
              accessKey: companyData.EmpAK,
              cryptoKey: companyData.ChaveCriptografia,
            };
          }
        }
      }

      throw new Error(
        `Resposta inesperada do Invoicy: ${JSON.stringify(result).substring(0, 300)}`,
      );
    } catch (error) {
      if (error.response?.data) {
        this.logger.error(
          `Invoicy registration error: ${JSON.stringify(error.response.data)}`,
        );
        const msg =
          error.response.data?.Mensagem ||
          error.response.data?.message ||
          JSON.stringify(error.response.data);
        throw new Error(`Erro ao cadastrar empresa no Invoicy: ${msg}`);
      }
      throw error;
    }
  }

  /**
   * Consult company by CNPJ in Invoicy.
   */
  async consultCompany(cnpj: string): Promise<any> {
    const token = await this.authenticateAsPartner();
    const baseUrl = this.getBaseUrl('HOMOLOGACAO');
    const cleanCnpj = cnpj.replace(/\D/g, '');

    const response = await this.httpClient.get(
      `${baseUrl}/companies?CNPJ=${cleanCnpj}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );

    return response.data;
  }
}
