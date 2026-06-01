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
    model: process.env.AI_MODEL || 'openai/gpt-oss-120b',
    fallbackModels: (process.env.AI_FALLBACK_MODELS || '')
      .split(',')
      .map((model) => model.trim())
      .filter(Boolean),
    modelAutoSelectionEnabled:
      process.env.AI_MODEL_AUTO_SELECTION_ENABLED !== 'false',
    modelAllowlist: (
      process.env.AI_MODEL_ALLOWLIST ||
      'openai/gpt-oss-120b,google/gemini-3.1-flash-lite,qwen/qwen3.7-max'
    )
      .split(',')
      .map((model) => model.trim())
      .filter(Boolean),
    modelBlacklist: (process.env.AI_MODEL_BLACKLIST || '')
      .split(',')
      .map((model) => model.trim())
      .filter(Boolean),
    modelMinContext: parseInt(process.env.AI_MODEL_MIN_CONTEXT, 10) || 128000,
    modelSwitchMinGain:
      parseFloat(process.env.AI_MODEL_SWITCH_MIN_GAIN) || 0.15,
    modelSwitchCooldownDays:
      parseInt(process.env.AI_MODEL_SWITCH_COOLDOWN_DAYS, 10) || 7,
    modelMaxRetries: Number.isNaN(
      parseInt(process.env.AI_MODEL_MAX_RETRIES, 10),
    )
      ? 2
      : parseInt(process.env.AI_MODEL_MAX_RETRIES, 10),
    maxToolCalls: parseInt(process.env.AI_MAX_TOOL_CALLS, 10) || 5,
    maxHistoryMessages: parseInt(process.env.AI_MAX_HISTORY_MESSAGES, 10) || 20,
  },
});

export const asaasConfig = {
  token: process.env.ASAAS_TOKEN,
  apiUrl: process.env.ASAAS_API_URL || 'https://api-sandbox.asaas.com/v3',
};
