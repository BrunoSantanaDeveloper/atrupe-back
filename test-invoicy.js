/* eslint-disable @typescript-eslint/no-var-requires */
const jwt = require('jsonwebtoken');
const axios = require('axios');

async function testAuth() {
  // Correct keys from user
  const partnerKey = 'EIqPbfmvrfy88W+PHslzMA==';
  const accessKeyStr = 'DHObDgGyqWXSsx02O+QUpblWAH/D5HFmlH4JkGzUFXI=';

  const now = Math.floor(Date.now() / 1000);

  // Subagent said: For partner auth, `sub` is the Partner Key. No `partnerKey` field needed.
  const payload = {
    iat: now,
    exp: now + 120,
    sub: partnerKey,
  };

  try {
    console.log('--- TEST: Correct Partner Payload ---');
    const token = jwt.sign(payload, accessKeyStr, { algorithm: 'HS256' });
    console.log('JWT:', token);
    const res = await axios.post(
      'https://apibrhomolog.invoicy.com.br/oauth2/invoicy/auth',
      { token: token },
    );
    console.log('SUCCESS:', res.data);
  } catch (e) {
    console.log('ERROR:', e.response?.data || e.message);
  }
}

testAuth();
