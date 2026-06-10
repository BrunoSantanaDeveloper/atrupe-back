import { extractCnpj } from './certificate-parser';

describe('certificate-parser', () => {
  describe('extractCnpj', () => {
    it('prefers the CNPJ from the certificate common name', () => {
      const subject = [
        'C=BR',
        'O=ICP-Brasil',
        'OU=Certificado Digital PJ A1',
        'OU=Videoconferencia',
        'OU=56689050000182',
        'OU=AC SyngularID Multipla',
        'CN=PERSONALLE COMUNICACAO VISUAL LTDA:36090571000101',
      ].join('\n');

      expect(extractCnpj(subject)).toBe('36090571000101');
    });

    it('falls back to the first CNPJ when common name has none', () => {
      expect(extractCnpj('OU=56689050000182\nCN=PERSONALLE')).toBe(
        '56689050000182',
      );
    });
  });
});
