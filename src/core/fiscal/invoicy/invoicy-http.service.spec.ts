import {
  INVOICY_COMPANY_LINKED_TO_ANOTHER_PARTNER_MESSAGE,
  InvoicyHttpService,
} from './invoicy-http.service';
import { BadRequestException } from '@nestjs/common';

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
      {} as any,
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

  it('detects company already registered rejections', () => {
    const service = makeService();

    expect(
      service.isCompanyAlreadyRegisteredRejection([
        {
          Codigo: 101,
          Descricao: 'CNPJ ja cadastrado para outro parceiro',
        },
      ]),
    ).toBe(true);
  });

  it('throws a clear partner mismatch error when registration is rejected as duplicate', async () => {
    const service = makeService();
    service.ensureCertificateMatchesCnpj = jest.fn();
    service.consultCompany = jest.fn().mockRejectedValue({
      response: { status: 404, data: { Mensagem: 'Empresa nao encontrada' } },
    });
    service.authenticateAsPartner = jest.fn().mockResolvedValue('token');
    service.httpClient.post = jest.fn().mockResolvedValue({
      data: [
        {
          RetornoCadastro: [
            {
              Codigo: 101,
              Descricao: 'CNPJ ja cadastrado para outro parceiro',
            },
          ],
        },
      ],
    });

    await expect(
      service.registerCompany({
        cnpj: '12345678000199',
        razaoSocial: 'Empresa Teste',
        environment: 'HOMOLOGACAO',
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.registerCompany({
        cnpj: '12345678000199',
        razaoSocial: 'Empresa Teste',
        environment: 'HOMOLOGACAO',
      }),
    ).rejects.toThrow(INVOICY_COMPANY_LINKED_TO_ANOTHER_PARTNER_MESSAGE);
  });
});
