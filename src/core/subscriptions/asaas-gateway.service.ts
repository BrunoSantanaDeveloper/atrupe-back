import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { SystemSettingsService } from '../system-settings/system-settings.service';
import { AsaasPaymentStatus } from '@prisma/client';
import {
  AsaasCreateInstallmentPayload,
  AsaasCreateSubscriptionPayload,
  AsaasSubscriptionResponse,
  AsaasUpdateSubscriptionPayload,
  AsaasUpdatePaymentPayload,
  AsaasPaymentResponse,
} from './interfaces/asaas.interfaces';

@Injectable()
export class AsaasGatewayService {
  private readonly logger = new Logger(AsaasGatewayService.name);

  constructor(private readonly settingsService: SystemSettingsService) {}

  private async asaasApi() {
    const config = await this.settingsService.getActiveAsaasConfig();
    const api = axios.create({
      baseURL: config.url,
      timeout: 15000, // 15s timeout para evitar requests pendurados
      headers: {
        common: {
          'Content-Type': 'application/json',
          access_token: config.token,
          'User-Agent': 'Atrupe',
        },
      },
    });

    return api;
  }

  async cancelAsaasSubscription(asaasSubscriptionId: string): Promise<void> {
    const route = `/subscriptions/${asaasSubscriptionId}`;

    try {
      const api = await this.asaasApi();
      await api.delete(route);
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
      const api = await this.asaasApi();
      const response = await api.post(route, data);
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
      const api = await this.asaasApi();
      const response = await api.post(route, subscriptionData);
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
  /**
   * A assinatura como o Asaas a vê — valor, situação e se foi removida.
   * `null` quando ela não existe lá.
   */
  async getAsaasSubscription(
    asaasSubscriptionId: string,
  ): Promise<(AsaasSubscriptionResponse & { deleted?: boolean }) | null> {
    try {
      const api = await this.asaasApi();
      const response = await api.get(`/subscriptions/${asaasSubscriptionId}`);
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) return null;
      this.logger.error('Erro ao buscar assinatura no Asaas:', {
        message: error.message,
        status: error.response?.status,
      });
      throw new Error(
        `Falha ao buscar a assinatura no Asaas: ${error.message}`,
      );
    }
  }

  /**
   * A cobrança como o Asaas a vê. `null` quando ela não existe lá.
   *
   * É a única forma de saber de uma cobrança removida: a listagem da
   * assinatura deixa de trazê-la, mas a consulta pelo id ainda responde, com
   * `deleted: true`.
   */
  async getAsaasPayment(
    paymentId: string,
  ): Promise<AsaasPaymentResponse | null> {
    try {
      const api = await this.asaasApi();
      const response = await api.get(`/payments/${paymentId}`);
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) return null;
      this.logger.error('Erro ao buscar cobrança no Asaas:', {
        message: error.message,
        status: error.response?.status,
      });
      throw new Error(`Falha ao buscar a cobrança no Asaas: ${error.message}`);
    }
  }

