/**
 * Ambiente de teste declarado: APP_ENV definida e diferente de production
 * (homolog responde development; o local também).
 *
 * É o que libera devolver na resposta o que em produção só vai por e-mail
 * (código de verificação, link do convite de transferência), para o e2e e o
 * teste manual. Com APP_ENV ausente, a resposta é a de produção: antes, a
 * conferência era só "diferente de production", e uma produção sem a
 * variável entregava o código de qualquer e-mail.
 */
export function isDeclaredTestEnv(
  appEnv: string | undefined = process.env.APP_ENV,
): boolean {
  const env = (appEnv ?? '').trim().toLowerCase();
  return env !== '' && env !== 'production';
}
