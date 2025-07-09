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
      clientId: process.env.BIG_DATA_CORP_CLIENT_ID,
    },
  },
});

export const asaasConfig = {
  mockMode: process.env.ASAAS_MOCK_MODE === 'true',
  token: `$${process.env.ASAAS_TOKEN}`,
  apiUrl: process.env.ASAAS_API_URL || 'https://sandbox.asaas.com/api/v3',
};
