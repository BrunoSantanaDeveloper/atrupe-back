export default () => ({
  port: parseInt(process.env.PORT, 10) || 5000,
  secret: {
    jwt: process.env.JWT_SECRET,
    hash: process.env.SECRET,
  },
  plug: {
    bigDataCorp: {
      baseUrl: process.env.BIG_DATA_CORP_BASE_URL,
      token: process.env.BIG_DATA_CORP_TOKEN,
    },
  },
  ai: {
    provider: process.env.AI_PROVIDER || 'openrouter',
    apiKey: process.env.AI_API_KEY,
    baseUrl: process.env.AI_BASE_URL || 'https://openrouter.ai/api/v1',
    model: process.env.AI_MODEL || 'openai/gpt-4o-mini',
    maxToolCalls: parseInt(process.env.AI_MAX_TOOL_CALLS, 10) || 5,
    maxHistoryMessages: parseInt(process.env.AI_MAX_HISTORY_MESSAGES, 10) || 20,
  },
});

export const asaasConfig = {
  token: process.env.ASAAS_TOKEN,
  apiUrl: process.env.ASAAS_API_URL || 'https://api-sandbox.asaas.com/v3',
};
