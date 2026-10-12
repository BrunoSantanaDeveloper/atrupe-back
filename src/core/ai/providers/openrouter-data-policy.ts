import { ConfigService } from '@nestjs/config';

/**
 * Política de dados das chamadas ao OpenRouter (guia de segurança: os dados
 * dos clientes não treinam modelo e o provedor recebe o mínimo necessário).
 *
 * - `data_collection: 'deny'` tira da rota os provedores que treinam com o
 *   que recebem. Não é configurável.
 * - `zdr: true` restringe aos endpoints de retenção zero. Vale por padrão;
 *   `AI_ZERO_DATA_RETENTION=false` desliga, para quem escolher de propósito
 *   um modelo sem endpoint de retenção zero.
 *
 * Modelo sem provedor que atenda responde erro: a chamada passa ao próximo
 * modelo da cadeia e a avaliação semanal deixa de considerá-lo.
 */
export function zeroDataRetentionRequired(config: ConfigService): boolean {
  return config.get<boolean>('ai.zeroDataRetention') !== false;
}

export function openRouterProviderPreferences(config: ConfigService) {
  return {
    data_collection: 'deny' as const,
    ...(zeroDataRetentionRequired(config) ? { zdr: true } : {}),
  };
}
