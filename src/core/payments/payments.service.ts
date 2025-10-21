import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { asaasConfig } from 'src/config/configuration';
import axios from 'axios';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private asaasToken = asaasConfig.token;
  private asaasApiUrl = asaasConfig.apiUrl;

  constructor(private prisma: PrismaService) {}

  /**
   * Cria a primeira cobrança ao contratar uma subscription
   */
  async createFirstPayment(data: CreatePaymentDto) {
    this.logger.log('Criando primeira cobrança para subscription');

    try {
      // Criar payment no Asaas
      const asaasPayment = await this.createPaymentAsaas(data);

      // Salvar payment localmente
      const payment = await this.prisma.payment.create({
        data: {
          subscriptionId: data.subscriptionId,
          asaasPaymentId: asaasPayment.id,
          asaasCustomerId: data.asaasCustomerId,
          value: data.value,
          dueDate: new Date(data.dueDate),
          billingType: data.billingType,
          description: data.description,
          externalReference: data.externalReference,
          invoiceUrl: asaasPayment.invoiceUrl,
          bankSlipUrl: asaasPayment.bankSlipUrl,
          pixQrCode: asaasPayment.pixQrCodeId,
          pixCopyPaste: asaasPayment.encodedImage,
          status: 'PENDING',
        },
      });

      this.logger.log(`Payment criado com sucesso: ${payment.id}`);

      return payment;
    } catch (error) {
      this.logger.error('Erro ao criar primeira cobrança:', error);
      throw new BadRequestException(`Erro ao criar cobrança: ${error.message}`);
    }
  }

  /**
   * Cria payment no Asaas
   */
  private async createPaymentAsaas(data: CreatePaymentDto) {
    const route = `${this.asaasApiUrl}/payments`;

    const payload = {
      customer: data.asaasCustomerId,
      billingType: data.billingType,
      value: data.value,
      dueDate: data.dueDate,
      description: data.description || 'Cobrança Atrupe',
      externalReference: data.externalReference,
      callback: {
        successUrl: data.successUrl || 'https://atrupe.com.br/payment/success',
        autoRedirect: true,
      },
    };

    try {
      const response = await axios.post(route, payload, {
        headers: {
          'Content-Type': 'application/json',
          access_token: this.asaasToken,
          'User-Agent': 'Atrupe',
        },
      });

      this.logger.log(`Payment criado no Asaas: ${response.data.id}`);
      return response.data;
    } catch (error) {
      this.logger.error('Erro ao criar payment no Asaas:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });
      throw new Error(`Falha ao criar cobrança no Asaas: ${error.message}`);
    }
  }

  /**
   * Lista todos os payments da empresa
   */
  async findAll(companyId: string) {
    return this.prisma.payment.findMany({
      where: {
        subscription: {
          companyId,
        },
      },
      include: {
        subscription: {
          include: {
            plan: true,
          },
        },
      },
      orderBy: {
        dueDate: 'desc',
      },
    });
  }

  /**
   * Lista payments de uma subscription específica
   */
  async findBySubscription(subscriptionId: string) {
    const payments = await this.prisma.payment.findMany({
      where: { subscriptionId },
      orderBy: {
        dueDate: 'desc',
      },
    });

    if (!payments || payments.length === 0) {
      throw new NotFoundException(
        'Nenhum pagamento encontrado para esta subscription',
      );
    }

    return payments;
  }

  /**
   * Busca um payment específico
   */
  async findOne(id: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        subscription: {
          include: {
            plan: true,
            customer: true,
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment não encontrado');
    }

    return payment;
  }

  /**
   * Consulta status atualizado do payment no Asaas
   */
  async getPaymentStatus(id: string) {
    const payment = await this.findOne(id);

    try {
      const route = `${this.asaasApiUrl}/payments/${payment.asaasPaymentId}`;
      const response = await axios.get(route, {
        headers: {
          access_token: this.asaasToken,
          'User-Agent': 'Atrupe',
        },
      });

      const asaasPayment = response.data;

      // Atualizar status local se mudou
      if (asaasPayment.status !== payment.status) {
        await this.prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: this.mapAsaasStatus(asaasPayment.status),
            confirmedDate: asaasPayment.confirmedDate
              ? new Date(asaasPayment.confirmedDate)
              : null,
            paymentDate: asaasPayment.paymentDate
              ? new Date(asaasPayment.paymentDate)
              : null,
          },
        });
      }

      return {
        ...payment,
        status: this.mapAsaasStatus(asaasPayment.status),
        asaasData: asaasPayment,
      };
    } catch (error) {
      this.logger.error('Erro ao consultar status no Asaas:', error);
      // Retorna o payment local mesmo se falhar
      return payment;
    }
  }

  /**
   * Cancela um payment
   */
  async cancelPayment(id: string) {
    const payment = await this.findOne(id);

    if (payment.status === 'CANCELED') {
      throw new BadRequestException('Payment já está cancelado');
    }

    if (payment.status === 'CONFIRMED' || payment.status === 'RECEIVED') {
      throw new BadRequestException(
        'Não é possível cancelar um pagamento já confirmado',
      );
    }

    try {
      const route = `${this.asaasApiUrl}/payments/${payment.asaasPaymentId}`;
      await axios.delete(route, {
        headers: {
          access_token: this.asaasToken,
          'User-Agent': 'Atrupe',
        },
      });

      // Atualizar status local
      return this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'CANCELED' },
      });
    } catch (error) {
      this.logger.error('Erro ao cancelar payment no Asaas:', error);
      throw new BadRequestException(
        `Erro ao cancelar cobrança: ${error.message}`,
      );
    }
  }

  /**
   * Estorna um payment
   */
  async refundPayment(id: string) {
    const payment = await this.findOne(id);

    if (payment.status !== 'CONFIRMED' && payment.status !== 'RECEIVED') {
      throw new BadRequestException(
        'Apenas pagamentos confirmados podem ser estornados',
      );
    }

    try {
      const route = `${this.asaasApiUrl}/payments/${payment.asaasPaymentId}/refund`;
      await axios.post(
        route,
        {},
        {
          headers: {
            access_token: this.asaasToken,
            'User-Agent': 'Atrupe',
          },
        },
      );

      // Atualizar status local
      return this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'REFUNDED' },
      });
    } catch (error) {
      this.logger.error('Erro ao estornar payment no Asaas:', error);
      throw new BadRequestException(
        `Erro ao estornar pagamento: ${error.message}`,
      );
    }
  }

  /**
   * Mapeia status do Asaas para nosso enum
   */
  private mapAsaasStatus(asaasStatus: string): any {
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
}
