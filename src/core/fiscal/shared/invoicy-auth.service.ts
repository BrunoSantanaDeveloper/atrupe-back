import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import axios from 'axios';

interface InvoicyTokenResponse {
  accessToken: string;
  accessTokenExpireAt: number;
  refreshToken: string;
  refreshTokenExpireAt: number;
}

@Injectable()
export class InvoicyAuthService {
  private readonly logger = new Logger(InvoicyAuthService.name);
  private readonly baseUrl = process.env.INVOICY_API_URL || 'https://api.invoicy.com.br';

  // Cache de tokens em memória (por companyId)
  private tokenCache = new Map<string, { token: string; expiresAt: number }>();

  constructor(private prisma: PrismaService) {}

  /**
   * Obtém token de acesso válido para a empresa
   * Usa cache se disponível e não expirado
   */
  async getAccessToken(companyId: string): Promise<string> {
    // Verificar cache
    const cached = this.tokenCache.get(companyId);
    if (cached && cached.expiresAt > Date.now() / 1000) {
      this.logger.debug(`Using cached token for company ${companyId}`);
      return cached.token;
    }

    // Buscar configuração da empresa
    const config = await this.prisma.invoicyConfig.findUnique({
      where: { companyId },
    });

    if (!config) {
      throw new UnauthorizedException(
        'Configuração Invoicy não encontrada para esta empresa',
      );
    }

    // Buscar CNPJ da empresa
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { cnpj: true },
    });

    if (!company?.cnpj) {
      throw new UnauthorizedException('CNPJ da empresa não encontrado');
    }

    // Autenticar com Invoicy
    const token = await this.authenticate(
      company.cnpj,
      config.partnerKey,
      config.accessKey,
    );

    // Atualizar cache
    this.tokenCache.set(companyId, {
      token: token.accessToken,
      expiresAt: token.accessTokenExpireAt,
    });

    // Atualizar no banco para persistência (opcional)
    await this.prisma.invoicyConfig.update({
      where: { id: config.id },
      data: {
        currentToken: token.accessToken,
        tokenExpiresAt: new Date(token.accessTokenExpireAt * 1000),
      },
    });

    return token.accessToken;
  }

  /**
   * Autentica com API Invoicy
   */
  private async authenticate(
    cnpj: string,
    partnerKey: string,
    accessKey: string,
  ): Promise<InvoicyTokenResponse> {
    try {
      this.logger.log(`Authenticating with Invoicy for CNPJ ${cnpj}`);

      const response = await axios.post<InvoicyTokenResponse>(
        `${this.baseUrl}/token`,
        {
          sub: cnpj,
          partnerKey,
          chaveAcesso: accessKey,
        },
      );

      this.logger.log(`Successfully authenticated with Invoicy`);
      return response.data;
    } catch (error) {
      this.logger.error('Failed to authenticate with Invoicy', error);
      if (axios.isAxiosError(error)) {
        throw new UnauthorizedException(
          `Falha na autenticação Invoicy: ${error.response?.data?.message || error.message}`,
        );
      }
      throw new UnauthorizedException('Falha na autenticação Invoicy');
    }
  }

  /**
   * Limpa cache de token
   */
  clearCache(companyId: string): void {
    this.tokenCache.delete(companyId);
  }

  /**
   * Testa conexão com Invoicy
   */
  async testConnection(
    cnpj: string,
    partnerKey: string,
    accessKey: string,
  ): Promise<boolean> {
    try {
      await this.authenticate(cnpj, partnerKey, accessKey);
      return true;
    } catch (error) {
      return false;
    }
  }
}
