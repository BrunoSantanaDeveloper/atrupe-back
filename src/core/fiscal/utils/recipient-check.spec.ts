import { missingRecipientFields } from './recipient-check';

describe('missingRecipientFields (Lista Lite 19/11, item 9)', () => {
  const full = {
    document: '123.456.789-09',
    name: 'Mariana',
    zipcode: '88000-000',
    state: 'SC',
    city: 'São José',
    neighborhood: 'Centro',
    street: 'Rua A',
    number: 'S/N',
    indicadorIE: 9,
  };

  it('NF-e completa (o S/N vale como número)', () => {
    expect(missingRecipientFields('NFE', full)).toEqual([]);
  });

  it('NF-e lista tudo o que falta de uma vez', () => {
    expect(
      missingRecipientFields('NFE', {
        ...full,
        number: '',
        neighborhood: null,
        indicadorIE: 1,
      }),
    ).toEqual([
      'Número (ou S/N)',
      'Bairro',
      'Inscrição estadual (contribuinte do ICMS)',
    ]);
  });

  it('NFS-e de pessoa física: documento, nome e CEP', () => {
    expect(
      missingRecipientFields('NFSE', { document: '12345678909', name: 'Ana' }),
    ).toEqual(['CEP']);
  });

  it('NFC-e não pede nada do cliente', () => {
    expect(missingRecipientFields('NFCE', {})).toEqual([]);
  });

  it('documento com tamanho errado conta como faltando', () => {
    expect(
      missingRecipientFields('NFSE', { ...full, document: '123' }),
    ).toEqual(['CPF ou CNPJ']);
  });
});
