/**
 * Normalização de valores mal formados em campos OPCIONAIS do CSV.
 *
 * Planilha exportada de outro sistema traz sujeira que não justifica barrar a
 * importação inteira: dois e-mails inválidos rejeitavam as outras 661 linhas de
 * um arquivo — num campo que o próprio schema marca como opcional. Para campo
 * opcional o certo é aproveitar o que dá e importar o resto sem o valor, com a
 * perda declarada na tela antes de confirmar.
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SanitizedValue {
  /** Valor a gravar — null deixa o campo em branco */
  value: string | null;
  /** Explicação exibida na revisão da importação */
  message: string;
}

/**
 * Devolve null quando o valor já está válido (ou vazio) e não precisa de aviso.
 */
export function sanitizeOptionalEmail(
  raw: string | null | undefined,
): SanitizedValue | null {
  const value = raw?.trim();

  if (!value) return null;
  if (EMAIL_REGEX.test(value)) return null;

  // Campo com mais de um e-mail: "a@x.com / b@y.com", "a@x.com; b@y.com".
  const firstValid = value
    .split(/[\s,;/|]+/)
    .filter(Boolean)
    .find((candidate) => EMAIL_REGEX.test(candidate));

  if (firstValid) {
    return {
      value: firstValid,
      message: `O campo tem mais de um e-mail; será usado ${firstValid}`,
    };
  }

  return {
    value: null,
    message: 'E-mail inválido; o registro será importado sem e-mail',
  };
}

/** Valor final de um campo de e-mail opcional, pronto para gravar. */
export function resolveOptionalEmail(
  raw: string | null | undefined,
): string | null {
  const value = raw?.trim();
  if (!value) return null;

  const sanitized = sanitizeOptionalEmail(value);
  return sanitized ? sanitized.value : value;
}
