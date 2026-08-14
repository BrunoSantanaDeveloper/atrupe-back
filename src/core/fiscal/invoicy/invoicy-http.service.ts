import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'nestjs-prisma';
import axios, { AxiosInstance } from 'axios';
import { createHash } from 'crypto';
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
import { validatePfxCertificateCnpj } from '../utils/certificate-parser';
import { FiscalCredentialResolverService } from '../shared/fiscal-credential-resolver.service';
import { FiscalEnvironment } from '@prisma/client';

export const INVOICY_COMPANY_LINKED_TO_ANOTHER_PARTNER_MESSAGE =
  'O CNPJ ja esta cadastrado no Invoicy, mas nao esta vinculado à Atrupe. Entre em contato com o suporte para solicitar a transferencia ou liberacao da empresa junto a Migrate/Invoicy.';

@Injectable()
export class InvoicyHttpService {
  private readonly logger = new Logger(InvoicyHttpService.name);
  private readonly tokenCache = new Map<string, InvoicyTokenCache>();
  private readonly httpClient: AxiosInstance;

  // Retry configuration
  private readonly MAX_RETRIES = 3;
  private readonly INITIAL_DELAY_MS = 1000;
  /** Rate limit pede espera maior que uma falha de rede. */
  private readonly RATE_LIMIT_BASE_DELAY_MS = 3000;
  private readonly MAX_RATE_LIMIT_DELAY_MS = 20000;

  // Base URLs for Invoicy API
  private readonly INVOICY_URLS = {
    HOMOLOGACAO: 'https://apibrhomolog.invoicy.com.br',
    PRODUCAO: 'https://apibr.invoicy.com.br',
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly fiscalCredentialResolver: FiscalCredentialResolverService,
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

  private getPartnerEnvironment(): InvoicyEnvironment {
    const environment = this.configService.get<string>('INVOICY_ENVIRONMENT');
    return environment === 'PRODUCAO' ? 'PRODUCAO' : 'HOMOLOGACAO';
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
  async getCompanyCredentials(
    companyId: string,
    invoicyConfigId?: string,
    forceEnvironment?: FiscalEnvironment,
    docType?: 'NFE' | 'NFSE' | 'NFCE',
  ) {
    let environment: FiscalEnvironment;

    if (forceEnvironment) {
      environment = forceEnvironment;
    } else if (invoicyConfigId) {
      environment =
        await this.fiscalCredentialResolver.resolveOperationalEnvironment(
          companyId,
          invoicyConfigId,
          docType,
        );
    } else {
      let config = await this.prisma.invoicyConfig.findFirst({
        where: { companyId, isDefault: true },
      });
      if (!config) {
        // orderBy determinístico: sem ele, empresas com mais de um emissor
        // podem resolver credenciais de emissores diferentes entre chamadas.
        config = await this.prisma.invoicyConfig.findFirst({
          where: { companyId },
          orderBy: { createdAt: 'asc' },
        });
      }
      if (config) {
        // Sem docType a precedência pula os campos por documento e cai no
        // campo global activeEnvironment, que a ativação de QUALQUER docType
        // sobrescreve. Era assim que o host do transporte podia divergir do
        // ambiente com que o documento foi montado.
        environment =
          await this.fiscalCredentialResolver.resolveOperationalEnvironment(
            companyId,
            config.id,
            docType,
          );
      } else {
        environment = FiscalEnvironment.HOMOLOGACAO;
      }
    }

    const runtimeCreds =
      await this.fiscalCredentialResolver.getCompanyRuntimeCredentials(
        companyId,
        environment,
      );

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { cnpj: true },
    });

    if (!runtimeCreds.accessKey) {
      throw new Error(
        `Chave de acesso (accessKey) não configurada para empresa ${companyId} no ambiente ${environment}. ` +
          `Entre em contato com o suporte para obter sua chave de acesso Invoicy.`,
      );
    }

    return {
      cnpj: company?.cnpj || '',
      accessKey: runtimeCreds.accessKey,
      environment: environment as InvoicyEnvironment,
    };
  }

