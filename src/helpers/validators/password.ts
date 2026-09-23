/**
 * As cinco regras de senha do cadastro, as mesmas que a tela confere
 * (app-web: PasswordValidation). Até aqui só a tela as cobrava; a conta
 * criada pelo convite de transferência as confere também no servidor, porque
 * é por ela que um ambiente inteiro muda de mãos.
 */
const RULES: { test: (password: string) => boolean; message: string }[] = [
  { test: (p) => p.length >= 8, message: 'Mínimo de 8 caracteres' },
  {
    test: (p) => /[A-Z]/.test(p),
    message: 'Deve conter pelo menos uma letra maiúscula',
  },
  {
    test: (p) => /[a-z]/.test(p),
    message: 'Deve conter pelo menos uma letra minúscula',
  },
  { test: (p) => /[0-9]/.test(p), message: 'Deve conter pelo menos um número' },
  {
    test: (p) => /[^A-Za-z0-9]/.test(p),
    message: 'Deve conter pelo menos um caractere especial',
  },
];

/** As regras que a senha não atende; vazia quando atende a todas. */
export function passwordProblems(password: string): string[] {
  const value = typeof password === 'string' ? password : '';
  return RULES.filter((rule) => !rule.test(value)).map((rule) => rule.message);
}