  async getAsaasSubscriptionPayments(
    asaasSubscriptionId: string,
  ): Promise<any[]> {
    const route = `/subscriptions/${asaasSubscriptionId}/payments`;

    try {
      const api = await this.asaasApi();
      // Sem `limit`, o Asaas devolve 10 por página: numa assinatura com mais
      // de 10 meses, a cobrança vencida podia ficar de fora.
      const payments: any[] = [];
      for (let offset = 0; ; offset += 100) {
        const response = await api.get(route, {
          params: { limit: 100, offset },
        });
        payments.push(...(response.data.data || []));
        if (!response.data.hasMore) break;
      }
      return payments;
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
   * Cria uma cobrança parcelada: o anual em até 12x no cartão. A assinatura do
   * Asaas não parcela — o parcelamento é uma cobrança com várias parcelas, e a
   * resposta é a primeira delas, com o id do parcelamento em `installment`.
   * O Asaas divide o total pelo número de parcelas (onde cai o centavo que
   * sobra é um dos pontos a confirmar no sandbox).
   */
  async createInstallmentCharge(
    data: AsaasCreateInstallmentPayload,
  ): Promise<AsaasPaymentResponse> {
    const route = '/payments';
    try {
      const api = await this.asaasApi();
      const response = await api.post(route, data);
      return response.data;
    } catch (error) {
      const errorResponse = error.response?.data?.errors;
      const errorDescription = errorResponse
        ?.map((err) => err.description)
        .join(', ');
      this.logger.error(
        'Erro ao criar cobrança parcelada no Asaas:',
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
          'Falha ao criar cobrança parcelada no Asaas',
      );
    }
  }

  /** As parcelas de um parcelamento, em ordem de vencimento. */
  async getInstallmentPayments(installmentId: string): Promise<any[]> {
    try {
      const api = await this.asaasApi();
      const response = await api.get('/payments', {
        params: { installment: installmentId, limit: 100 },
      });
      const payments: any[] = response.data?.data || [];
      return payments.sort((a, b) =>
        String(a.dueDate).localeCompare(String(b.dueDate)),
      );
    } catch (error) {
      this.logger.error('Erro ao buscar as parcelas no Asaas:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });
      throw new Error(
        `Falha ao buscar as parcelas do parcelamento no Asaas: ${error.message}`,
      );
    }
  }

  /**
   * As cobranças de uma assinatura local, qualquer que seja o modo: as da
   * assinatura recorrente do Asaas, ou as parcelas do parcelamento em curso.
   */
  async getChargesOf(subscription: {
    asaasSubscriptionId: string;
    asaasInstallmentId?: string | null;
  }): Promise<any[]> {
    return subscription.asaasInstallmentId
      ? this.getInstallmentPayments(subscription.asaasInstallmentId)
      : this.getAsaasSubscriptionPayments(subscription.asaasSubscriptionId);
  }

  /** Cobranças criadas com esta referência: é o que torna a renovação idempotente. */
  async findPaymentsByExternalReference(
    externalReference: string,
  ): Promise<any[]> {
    try {
      const api = await this.asaasApi();
      const response = await api.get('/payments', {
        params: { externalReference, limit: 100 },
      });
      return response.data?.data || [];
    } catch (error) {
      this.logger.error('Erro ao buscar cobranças por referência no Asaas:', {
        message: error.message,
        status: error.response?.status,
      });
      throw new Error(
        `Falha ao buscar cobranças por referência no Asaas: ${error.message}`,
      );
    }
  }

  /** Remove um parcelamento: as parcelas ainda não pagas deixam de existir. */
  async deleteInstallment(installmentId: string): Promise<void> {
    try {
      const api = await this.asaasApi();
      await api.delete(`/installments/${installmentId}`);
    } catch (error) {
      this.logger.error(
        `Erro ao remover o parcelamento ${installmentId} no Asaas: ${JSON.stringify(
          error.response?.data || error.message,
        )}`,
      );
      throw new Error('Falha ao remover o parcelamento no Asaas');
    }
  }

  /**
   * Atualiza uma cobrança individual (valor, vencimento, descrição).
   * Usado para reemitir a cobrança de reativação quando o cliente troca de
   * plano estando inadimplente — o Asaas usa POST para update, assim como
   * em subscriptions.
   */
  async updateAsaasPayment(
    paymentId: string,
    data: AsaasUpdatePaymentPayload,
  ): Promise<AsaasPaymentResponse> {
    const route = `/payments/${paymentId}`;

    try {
      const api = await this.asaasApi();
      const response = await api.post(route, data);
      return response.data;
    } catch (error) {
      const errorResponse = error.response?.data?.errors;
      const errorDescription = errorResponse
        ?.map((err) => err.description)
        .join(', ');

      this.logger.error(
        'Erro ao atualizar cobrança no Asaas:',
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
          'Falha ao atualizar cobrança no Asaas',
      );
    }
  }

  /**
   * Remove uma cobrança do Asaas. Usado para descartar cobranças de períodos
   * que o cliente não usufruiu (conta bloqueada) após o reset do ciclo.
   */
  async deleteAsaasPayment(paymentId: string): Promise<void> {
    const route = `/payments/${paymentId}`;

    try {
      const api = await this.asaasApi();
      await api.delete(route);
    } catch (error) {
      this.logger.error(
        `Erro ao remover cobrança ${paymentId} no Asaas: ${JSON.stringify(
          error.response?.data || error.message,
        )}`,
      );
      throw new Error('Falha ao remover cobrança no Asaas');
    }
  }

  /**
   * Busca o QR Code Pix de uma cobrança.
   *
   * O objeto de cobrança do Asaas NÃO traz o QR Code: ele vem só deste
   * endpoint. Antes, gravávamos `pixQrCodeId` (um id) como se fosse o QR e
   * `encodedImage` (campo inexistente na cobrança) como copia-e-cola, então o
   * Pix nunca chegou utilizável ao cliente.
   */
  async getPixQrCode(
    paymentId: string,
  ): Promise<{ encodedImage?: string; payload?: string } | null> {
    try {
      const api = await this.asaasApi();
      const { data } = await api.get(`/payments/${paymentId}/pixQrCode`);
      return { encodedImage: data?.encodedImage, payload: data?.payload };
    } catch (error) {
      // Pix indisponível não pode derrubar a contratação: a fatura continua
      // pagável pelo invoiceUrl.
      this.logger.warn(
        `Não foi possível obter o QR Code Pix da cobrança ${paymentId}: ${JSON.stringify(
          error.response?.data || error.message,
        )}`,
      );
      return null;
    }
  }

  /**
   * Mapeia status do payment do Asaas para nosso enum
   */
  mapAsaasPaymentStatus(asaasStatus: string): AsaasPaymentStatus {
    const statusMap: Record<string, AsaasPaymentStatus> = {
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
      const api = await this.asaasApi();
      const response = await api.post('/customers', customerData);
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
      throw new Error(
        error.response?.data?.errors
          ?.map((err) => err.description)
          .join('. ') ||
          error.message ||
          'Falha ao criar cliente no gateway de pagamento',
      );
    }
  }

  /**
   * Atualiza um customer no Asaas
   */
  async updateAsaasCustomer(
    asaasCustomerId: string,
    customerData: Record<string, any>,
  ): Promise<any> {
    try {
      const api = await this.asaasApi();
      const response = await api.put(
        `/customers/${asaasCustomerId}`,
        customerData,
      );
      return response.data;
    } catch (error) {
      this.logger.error(
        'Erro ao atualizar customer no Asaas:',
        JSON.stringify({
          message: error.message,
          response: error.response?.data,
          status: error.response?.status,
          asaasCustomerId,
        }),
      );
      throw new Error(
        error.response?.data?.errors
          ?.map((err: any) => err.description)
          .join('. ') ||
          error.message ||
          'Falha ao atualizar cliente no gateway de pagamento',
      );
    }
  }
}
