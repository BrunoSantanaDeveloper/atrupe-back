export const BASE_LIMITS = [
  {
    key: 'max_users',
    name: 'Máximo de Usuários',
    description: 'Número máximo de usuários permitidos no sistema',
    unit: 'users',
    isActive: true,
  },
  {
    key: 'max_companies',
    name: 'Máximo de Empresas',
    description: 'Número máximo de empresas que podem ser gerenciadas',
    unit: 'companies',
    isActive: true,
  },
  {
    key: 'ai_messages_month',
    name: 'Mensagens do assistente de IA por mês',
    description:
      'Mensagens enviadas ao assistente de IA no mês, somadas por empresa',
    unit: 'messages',
    isActive: true,
  },
  {
    key: 'production_storage_free_mb',
    name: 'Espaço grátis dos arquivos de produção (MB)',
    description:
      'Espaço dos anexos da produção sem a faixa contratada, somado por empresa (todas as versões contam)',
    unit: 'MB',
    isActive: true,
  },
  {
    key: 'trial_days',
    name: 'Dias de Trial',
    description: 'Número de dias de trial gratuito',
    unit: 'days',
    isActive: true,
  },
];
