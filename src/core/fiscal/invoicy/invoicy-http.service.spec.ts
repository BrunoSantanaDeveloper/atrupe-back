import {
  INVOICY_COMPANY_ALREADY_REGISTERED_MESSAGE,
  INVOICY_COMPANY_LINKED_TO_ANOTHER_PARTNER_MESSAGE,
  InvoicyHttpService,
} from './invoicy-http.service';
import { BadRequestException } from '@nestjs/common';

/**
 * Política de retry do transporte fiscal.
 *
 * A regra que importa: escrita fiscal não é idempotente (o payload não carrega
 * chave de idempotência), então repetir depois de um timeout pode transmitir
 * duas vezes um documento que a SEFAZ já processou. A exceção é o 429 — ali o
 * provedor recusou antes de processar, e nada chegou à SEFAZ.
 */
describe('InvoicyHttpService retry', () => {
  const makeService = () =>
    new InvoicyHttpService(
      {} as any,
      { get: jest.fn(() => '') } as any,
      {} as any,
    ) as any;

  const erroHttp = (status: number, headers: Record<string, string> = {}) =>
    Object.assign(new Error(`Request failed with status code ${status}`), {
      response: { status, headers, data: {} },
    });

  const chamar = (service: any, disableRetry = false) =>
    service.makeRequest(
      'company-1',
      'POST',
      '/senddocuments/nfe?type=Emissao',
      {},
      undefined,
      undefined,
      undefined,
      disableRetry,
    );

  it('repete quando o provedor devolve 429 e respeita o Retry-After', async () => {
    const service = makeService();
    const executeRequest = jest
      .spyOn(service, 'executeRequest')
      .mockRejectedValueOnce(erroHttp(429, { 'retry-after': '1' }))
      .mockResolvedValueOnce([{ Codigo: 100 }]);

    await expect(chamar(service)).resolves.toEqual([{ Codigo: 100 }]);
    expect(executeRequest).toHaveBeenCalledTimes(2);
  });

  it('repete 429 mesmo com disableRetry — nada chegou à SEFAZ', async () => {
    const service = makeService();
    const executeRequest = jest
      .spyOn(service, 'executeRequest')
      .mockRejectedValueOnce(erroHttp(429, { 'retry-after': '1' }))
      .mockResolvedValueOnce([{ Codigo: 100 }]);

    await expect(chamar(service, true)).resolves.toEqual([{ Codigo: 100 }]);
    expect(executeRequest).toHaveBeenCalledTimes(2);
  });

  it('não repete timeout quando disableRetry está ligado', async () => {
    const service = makeService();
    const executeRequest = jest
      .spyOn(service, 'executeRequest')
      .mockRejectedValue(
        Object.assign(new Error('timeout of 60000ms exceeded'), {
          code: 'ECONNABORTED',
        }),
      );

    await expect(chamar(service, true)).rejects.toThrow('timeout');
    expect(executeRequest).toHaveBeenCalledTimes(1);
  });

  it('não repete os demais erros 4xx', async () => {
    const service = makeService();
    const executeRequest = jest
      .spyOn(service, 'executeRequest')
      .mockRejectedValue(erroHttp(400));

    await expect(chamar(service)).rejects.toThrow('status code 400');
    expect(executeRequest).toHaveBeenCalledTimes(1);
  });
});

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

  /**
   * O CNPJ do onboarding é digitado pelo usuário e é público. Sem exigir o
   * certificado, quem digitasse o CNPJ de outra empresa já cadastrada no
   * provedor recebia a chave de acesso dela.
   */
  describe('CNPJ que já tem cadastro no provedor', () => {
    const dados = {
      cnpj: '12345678000199',
      razaoSocial: 'Empresa Teste',
      environment: 'HOMOLOGACAO' as const,
    };

    function serviceComCadastro() {
      const service = makeService();
      service.ensureCertificateMatchesCnpj = jest.fn();
      service.consultCompany = jest.fn().mockResolvedValue({});
      service.extractCompanyAccessKey = jest
        .fn()
        .mockReturnValue({ accessKey: 'chave-da-empresa' });
      service.updateCompanyCertificate = jest.fn();
      return service;
    }

    it('com a exigência, só entrega a chave junto com o certificado', async () => {
      const service = serviceComCadastro();

      await expect(
        service.registerCompany({
          ...dados,
          requireCertificateForExisting: true,
        }),
      ).rejects.toThrow(INVOICY_COMPANY_ALREADY_REGISTERED_MESSAGE);

      await expect(
        service.registerCompany({
          ...dados,
          certificate: 'pfx-em-base64',
          certificatePassword: 'senha',
          requireCertificateForExisting: true,
        }),
      ).resolves.toEqual({
        accessKey: 'chave-da-empresa',
        environment: 'HOMOLOGACAO',
      });
      expect(service.ensureCertificateMatchesCnpj).toHaveBeenCalledWith(
        'pfx-em-base64',
        'senha',
        dados.cnpj,
      );
    });

    it('sem a exigência (ativação de emissor já conferido), segue entregando', async () => {
      const service = serviceComCadastro();

      await expect(service.registerCompany(dados)).resolves.toEqual({
        accessKey: 'chave-da-empresa',
        environment: 'HOMOLOGACAO',
      });
    });
  });
});
