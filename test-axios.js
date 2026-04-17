import axios from 'axios';

const api = axios.create({
  baseURL: 'http://httpbin.org',
  headers: {
    common: {
      'Content-Type': 'application/json',
      access_token: '12345',
      'User-Agent': 'Atrupe',
    },
  },
});

api.interceptors.request.use((config) => {
  console.log('Headers sent:', config.headers);
  return config;
});

api
  .post('/post', { data: 123 })
  .then((_res) => console.log('Done'))
  .catch((err) => console.error(err.message));
