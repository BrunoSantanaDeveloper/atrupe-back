import * as tls from 'tls';
import * as forge from 'node-forge';
import {
  extractCnpj,
  parsePfxCertificate,
  validatePfxCertificateCnpj,
} from './certificate-parser';

describe('certificate-parser', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

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

  describe('parsePfxCertificate', () => {
    it('falls back to forge when Node cannot read the PFX', () => {
      jest.spyOn(tls, 'createSecureContext').mockImplementation(() => {
        throw new Error('unsupported');
      });
      jest.spyOn(forge.asn1, 'fromDer').mockReturnValue({} as any);
      jest.spyOn(forge.pkcs12, 'pkcs12FromAsn1').mockReturnValue({
        getBags: jest.fn().mockReturnValue({
          [forge.pki.oids.certBag]: [
            {
              cert: {
                subject: {
                  attributes: [
                    {
                      shortName: 'CN',
                      value: 'CUNHA MODA PRAIA LTDA:57968205000182',
                    },
                  ],
                },
                issuer: {
                  attributes: [{ shortName: 'CN', value: 'AC Teste' }],
                },
                validity: { notAfter: new Date('2027-01-01T00:00:00.000Z') },
                serialNumber: '123',
              },
            },
          ],
        }),
      } as any);

      const result = parsePfxCertificate('ZmFrZS1wZng=', '12345678');

      expect(result?.cnpj).toBe('57968205000182');
      expect(result?.subject).toBe('CUNHA MODA PRAIA LTDA:57968205000182');
    });
  });

  describe('validatePfxCertificateCnpj', () => {
    it('returns a readable message when the certificate cannot be parsed', () => {
      jest.spyOn(tls, 'createSecureContext').mockImplementation(() => {
        throw new Error('unsupported');
      });
      jest.spyOn(forge.asn1, 'fromDer').mockImplementation(() => {
        throw new Error('Invalid PFX');
      });

      const result = validatePfxCertificateCnpj(
        'ZmFrZS1wZng=',
        'wrong',
        '57968205000182',
      );

      expect(result).toEqual({
        valid: false,
        message:
          'Não foi possível ler o certificado digital. Verifique o arquivo A1 e a senha informada.',
      });
    });
  });
});
