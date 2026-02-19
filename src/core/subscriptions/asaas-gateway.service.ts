import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { asaasConfig } from 'src/config/configuration';
import {
  AsaasCreateSubscriptionPayload,
  AsaasSubscriptionResponse,
  AsaasUpdateSubscriptionPayload,
} from './interfaces/asaas.interfaces';

@Injectable()
export class AsaasGatewayService {
  private readonly logger = new Logger(AsaasGatewayService.name);
  private asaasToken = asaasConfig.token;
  private asaasApiUrl = asaasConfig.apiUrl;

  private asaasApi() {
    const api = axios.create({
      baseURL: this.asaasApiUrl,
      headers: {
        common: {
          'Content-Type': 'application/json',
          access_token: this.asaasToken,
          'User-Agent': 'Atrupe',
        },
      },
    });

    return api;
  }

  async cancelAsaasSubscription(asaasSubscriptionId: string): Promise<void> {
    const route = `/subscriptions/${asaasSubscriptionId}`;

    try {
      await this.asaasApi().delete(route);
    } catch (error) {
      this.logger.error(
        `Error canceling Asaas subscription: ${JSON.stringify(error.response?.data || error.message)}`,
      );
      throw new Error('Failed to cancel subscription in Asaas');
    }
  }

  async updateAsaasSubscription(
    asaasSubscriptionId: string,
    data: AsaasUpdateSubscriptionPayload,
  ): Promise<AsaasSubscriptionResponse> {
    const route = `/subscriptions/${asaasSubscriptionId}`;

    try {
      const response = await this.asaasApi().post(route, data);
      return response.data;
    } catch (error) {
      const errorResponse = error.response?.data.errors;
      const errorDescription = errorResponse
        ?.map((err) => err.description)
        .join(', ');

      this.logger.error(
        'Error updating Asaas subscription:',
        JSON.stringify({
          message: error.message,
          response: errorResponse,
          status: error.response?.status,
          route,
          data,
        }),
      );
      throw new Error(
        errorDescription ||
          error.message ||
          'Falha ao atualizar assinatura no Asaas',
      );
    }
  }

  async createSubscription(
    subscriptionData: AsaasCreateSubscriptionPayload,
  ): Promise<AsaasSubscriptionResponse> {
    const route = '/subscriptions';
    this.logger.debug(`payload asaas: ${JSON.stringify(subscriptionData)}`);
    try {
      const response = await this.asaasApi().post(route, subscriptionData);
      return response.data;
    } catch (error) {
      const errorResponse = error.response?.data.errors;
      const errorDescription = errorResponse
        ?.map((err) => err.description)
        .join(', ');

      this.logger.error(
        'Erro ao criar assinatura no Asaas:',
        JSON.stringify({
          message: error.message,
          response: errorResponse,
          status: error.response?.status,
          route,
          data: subscriptionData,
        }),
      );
      throw new Error(
        errorDescription ||
          error.message ||
          'Falha ao criar assinatura no Asaas',
      );
    }
  }

  /**
   * Busca os pagamentos de uma subscription no Asaas
   */
  async getAsaasSubscriptionPayments(
    asaasSubscriptionId: string,
  ): Promise<any[]> {
    const route = `/subscriptions/${asaasSubscriptionId}/payments`;

    try {
      const response = await this.asaasApi().get(route);
      return response.data.data || [];
    } catch (error) {
      this.logger.error('Erro ao buscar payments da subscription no Asaas:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });
      throw new Error(
        `Falha ao buscar cobranças da assinatura no Asaas: ${error.message}`,
      );
    }
  }

  /**
   * Mapeia status do payment do Asaas para nosso enum
   */
  mapAsaasPaymentStatus(asaasStatus: string): string {
    const statusMap: Record<string, string> = {
      PENDING: 'PENDING',
      CONFIRMED: 'CONFIRMED',
      RECEIVED: 'RECEIVED',
      RECEIVED_IN_CASH: 'RECEIVED',
      OVERDUE: 'OVERDUE',
      REFUNDED: 'REFUNDED',
      REFUND_REQUESTED: 'REFUNDED',
      CHARGEBACK_REQUESTED: 'REFUNDED',
      CHARGEBACK_DISPUTE: 'REFUNDED',
      AWAITING_CHARGEBACK_REVERSAL: 'REFUNDED',
      DUNNING_REQUESTED: 'OVERDUE',
      DUNNING_RECEIVED: 'RECEIVED',
      AWAITING_RISK_ANALYSIS: 'PENDING',
    };

    return statusMap[asaasStatus] || 'PENDING';
  }
  /**
   * Cria um customer no Asaas
   */
  async createAsaasCustomer(customerData: Record<string, any>): Promise<any> {
    try {
      const response = await this.asaasApi().post('/customers', customerData);
      return response.data;
    } catch (error) {
      this.logger.error(
        'Erro ao criar customer no Asaas:',
        JSON.stringify({
          message: error.message,
          response: error.response?.data,
          status: error.response?.status,
        }),
      );
      throw new Error(`Falha ao criar customer no Asaas: ${error.message}`);
    }
  }
}
