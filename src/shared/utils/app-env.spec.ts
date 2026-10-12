import { isDeclaredTestEnv } from './app-env';

describe('isDeclaredTestEnv', () => {
  it.each(['development', 'homolog', 'test', ' Development '])(
    '%s é ambiente de teste',
    (value) => {
      expect(isDeclaredTestEnv(value)).toBe(true);
    },
  );

  it.each([undefined, '', '  ', 'production', 'PRODUCTION', ' Production '])(
    '%p responde como produção',
    (value) => {
      expect(isDeclaredTestEnv(value)).toBe(false);
    },
  );
});
