import { InvoicyHttpService } from './invoicy-http.service';

describe('InvoicyHttpService response parsing', () => {
  const makeService = (environment?: string) =>
    new InvoicyHttpService(
      {} as any,
      {
        get: jest.fn((key: string) => {
          if (key === 'INVOICY_ENVIRONMENT') return environment;
          return '';
        }),
      } as any,
    ) as any;

  it('extracts EmpAK from nested registration responses', () => {
    const service = makeService();

    const result = service.extractCompanyAccessKey([
      {
        Codigo: 100,
        RetornoCadastro: [
          {
            EmpAK: 'access-key',
            ChaveCriptografia: 'crypto-key',
          },
        ],
      },
    ]);

    expect(result).toEqual({
      accessKey: 'access-key',
      cryptoKey: 'crypto-key',
    });
  });

  it('detects success code even when EmpAK is not present', () => {
    const service = makeService();

    expect(service.hasSuccessCode([{ Codigo: '100', Mensagem: 'OK' }])).toBe(
      true,
    );
  });

  it('uses production only when INVOICY_ENVIRONMENT is explicitly PRODUCAO', () => {
    expect(makeService('PRODUCAO').getPartnerEnvironment()).toBe('PRODUCAO');
    expect(makeService('HOMOLOGACAO').getPartnerEnvironment()).toBe(
      'HOMOLOGACAO',
    );
    expect(makeService(undefined).getPartnerEnvironment()).toBe('HOMOLOGACAO');
  });
});
