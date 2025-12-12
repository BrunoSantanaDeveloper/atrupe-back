import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { InvoicyAuthService } from './invoicy-auth.service';

@Injectable()
export class InvoicyClientService {
  private readonly logger = new Logger(InvoicyClientService.name);
  private readonly baseUrl = process.env.INVOICY_API_URL || 'https://api.invoicy.com.br';
  private client: AxiosInstance;

  constructor(private authService: InvoicyAuthService) {
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000, // 30 segundos
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Interceptor para adicionar token automaticamente
    this.client.interceptors.request.use(
      async (config) => {
        // Pular para endpoint de token
        if (config.url?.includes('/token')) {
          return config;
        }

        // Adicionar token se companyId estiver no config
        const companyId = (config as any).companyId;
        if (companyId) {
          const token = await this.authService.getAccessToken(companyId);
          config.headers.Authorization = `Bearer ${token}`;
          delete (config as any).companyId; // Remover para não enviar ao servidor
        }

        return config;
      },
      (error) => {
        return Promise.reject(error);
      },
    );

    // Interceptor para logging
    this.client.interceptors.response.use(
      (response) => {
        this.logger.debug(
          `Invoicy API Response: ${response.config.method?.toUpperCase()} ${response.config.url} - ${response.status}`,
        );
        return response;
      },
      (error) => {
        if (axios.isAxiosError(error)) {
          this.logger.error(
            `Invoicy API Error: ${error.config?.method?.toUpperCase()} ${error.config?.url} - ${error.response?.status}`,
            error.response?.data,
          );
        }
        return Promise.reject(error);
      },
    );
  }

  /**
   * Faz requisição GET
   */
  async get<T>(url: string, companyId: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.get<T>(url, {
      ...config,
      companyId,
    } as any);
    return response.data;
  }

  /**
   * Faz requisição POST
   */
  async post<T>(
    url: string,
    companyId: string,
    data?: any,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    const response = await this.client.post<T>(url, data, {
      ...config,
      companyId,
    } as any);
    return response.data;
  }

  /**
   * Faz requisição PUT
   */
  async put<T>(
    url: string,
    companyId: string,
    data?: any,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    const response = await this.client.put<T>(url, data, {
      ...config,
      companyId,
    } as any);
    return response.data;
  }

  /**
   * Faz requisição DELETE
   */
  async delete<T>(url: string, companyId: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.delete<T>(url, {
      ...config,
      companyId,
    } as any);
    return response.data;
  }
}
