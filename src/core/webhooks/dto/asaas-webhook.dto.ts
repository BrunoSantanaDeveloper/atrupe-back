/**
 * O corpo do webhook do Asaas é uma INTERFACE, não uma classe com decorators.
 *
 * O ValidationPipe global roda com `whitelist` + `forbidNonWhitelisted`
 * (src/app.module.ts). Com uma classe, todo campo não declarado — e o Asaas
 * manda `id` e `dateCreated` no topo — derrubava a requisição com 400, e
 * `payment`/`subscription` declarados como obrigatórios rejeitavam justamente
 * os eventos que só trazem um dos dois. O resultado era 100% dos webhooks
 * recusados. Sem metatype de classe, o pipe não valida e o serviço confere o
 * que precisa — assim um campo novo do Asaas nunca mais derruba o endpoint.
 */
export interface AsaasWebhookPayload {
  /** id do evento (evt_...), a chave de idempotência */
  id?: string;
  event: string;
  dateCreated?: string;
  payment?: any;
  subscription?: any;
  data?: any;
  [key: string]: any;
}

export enum AsaasWebhookEvent {
  // Eventos de Pagamento
  PAYMENT_CREATED = 'PAYMENT_CREATED',
  PAYMENT_UPDATED = 'PAYMENT_UPDATED',
  PAYMENT_CONFIRMED = 'PAYMENT_CONFIRMED',
  PAYMENT_RECEIVED = 'PAYMENT_RECEIVED',
  PAYMENT_OVERDUE = 'PAYMENT_OVERDUE',
  PAYMENT_DELETED = 'PAYMENT_DELETED',
  PAYMENT_RESTORED = 'PAYMENT_RESTORED',
  PAYMENT_REFUNDED = 'PAYMENT_REFUNDED',
  PAYMENT_RECEIVED_IN_CASH = 'PAYMENT_RECEIVED_IN_CASH',
  PAYMENT_RECEIVED_IN_CASH_DELETED = 'PAYMENT_RECEIVED_IN_CASH_DELETED',
  PAYMENT_CHARGEBACK_REQUESTED = 'PAYMENT_CHARGEBACK_REQUESTED',
  PAYMENT_CHARGEBACK_DISPUTE = 'PAYMENT_CHARGEBACK_DISPUTE',
  PAYMENT_AWAITING_CHARGEBACK_REVERSAL = 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
  PAYMENT_DUNNING_RECEIVED = 'PAYMENT_DUNNING_RECEIVED',
  PAYMENT_DUNNING_REQUESTED = 'PAYMENT_DUNNING_REQUESTED',
  PAYMENT_BANK_SLIP_VIEWED = 'PAYMENT_BANK_SLIP_VIEWED',
  PAYMENT_CHECKOUT_VIEWED = 'PAYMENT_CHECKOUT_VIEWED',

  // Eventos de Assinatura
  SUBSCRIPTION_CREATED = 'SUBSCRIPTION_CREATED',
  SUBSCRIPTION_UPDATED = 'SUBSCRIPTION_UPDATED',
  SUBSCRIPTION_DELETED = 'SUBSCRIPTION_DELETED',
  SUBSCRIPTION_EXPIRED = 'SUBSCRIPTION_EXPIRED',
}
