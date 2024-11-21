import { validCPF } from './cpf';

describe('CPF Validation', () => {
  test('validates correct CPF without punctuation', () => {
    expect(validCPF('32406753077')).toBeTruthy();
  });

  test('validates correct CPF with punctuation', () => {
    expect(validCPF('324.067.530-77')).toBeTruthy();
  });

  test('rejects invalid CPF', () => {
    expect(validCPF('12345678900')).toBeFalsy();
  });

  test('rejects CPF with all identical digits', () => {
    expect(validCPF('11111111111')).toBeFalsy();
  });

  test('rejects CPF that is too short', () => {
    expect(validCPF('123456789')).toBeFalsy();
  });

  test('rejects CPF that is too long', () => {
    expect(validCPF('123456789012')).toBeFalsy();
  });

  test('rejects empty CPF', () => {
    expect(validCPF('')).toBeFalsy();
  });

  test('rejects null', () => {
    expect(validCPF(null)).toBeFalsy();
  });

  test('rejects undefined', () => {
    expect(validCPF(undefined)).toBeFalsy();
  });
});
