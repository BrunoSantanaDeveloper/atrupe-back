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

    /**
     * A SEFAZ valida a assinatura pela raiz do CNPJ. Exigir os 14 dígitos
     * reprovava o certificado da matriz assinando pela filial — configuração
     * legítima que travava a ativação de produção.
     */
    describe('matriz e filial compartilham a raiz do CNPJ', () => {
      // Mesmo caminho de leitura do teste de parsePfxCertificate acima: Node
      // falha e o forge assume.
      const mockCertificado = (cnpj: string) => {
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
                      { shortName: 'CN', value: `A W S SANCHES LTDA:${cnpj}` },
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
      };

      it('aceita o certificado da matriz para o CNPJ da filial', () => {
        mockCertificado('84593300000111');

        const result = validatePfxCertificateCnpj(
          'ZmFrZS1wZng=',
          'senha',
          '84593300000383',
        );

        expect(result.valid).toBe(true);
        expect(result.differentEstablishment).toBe(true);
      });

      it('não sinaliza estabelecimento diferente quando o CNPJ é o mesmo', () => {
        mockCertificado('84593300000111');

        const result = validatePfxCertificateCnpj(
          'ZmFrZS1wZng=',
          'senha',
          '84.593.300/0001-11',
        );

        expect(result.valid).toBe(true);
        expect(result.differentEstablishment).toBe(false);
      });

      it('recusa certificado de outra empresa', () => {
        mockCertificado('57968205000182');

        const result = validatePfxCertificateCnpj(
          'ZmFrZS1wZng=',
          'senha',
          '84593300000111',
        );

        expect(result.valid).toBe(false);
        expect(result.message).toContain('pertence a outra empresa');
      });
    });
  });
});