  /**
   * Generate authentication token for a company
   * Implements JWT generation and OAuth2 authentication as per Invoicy API docs
   */
  async authenticate(
    companyId: string,
    invoicyConfigId?: string,
    signal?: AbortSignal,
    forceEnvironment?: FiscalEnvironment,
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const credentials = await this.getCompanyCredentials(
      companyId,
      invoicyConfigId,
      forceEnvironment,
    );
    const credentialsHash = this.getCredentialsHash(credentials);
    const cacheKey = `${companyId}:${credentials.environment}`;
    const cached = this.tokenCache.get(cacheKey);

    // If token exists and is still valid (with 5 min buffer), return it
    if (
      cached &&
      cached.expiresAt > now + 300 &&
      cached.credentialsHash === credentialsHash
    ) {
      return cached.token;
    }

    this.logger.log(
      `Generating new Invoicy token for company ${this.maskCompanyId(companyId)}`,
    );

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
          signal,
        },
      );

      const { accessToken, accessTokenExpireAt } = response.data;

      // Cache the token
      this.tokenCache.set(cacheKey, {
        token: accessToken,
        expiresAt: accessTokenExpireAt,
        companyId,
        credentialsHash,
      });

      this.logger.log(
        `Successfully authenticated with Invoicy for company ${this.maskCompanyId(companyId)}`,
      );
      return accessToken;
    } catch (error) {
      // Sanitização: nunca logar message bruta nem corpo da resposta (podem conter
      // credenciais ou tokens). Logar apenas status HTTP + códigos estruturados.
      const status = error.response?.status;
      const errorCode =
        error.response?.data?.codigo || error.response?.data?.code;
      const errorMsg =
        error.response?.data?.mensagem || error.response?.data?.message;
      this.logger.error(
        `Failed to authenticate with Invoicy (status ${status ?? 'n/a'})` +
          (errorCode || errorMsg
            ? `: ${errorCode ?? ''} ${errorMsg ?? ''}`.trim()
            : ''),
      );
      throw new Error(
        `Falha na autenticação com Invoicy (${status ?? 'n/a'})` +
          (errorCode ? `: ${errorCode}` : ''),
      );
    }
  }

  /**
   * Clear cached token for a company (useful when credentials change)
   */
  clearTokenCache(companyId: string, environment?: InvoicyEnvironment): void {
    if (environment) {
      this.tokenCache.delete(`${companyId}:${environment}`);
    } else {
      this.tokenCache.delete(`${companyId}:HOMOLOGACAO`);
      this.tokenCache.delete(`${companyId}:PRODUCAO`);
    }
  }

  private getCredentialsHash(credentials: {
    cnpj: string;
    accessKey: string;
    environment: InvoicyEnvironment;
  }): string {
    return createHash('sha256')
      .update(
        [
          credentials.cnpj.replace(/\D/g, ''),
          credentials.accessKey,
          credentials.environment,
        ].join('|'),
      )
      .digest('hex');
  }

  /**
   * Make authenticated request to Invoicy API with retry logic
   *
   * `disableRetry` deve ser usado em TODA escrita fiscal não idempotente
   * (eventos, emissão, inutilização): o payload não carrega chave de
   * idempotência, então reenviar após um timeout de leitura pode duplicar um
   * documento que a SEFAZ já processou.
   */
  async makeRequest<T>(
    companyId: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    data?: unknown,
    invoicyConfigId?: string,
    signal?: AbortSignal,
    forceEnvironment?: FiscalEnvironment,
    disableRetry = false,
  ): Promise<T> {
    let lastError: Error | null = null;

    // O teto do laço é sempre MAX_RETRIES; `disableRetry` é decidido DENTRO do
    // catch, porque só ali se sabe se a falha foi um rate limit — o único caso
    // em que uma escrita não idempotente pode ser repetida.
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        return await this.executeRequest<T>(
          companyId,
          method,
          endpoint,
          data,
          invoicyConfigId,
          signal,
          forceEnvironment,
        );
      } catch (error) {
        lastError = error;

        // Don't retry client errors (4xx) except 401 (handled in executeRequest)
        // e 429 (rate limit), tratado logo abaixo.
        if (
          this.isClientError(error) &&
          error.response?.status !== 401 &&
          !this.isRateLimited(error)
        ) {
          // Sanitização: não serializar o corpo da resposta (pode conter tokens/EmpAK).
          const errCode =
            error.response?.data?.codigo || error.response?.data?.code;
          const errMsg =
            error.response?.data?.mensagem || error.response?.data?.message;
          this.logger.error(
            `Request failed with client error ${error.response?.status}` +
              (errCode || errMsg
                ? `: ${errCode ?? ''} ${errMsg ?? ''}`.trim()
                : ''),
          );
          throw error;
        }

        // 429 é a única falha que uma escrita fiscal não idempotente pode
        // repetir: o provedor RECUSOU a requisição antes de processá-la, então
        // o documento não chegou à SEFAZ. Timeout e 5xx seguem barrados por
        // `disableRetry` — ali a nota pode ter sido processada sem a resposta
        // voltar, e reenviar duplicaria o documento.
        const rateLimited = this.isRateLimited(error);
        if (disableRetry && !rateLimited) {
          throw error;
        }

        if (attempt < this.MAX_RETRIES) {
          const delay = rateLimited
            ? this.rateLimitDelay(error, attempt)
            : this.INITIAL_DELAY_MS * Math.pow(2, attempt - 1);
          this.logger.warn(
            `Request failed (attempt ${attempt}/${this.MAX_RETRIES})${
              rateLimited ? ' — rate limit do provedor' : ''
            }. Retrying in ${delay}ms...`,
          );
          if (signal?.aborted) {
            throw new Error('AbortError');
          }
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, delay);
            signal?.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                reject(new Error('AbortError'));
              },
              { once: true },
            );
          });
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
    invoicyConfigId?: string,
    signal?: AbortSignal,
    forceEnvironment?: FiscalEnvironment,
  ): Promise<T> {
    const token = await this.authenticate(
      companyId,
      invoicyConfigId,
      signal,
      forceEnvironment,
    );
    const credentials = await this.getCompanyCredentials(
      companyId,
      invoicyConfigId,
      forceEnvironment,
    );
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
        signal,
      });

      return response.data;
    } catch (error) {
      // If unauthorized, clear cache and retry once with new token
      if (error.response?.status === 401) {
        this.logger.warn(
          `Token expired for company ${this.maskCompanyId(companyId)} in environment ${credentials.environment}, refreshing...`,
        );
        this.clearTokenCache(companyId, credentials.environment);
        const newToken = await this.authenticate(
          companyId,
          invoicyConfigId,
          signal,
          forceEnvironment,
        );

        const fullUrl = `${baseUrl}${endpoint}`;
        const requestHeaders = {
          Authorization: `Bearer ${newToken}`,
          'Content-Type': 'application/json',
        };

        const response = await this.httpClient.request<T>({
          method,
          url: fullUrl,
          data,
          headers: requestHeaders,
          signal,
        });

        return response.data;
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
   * 429: o provedor recusou a requisição por excesso de chamadas.
   *
   * É o único 4xx que pede repetição — a semântica do status é "volte mais
   * tarde", não "seu pedido está errado". Tratá-lo como erro definitivo fazia a
   * emissão desistir na primeira recusa e devolver ao usuário um
   * "Request failed with status code 429", sem usar o backoff que já existe
   * aqui.
   */
  private isRateLimited(error: any): boolean {
    return error.response?.status === 429;
  }

  /**
   * Espera antes de repetir uma chamada barrada por rate limit.
   *
   * Prefere o `Retry-After` do provedor (segundos ou data HTTP). Sem ele, cai
   * num backoff mais largo que o padrão: janela de rate limit costuma ser de
   * dezenas de segundos, e 1s/2s só queimaria as tentativas restantes.
   */
  private rateLimitDelay(error: any, attempt: number): number {
    const header =
      error.response?.headers?.['retry-after'] ??
      error.response?.headers?.['Retry-After'];

    if (header !== undefined) {
      const seconds = Number(header);
      if (Number.isFinite(seconds) && seconds > 0) {
        return Math.min(seconds * 1000, this.MAX_RATE_LIMIT_DELAY_MS);
      }

      const retryAt = new Date(String(header)).getTime();
      if (Number.isFinite(retryAt)) {
        const wait = retryAt - Date.now();
        if (wait > 0) return Math.min(wait, this.MAX_RATE_LIMIT_DELAY_MS);
      }
    }

    return Math.min(
      this.RATE_LIMIT_BASE_DELAY_MS * Math.pow(2, attempt - 1),
      this.MAX_RATE_LIMIT_DELAY_MS,
    );
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
      await this.authenticate(companyId);
      return true;
    } catch {
      this.logger.error(
        `Connection test failed for company ${this.maskCompanyId(companyId)}`,
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
    environment?: InvoicyEnvironment,
    signal?: AbortSignal,
  ): Promise<string> {
    const selectedEnvironment = environment || this.getPartnerEnvironment();
    const cacheKey = `partner_${selectedEnvironment}`;
    const cached = this.tokenCache.get(cacheKey);
    const now = Math.floor(Date.now() / 1000);

    if (cached && cached.expiresAt > now + 300) {
      return cached.token;
    }

    const partnerKey = this.getPartnerKey();
    const accessKey = this.configService.get<string>('INVOICY_ACCESS_KEY');

    if (!partnerKey || !accessKey) {
      throw new Error(
        'INVOICY_PARTNER_KEY ou INVOICY_ACCESS_KEY não configuradas',
      );
    }

    // Invoicy Docs: Para Autenticação como Parceiro Mestre, o 'sub' DEVE ser a
    // Chave de Parceiro, e não devemos enviar a prop 'partnerKey'.
    const jwtPayload = {
      iat: now,
      exp: now + 120,
      sub: partnerKey,
    };

    const jwtToken = jwt.sign(jwtPayload, accessKey, { algorithm: 'HS256' });
    const baseUrl = this.getBaseUrl(selectedEnvironment);

    try {
      const response = await this.httpClient.post<InvoicyAuthResponse>(
        `${baseUrl}/oauth2/invoicy/auth`,
        { token: jwtToken },
        signal ? { signal } : undefined,
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
      // Sanitização: nunca serializar o corpo da resposta (pode conter tokens/EmpAK).
      // Logar apenas status e o código/mensagem de erro estruturados, se houver.
      const status = error.response?.status;
      const errorCode =
        error.response?.data?.codigo || error.response?.data?.code;
      const errorMsg =
        error.response?.data?.mensagem || error.response?.data?.message;
      this.logger.error(
        `Partner authentication failed (status ${status ?? 'n/a'})` +
          (errorCode || errorMsg
            ? `: ${errorCode ?? ''} ${errorMsg ?? ''}`.trim()
            : ''),
      );
      throw new Error(
        `Falha na autenticação de parceiro (${status ?? 400})` +
          (errorCode ? `: ${errorCode}` : ''),
      );
    }
  }

  private extractCompanyAccessKey(
    payload: any,
  ): { accessKey: string; cryptoKey?: string } | null {
    const queue = [payload];
    let inspected = 0;

    while (queue.length > 0 && inspected < 100) {
      inspected++;
      const current = queue.shift();

      if (!current) continue;

      if (Array.isArray(current)) {
        queue.push(...current);
        continue;
      }

      if (typeof current !== 'object') continue;

      const accessKey = current.EmpAK || current.accessKey || current.AccessKey;
      if (accessKey) {
        return {
          accessKey,
          cryptoKey:
            current.ChaveCriptografia || current.cryptoKey || current.CryptoKey,
        };
      }

      for (const value of Object.values(current)) {
        if (value && (typeof value === 'object' || Array.isArray(value))) {
          queue.push(value);
        }
      }
    }

    return null;
  }

  private hasSuccessCode(payload: any): boolean {
    const queue = [payload];
    let inspected = 0;

    while (queue.length > 0 && inspected < 100) {
      inspected++;
      const current = queue.shift();

      if (!current) continue;

      if (Array.isArray(current)) {
        queue.push(...current);
        continue;
      }

      if (typeof current !== 'object') continue;

      if (current.Codigo === 100 || current.Codigo === '100') return true;

      for (const value of Object.values(current)) {
        if (value && (typeof value === 'object' || Array.isArray(value))) {
          queue.push(value);
        }
      }
    }

    return false;
  }

  private getRegistrationRejection(payload: any): string | null {
    const queue = [payload];
    let inspected = 0;

    while (queue.length > 0 && inspected < 100) {
      inspected++;
      const current = queue.shift();

      if (!current) continue;

      if (Array.isArray(current)) {
        queue.push(...current);
        continue;
      }

      if (typeof current !== 'object') continue;

      if (
        current.Descricao &&
        current.Codigo !== 100 &&
        current.Codigo !== '100'
      ) {
        return `Codigo ${current.Codigo}: ${current.Descricao}`;
      }

      for (const value of Object.values(current)) {
        if (value && (typeof value === 'object' || Array.isArray(value))) {
          queue.push(value);
        }
      }
    }

    return null;
  }

  private isCompanyAlreadyRegisteredRejection(payload: any): boolean {
    const queue = [payload];
    let inspected = 0;

    while (queue.length > 0 && inspected < 100) {
      inspected++;
      const current = queue.shift();

      if (!current) continue;

      if (Array.isArray(current)) {
        queue.push(...current);
        continue;
      }

      if (typeof current !== 'object') {
        if (this.hasCompanyAlreadyRegisteredText(String(current))) return true;
        continue;
      }

      const text = [
        current.Mensagem,
        current.message,
        current.Descricao,
        current.description,
        current.Erro,
        current.error,
      ]
        .filter(Boolean)
        .join(' ');

      if (this.hasCompanyAlreadyRegisteredText(text)) return true;

      for (const value of Object.values(current)) {
        if (value && (typeof value === 'object' || Array.isArray(value))) {
          queue.push(value);
        } else if (
          value &&
          this.hasCompanyAlreadyRegisteredText(String(value))
        ) {
          return true;
        }
      }
    }

    return false;
  }

  private hasCompanyAlreadyRegisteredText(value: string): boolean {
    const text = value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    return (
      text.includes('cnpj') &&
      (text.includes('ja cadastr') ||
        text.includes('empresa cadastr') ||
        text.includes('ja existe') ||
        text.includes('already registered') ||
        text.includes('already exists') ||
        text.includes('duplicate'))
    );
  }

  private isCompanyNotFoundError(error: any): boolean {
    const status = error?.response?.status;
    if (status === 404) return true;

    const payload = error?.response?.data;
    const text =
      typeof payload === 'string'
        ? payload.toLowerCase()
        : JSON.stringify(payload || {}).toLowerCase();

    return (
      text.includes('nao encontr') ||
      text.includes('não encontr') ||
      text.includes('not found') ||
      text.includes('inexistente')
    );
  }

  private ensureCertificateMatchesCnpj(
    certificate: string,
    certificatePassword: string,
    cnpj: string,
  ) {
    const validation = validatePfxCertificateCnpj(
      certificate,
      certificatePassword,
      cnpj,
    );

    if (!validation.valid) {
      throw new Error(validation.message);
    }
  }

  /**
   * Autentica usando as credenciais do ambiente especificado (sem fallback legado).
   * Usado pelo readiness/activation para validar o ambiente correto.
   */
  async authenticateForEnvironment(
    companyId: string,
    cnpj: string,
    environment: FiscalEnvironment,
    signal?: AbortSignal,
  ): Promise<string> {
    const partnerKey = this.getPartnerKey();
    if (!partnerKey) {
      throw new Error('INVOICY_PARTNER_KEY não configurada');
    }

    const creds =
      await this.fiscalCredentialResolver.getCompanyCredentialsForValidation(
        companyId,
        environment,
      );

    if (!creds.accessKey) {
      throw new Error(
        `Access key não configurada para ambiente ${environment}`,
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const jwtPayload = {
      iat: now,
      exp: now + 120,
      sub: cnpj.replace(/\D/g, ''),
      partnerKey,
    };

    const jwtToken = jwt.sign(jwtPayload, creds.accessKey, {
      algorithm: 'HS256',
    });
    const baseUrl = this.getBaseUrl(environment as InvoicyEnvironment);

    const response = await axios.post<InvoicyAuthResponse>(
      `${baseUrl}/oauth2/invoicy/auth`,
      { token: jwtToken },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 60000,
        signal,
      },
    );

    return response.data.accessToken;
  }

  /**
   * Valida uma access key BRUTA (ainda não persistida) contra o Invoicy,
   * autenticando no ambiente informado sem ler/gravar credenciais no banco.
   *
   * Retorna `true` se a autenticação for aceita. Lança erro em caso de
   * indisponibilidade/erro de rede (para que o chamador NÃO substitua uma
   * chave válida por causa de falha transitória). Retorna `false` apenas
   * quando o provider rejeita a credencial (status 4xx de autenticação).
   */
  async validateRawAccessKey(
    cnpj: string,
    environment: FiscalEnvironment,
    accessKey: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const partnerKey = this.getPartnerKey();
    if (!partnerKey) {
      throw new Error('INVOICY_PARTNER_KEY não configurada');
    }
    if (!accessKey) {
      return false;
    }

    const now = Math.floor(Date.now() / 1000);
    const jwtPayload = {
      iat: now,
      exp: now + 120,
      sub: cnpj.replace(/\D/g, ''),
      partnerKey,
    };
    const jwtToken = jwt.sign(jwtPayload, accessKey, { algorithm: 'HS256' });
    const baseUrl = this.getBaseUrl(environment as InvoicyEnvironment);

    try {
      const response = await axios.post<InvoicyAuthResponse>(
        `${baseUrl}/oauth2/invoicy/auth`,
        { token: jwtToken },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 60000,
          signal,
        },
      );
      return !!response.data?.accessToken;
    } catch (error) {
      const status = error.response?.status;
      // Credencial rejeitada pelo provider → chave inválida (não é falha transitória).
      if (status === 400 || status === 401 || status === 403) {
        return false;
      }
      // Indisponibilidade/erro inesperado: propagar para não substituir chave válida.
      throw error;
    }
  }

  /**
   * Verifica se a empresa já está cadastrada no Invoicy no ambiente especificado.
   * Retorna true se encontrada, false se não encontrada.
   */
  async companyExistsInEnvironment(
    cnpj: string,
    environment: FiscalEnvironment,
    signal?: AbortSignal,
  ): Promise<boolean> {
    try {
      const existing = await this.consultCompany(
        cnpj,
        environment as InvoicyEnvironment,
        signal,
      );
      return !!this.extractCompanyAccessKey(existing);
    } catch (error) {
      if (this.isCompanyNotFoundError(error)) return false;
      throw error;
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
    environment?: InvoicyEnvironment;
    signal?: AbortSignal;
  }): Promise<{
    accessKey: string;
    cryptoKey?: string;
    environment: InvoicyEnvironment;
  }> {
    const environment = data.environment || this.getPartnerEnvironment();

    this.logger.log(
      `Registering company ${this.maskCnpj(data.cnpj)} in Invoicy (${environment})`,
    );

    if (data.certificate) {
      this.ensureCertificateMatchesCnpj(
        data.certificate,
        data.certificatePassword || '',
        data.cnpj,
      );
    }

    // First check if company already exists
    try {
      const existing = await this.consultCompany(
        data.cnpj,
        environment,
        data.signal,
      );
      const existingCredentials = this.extractCompanyAccessKey(existing);
      if (existingCredentials) {
        this.logger.log(
          'Company already registered in Invoicy, returning existing key',
        );
        if (data.certificate) {
          await this.updateCompanyCertificate({
            cnpj: data.cnpj,
            certificate: data.certificate,
            certificatePassword: data.certificatePassword || '',
            certificateType: data.certificateType,
            environment,
            signal: data.signal,
          });
        }
        return {
          ...existingCredentials,
          environment,
        };
      }
    } catch (error) {
      if (!this.isCompanyNotFoundError(error)) {
        throw error;
      }
      // Company not found — proceed with registration
    }

    const token = await this.authenticateAsPartner(environment, data.signal);
    const baseUrl = this.getBaseUrl(environment);

    const payload = [
      {
        EmpCNPJ: data.cnpj.replace(/\D/g, ''),
        EmpRazSocial: data.razaoSocial,
        EmpNomFantasia: data.nomeFantasia || data.razaoSocial,
        EmpApelido: data.nomeFantasia || data.razaoSocial.substring(0, 50),
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
          ...(data.signal ? { signal: data.signal } : {}),
        },
      );

      const result = response.data;
      this.logger.log(
        `Invoicy company registration response: Codigo=${result?.Codigo} Mensagem=${result?.Mensagem}`,
      );

      const credentials = this.extractCompanyAccessKey(result);
      if (credentials) {
        return { ...credentials, environment };
      }

      const rejection = this.getRegistrationRejection(result);
      if (rejection) {
        if (this.isCompanyAlreadyRegisteredRejection(result)) {
          throw new BadRequestException(
            INVOICY_COMPANY_LINKED_TO_ANOTHER_PARTNER_MESSAGE,
          );
        }
        throw new Error(`Invoicy rejeitou o cadastro. ${rejection}`);
      }

      if (this.hasSuccessCode(result)) {
        // Some Invoicy responses confirm the registration without returning EmpAK.
        // In that case, consult the company right away before falling back to review.
        const companyData = await this.consultCompany(
          data.cnpj,
          environment,
          data.signal,
        );
        const consultedCredentials = this.extractCompanyAccessKey(companyData);
        if (consultedCredentials) {
          return { ...consultedCredentials, environment };
        }
      }

      // Extract EmpAK from response
      // Response structure: { Codigo, Mensagem, RetornoCadastro: [{ EmpAK, ChaveCriptografia }] }
      if (result?.RetornoCadastro?.length > 0) {
        const cadastro = result.RetornoCadastro[0];
        if (cadastro.EmpAK) {
          return {
            accessKey: cadastro.EmpAK,
            cryptoKey: cadastro.ChaveCriptografia,
            environment,
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
              environment,
            };
          }
          // Se não tem EmpAK e tem Descricao de erro (ex: 101)
          if (cadastro.Descricao) {
            if (this.isCompanyAlreadyRegisteredRejection(cadastro)) {
              throw new BadRequestException(
                INVOICY_COMPANY_LINKED_TO_ANOTHER_PARTNER_MESSAGE,
              );
            }
            throw new Error(
              `Invoicy rejeitou o cadastro. Código ${cadastro.Codigo}: ${cadastro.Descricao}`,
            );
          }
        }
        // Check for success code 100
        if (first.Codigo === 100 || first.Codigo === '100') {
          // Try to get company data via GET
          const companyData = await this.consultCompany(
            data.cnpj,
            environment,
            data.signal,
          );
          if (companyData?.EmpAK) {
            return {
              accessKey: companyData.EmpAK,
              cryptoKey: companyData.ChaveCriptografia,
              environment,
            };
          }
        }
      }

      // Nunca serializar `result` inteiro: pode conter EmpAK/ChaveCriptografia (segredos).
      throw new Error(
        `Resposta inesperada do Invoicy ao cadastrar empresa (Codigo=${
          result?.Codigo ??
          (Array.isArray(result) ? result[0]?.Codigo : undefined)
        })`,
      );
    } catch (error) {
      if (error.response?.data) {
        this.logger.error(
          `Invoicy registration error: Codigo=${error.response.data?.Codigo} Mensagem=${error.response.data?.Mensagem}`,
        );
        if (this.isCompanyAlreadyRegisteredRejection(error.response.data)) {
          throw new BadRequestException(
            INVOICY_COMPANY_LINKED_TO_ANOTHER_PARTNER_MESSAGE,
          );
        }
        const msg =
          error.response.data?.Mensagem ||
          error.response.data?.message ||
          'Erro desconhecido';
        throw new Error(`Erro ao cadastrar empresa no Invoicy: ${msg}`);
      }
      throw error;
    }
  }

  /**
   * Consult company by CNPJ in Invoicy.
   */
  async consultCompany(
    cnpj: string,
    environment?: InvoicyEnvironment,
    signal?: AbortSignal,
  ): Promise<any> {
    const selectedEnvironment = environment || this.getPartnerEnvironment();
    const token = await this.authenticateAsPartner(selectedEnvironment, signal);
    const baseUrl = this.getBaseUrl(selectedEnvironment);
    const cleanCnpj = cnpj.replace(/\D/g, '');

    const response = await this.httpClient.get(
      `${baseUrl}/companies?CNPJ=${cleanCnpj}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        signal,
      },
    );

    return response.data;
  }

  /**
   * Sincroniza os dados cadastrais da empresa no Invoicy.
   *
   * registerCompany so' envia esses campos na CRIACAO: se a empresa ja' existe,
   * ele devolve a chave e sai. Sem este metodo, razao social, IE e endereco
   * congelam no valor que estavam quando o cadastro nasceu — e documentos que o
   * Invoicy monta a partir do cadastro (DACCE, por exemplo) saem com campos em
   * branco mesmo com o dado correto no nosso banco.
   */
  async updateCompanyRegistration(data: {
    cnpj: string;
    razaoSocial: string;
    nomeFantasia?: string;
    ie?: string;
    im?: string;
    codigoIbge?: string;
    cep?: string;
    logradouro?: string;
    numero?: string;
    bairro?: string;
    complemento?: string;
    environment?: InvoicyEnvironment;
    signal?: AbortSignal;
  }): Promise<void> {
    const environment = data.environment || this.getPartnerEnvironment();

    if (!data.razaoSocial?.trim()) {
      // Sobrescrever o cadastro com vazio e' pior que deixá-lo desatualizado.
      throw new BadRequestException(
        'Razão social é obrigatória para sincronizar o cadastro no Invoicy',
      );
    }

    this.logger.log(
      `Sincronizando cadastro da empresa ${this.maskCnpj(data.cnpj)} no Invoicy (${environment})`,
    );

    const token = await this.authenticateAsPartner(environment, data.signal);
    const baseUrl = this.getBaseUrl(environment);

    const payload = [
      {
        EmpCNPJ: data.cnpj.replace(/\D/g, ''),
        EmpRazSocial: data.razaoSocial,
        EmpNomFantasia: data.nomeFantasia || data.razaoSocial,
        EmpApelido: data.nomeFantasia || data.razaoSocial.substring(0, 50),
        EmpIE: data.ie || 'ISENTO',
        EmpIM: data.im || '',
        MunCodigo: data.codigoIbge || '',
        EmpEndereco: data.logradouro || '',
        EmpNumero: data.numero || 'S/N',
        EmpBairro: data.bairro || '',
        EmpCEP: data.cep?.replace(/\D/g, '') || '',
        EmpComplemento: data.complemento || '',
      },
    ];

    try {
      await this.httpClient.put(`${baseUrl}/companies`, payload, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        ...(data.signal ? { signal: data.signal } : {}),
      });

      this.logger.log(
        `Cadastro sincronizado no Invoicy para ${this.maskCnpj(data.cnpj)}`,
      );
    } catch (error) {
      const status = error.response?.status;
      const errorCode =
        error.response?.data?.Codigo ||
        error.response?.data?.codigo ||
        error.response?.data?.code;
      this.logger.error(
        `Falha ao sincronizar cadastro no Invoicy (status ${status ?? 'n/a'})` +
          (errorCode ? `: ${errorCode}` : ''),
      );
      throw new Error(
        `Erro ao sincronizar cadastro no Invoicy (${errorCode ?? status ?? 'PROVIDER_ERROR'})`,
      );
    }
  }

  /**
   * Update digital certificate for an already-registered company in Invoicy.
   * Uses the partner PUT /companies endpoint to update company data including certificate.
   */
  async updateCompanyCertificate(data: {
    cnpj: string;
    certificate: string;
    certificatePassword: string;
    certificateType?: string;
    environment?: InvoicyEnvironment;
    signal?: AbortSignal;
  }): Promise<void> {
    const environment = data.environment || this.getPartnerEnvironment();

    this.logger.log(
      `Updating certificate for company ${this.maskCnpj(data.cnpj)} in Invoicy (${environment})`,
    );

    this.ensureCertificateMatchesCnpj(
      data.certificate,
      data.certificatePassword,
      data.cnpj,
    );

    const token = await this.authenticateAsPartner(environment, data.signal);
    const baseUrl = this.getBaseUrl(environment);

    const payload = [
      {
        EmpCNPJ: data.cnpj.replace(/\D/g, ''),
        Certificado: {
          ArquivoPFX: data.certificate,
          Senha: data.certificatePassword,
          TipoCertificado: data.certificateType || 'A1',
        },
      },
    ];

    try {
      await this.httpClient.put(`${baseUrl}/companies`, payload, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        ...(data.signal ? { signal: data.signal } : {}),
      });

      this.logger.log(
        `Certificate updated successfully for ${this.maskCnpj(data.cnpj)}`,
      );
    } catch (error) {
      const status = error.response?.status;
      const errorCode =
        error.response?.data?.Codigo ||
        error.response?.data?.codigo ||
        error.response?.data?.code;
      this.logger.error(
        `Failed to update certificate (status ${status ?? 'n/a'})` +
          (errorCode ? `: ${errorCode}` : ''),
      );
      throw new Error(
        `Erro ao atualizar certificado no Invoicy (${errorCode ?? status ?? 'PROVIDER_ERROR'})`,
      );
    }
  }
}
