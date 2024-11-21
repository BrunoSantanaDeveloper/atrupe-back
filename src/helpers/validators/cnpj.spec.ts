import { validCNPJ } from './cnpj';

describe('validCNPJ', () => {
  it('should be a valid CNPJ', () => {
    expect(validCNPJ('04.470.781/0001-39')).toBeTruthy();
  });

  it('should be a valid CNPJ without punctuation', () => {
    expect(validCNPJ('04470781000139')).toBeTruthy();
  });

  it('should be an invalid CNPJ', () => {
    expect(validCNPJ('11.111.111/1111-11')).toBeFalsy();
  });

  it('should return false for an invalid CNPJ', () => {
    const cnpj = '34.574.376/0001-93';
    expect(validCNPJ(cnpj)).toBeFalsy();
  });

  it('should return false for a CNPJ with all identical digits', () => {
    const cnpj = '11.111.111/1111-11';
    expect(validCNPJ(cnpj)).toBeFalsy();
  });

  it('should return false for a CNPJ with incorrect length', () => {
    const cnpj = '34.574.376/0001';
    expect(validCNPJ(cnpj)).toBeFalsy();
  });

  it('should return false for a CNPJ with non-numeric characters', () => {
    const cnpj = '34a574b376/0001c92';
    expect(validCNPJ(cnpj)).toBeFalsy();
  });

  it('should return false for an empty string', () => {
    const cnpj = '';
    expect(validCNPJ(cnpj)).toBeFalsy();
  });

  it('should return false for a null value', () => {
    const cnpj = null;
    expect(validCNPJ(cnpj)).toBeFalsy();
  });
});
