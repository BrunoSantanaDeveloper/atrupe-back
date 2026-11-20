import { pdfCompanyOf } from './quotation-pdf.transformers';

// Lista Lite 19/11, item 7: o PDF sai com a empresa escolhida no orçamento
describe('pdfCompanyOf', () => {
  const company = (name: string, extra: Record<string, unknown> = {}) => ({
    name,
    cnpj: `cnpj-${name}`,
    email: null,
    phone: null,
    mobile: null,
    siteUrl: 'site-principal',
    logoUrl: `logo-${name}`,
    textBeforeItems: 'antes',
    textAfterItems: 'depois',
    instagram: null,
    facebook: null,
    linkedin: null,
    address: [
      {
        street: `rua-${name}`,
        number: '1',
        complement: null,
        neighborhood: null,
        city: null,
        state: null,
        zipcode: null,
      },
    ],
    ...extra,
  });

  it('sem empresa emissora, usa a principal', () => {
    const main = company('principal');
    expect(pdfCompanyOf({ company: main, subCompany: null })).toBe(main);
  });

  it('com a emissora, sai o nome, o CNPJ, o endereço e o logo dela', () => {
    const result = pdfCompanyOf({
      company: company('principal'),
      subCompany: company('cores-e-linhas'),
    });
    expect(result.name).toBe('cores-e-linhas');
    expect(result.cnpj).toBe('cnpj-cores-e-linhas');
    expect(result.logoUrl).toBe('logo-cores-e-linhas');
    expect(result.address[0].street).toBe('rua-cores-e-linhas');
  });

  it('o que a emissora não tem vem da principal (logo, textos, endereço)', () => {
    const result = pdfCompanyOf({
      company: company('principal'),
      subCompany: company('filial', {
        logoUrl: null,
        textBeforeItems: '',
        siteUrl: null,
        address: [],
      }),
    });
    expect(result.name).toBe('filial');
    expect(result.logoUrl).toBe('logo-principal');
    expect(result.textBeforeItems).toBe('antes');
    expect(result.siteUrl).toBe('site-principal');
    expect(result.address[0].street).toBe('rua-principal');
  });
});
