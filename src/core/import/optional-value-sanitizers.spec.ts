import {
  resolveOptionalEmail,
  sanitizeOptionalEmail,
} from './optional-value-sanitizers';

/**
 * Casos reais de uma planilha de 663 clientes que era rejeitada inteira por dois
 * e-mails — num campo que o schema de importação marca como opcional.
 */
describe('sanitizeOptionalEmail', () => {
  it('não reclama de e-mail válido nem de campo vazio', () => {
    expect(sanitizeOptionalEmail('joao@example.com')).toBeNull();
    expect(sanitizeOptionalEmail('')).toBeNull();
    expect(sanitizeOptionalEmail(null)).toBeNull();
    expect(sanitizeOptionalEmail('  joao@example.com  ')).toBeNull();
  });

  it('aproveita o primeiro e-mail quando o campo tem mais de um', () => {
    const result = sanitizeOptionalEmail(
      'sesconpb@sesconpb.org.br / sesconpb1@gmail.com',
    );

    expect(result?.value).toBe('sesconpb@sesconpb.org.br');
    expect(result?.message).toContain('mais de um e-mail');
  });

  it('reconhece separador por vírgula e ponto e vírgula', () => {
    expect(sanitizeOptionalEmail('a@x.com, b@y.com')?.value).toBe('a@x.com');
    expect(sanitizeOptionalEmail('a@x.com; b@y.com')?.value).toBe('a@x.com');
  });

  it('deixa em branco o que não dá para consertar sem inventar', () => {
    // Sem TLD: completar com ".com" seria chutar o endereço de outra pessoa.
    const result = sanitizeOptionalEmail('deniseraquelrocha01@gmail');

    expect(result?.value).toBeNull();
    expect(result?.message).toContain('sem e-mail');
  });
});

describe('resolveOptionalEmail', () => {
  it('devolve o valor pronto para gravar', () => {
    expect(resolveOptionalEmail('joao@example.com')).toBe('joao@example.com');
    expect(resolveOptionalEmail('a@x.com / b@y.com')).toBe('a@x.com');
    expect(resolveOptionalEmail('deniseraquelrocha01@gmail')).toBeNull();
    expect(resolveOptionalEmail('')).toBeNull();
    expect(resolveOptionalEmail(undefined)).toBeNull();
  });
});
