import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'nestjs-prisma';
import axios, { AxiosInstance } from 'axios';
import {
    InvoicyAuthRequest,
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
        const config = await this.prisma.invoicyConfig.findUnique({
            where: { companyId },
        });

        if (!config) {
            throw new Error(
                `Configuração do Invoicy não encontrada para empresa ${companyId}`,
            );
        }

        if (!config.accessKey) {
            throw new Error(
                `Chave de acesso (accessKey) não configurada para empresa ${companyId}. ` +
                `Entre em contato com o suporte para obter sua chave de acesso Invoicy.`,
            );
        }

        return {
            cnpj: config.emitCnpj || '',
            accessKey: config.accessKey,
            environment: (config.environment as InvoicyEnvironment) || 'HOMOLOGACAO',
        };
    }

    /**
     * Generate authentication token for a company
     * Implements token caching to avoid unnecessary API calls
     */
    async authenticate(companyId: string): Promise<string> {
        // Check cache first
        const cached = this.tokenCache.get(companyId);
        const now = Math.floor(Date.now() / 1000);

        // If token exists and is still valid (with 5 min buffer), return it
        if (cached && cached.expiresAt > now + 300) {
            return cached.token;
        }

        this.logger.log(`Generating new Invoicy token for company ${companyId}`);

        const credentials = await this.getCompanyCredentials(companyId);
        const partnerKey = this.getPartnerKey();

        if (!partnerKey) {
            throw new Error(
                'INVOICY_PARTNER_KEY não configurada nas variáveis de ambiente',
            );
        }

        const authRequest: InvoicyAuthRequest = {
            sub: credentials.cnpj.replace(/\D/g, ''), // Remove non-digits
            partnerKey: partnerKey,
            chaveAcesso: credentials.accessKey,
        };

        const baseUrl = this.getBaseUrl(credentials.environment);

        try {
            const response = await this.httpClient.post<InvoicyAuthResponse>(
                `${baseUrl}/token`,
                authRequest,
            );

            const { accessToken, accessTokenExpireAt } = response.data;

            // Cache the token
            this.tokenCache.set(companyId, {
                token: accessToken,
                expiresAt: accessTokenExpireAt,
                companyId,
            });

            return accessToken;
        } catch (error) {
            this.logger.error(
                `Failed to authenticate with Invoicy: ${error.message}`,
                error.stack,
            );
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
     * Make authenticated request to Invoicy API
     */
    private async makeRequest<T>(
        companyId: string,
        method: 'GET' | 'POST' | 'PUT' | 'DELETE',
        endpoint: string,
        data?: unknown,
    ): Promise<T> {
        const token = await this.authenticate(companyId);
        const credentials = await this.getCompanyCredentials(companyId);
        const baseUrl = this.getBaseUrl(credentials.environment);

        try {
            const response = await this.httpClient.request<T>({
                method,
                url: `${baseUrl}${endpoint}`,
                data,
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            return response.data;
        } catch (error) {
            // If unauthorized, clear cache and retry once
            if (error.response?.status === 401) {
                this.logger.warn(
                    `Token expired for company ${companyId}, retrying...`,
                );
                this.clearTokenCache(companyId);
                const newToken = await this.authenticate(companyId);

                const retryResponse = await this.httpClient.request<T>({
                    method,
                    url: `${baseUrl}${endpoint}`,
                    data,
                    headers: {
                        Authorization: `Bearer ${newToken}`,
                    },
                });

                return retryResponse.data;
            }

            throw error;
        }
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
            '/nfe',
            documents,
        );

        // Check for errors in response
        if (
            response.length > 0 &&
            response[0].Codigo !== INVOICY_SUCCESS_CODES.DOCUMENTS_PROCESSED
        ) {
            this.logger.warn(`Invoicy returned non-success code: ${response[0].Codigo}`);
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
        const config = await this.prisma.invoicyConfig.findUnique({
            where: { companyId },
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
            '/nfse',
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
}
