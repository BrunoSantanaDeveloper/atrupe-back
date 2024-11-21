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
