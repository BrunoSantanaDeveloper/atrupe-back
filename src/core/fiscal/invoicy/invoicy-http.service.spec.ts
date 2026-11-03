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

/**
 * O Invoicy monta o QR Code da NFC-e com o CSC do cadastro da empresa, não com
 * o que vai na nota. O PUT de atualização não documenta se preserva o que não
 * é enviado; por isso o método devolve `Parametros` inteiro como o provedor o
 * tem e confere o resultado numa nova consulta.
 */
describe('InvoicyHttpService.updateCompanyNfceCsc', () => {
  const CNPJ = '13205998000102';
  const CSC = 'ABCDEF12-3456-7890-ABCD-EF1234567890';

  const cadastro = (nfce: Record<string, any>) => ({
    EmpCNPJ: CNPJ,
    EmpRazSocial: 'Atrupe Sistemas',
    EmpNomFantasia: 'Atrupe Sistemas Administrativos LTDA',
    EmpApelido: 'Atrupe',
    EmpIE: '256318743',
    Certificado: { Validade: '2027-01-01' },
    Licenciamento: [{ Modulo: 'NFC-e' }],
    Parametros: {
      NFe: { FormaRetornoPDFIntegracao: 3 },
      NFCe: {
        FormaRetornoPDFIntegracao: 3,
        PossuiLeituraX: 'N',
        IDTokenCscSEFAZ: '',
        CscSEFAZ: '',
        ...nfce,
      },
    },
  });

  // Mesmo formato da resposta real: [{ Codigo, Descricao, RetornoConsulta: [...] }].
  const consulta = (registro: any) => [
    { Codigo: 100, Descricao: 'OK', RetornoConsulta: [registro] },
  ];

  const makeService = () => {
    const service = new InvoicyHttpService(
      {} as any,
      { get: jest.fn(() => '') } as any,
      {} as any,
    ) as any;
    service.authenticateAsPartner = jest.fn().mockResolvedValue('token');
    service.httpClient.put = jest
      .fn()
      .mockResolvedValue({ data: [{ Codigo: 100, Descricao: 'Recebida' }] });
    jest.spyOn(service.logger, 'error').mockImplementation(() => undefined);
    jest.spyOn(service.logger, 'log').mockImplementation(() => undefined);
    return service;
  };

  const enviar = (service: any) =>
    service.updateCompanyNfceCsc({
      cnpj: '13.205.998/0001-02',
      cscId: '1',
      cscToken: CSC,
      environment: 'PRODUCAO',
    });

  it('devolve Parametros inteiro, trocando só o CSC, sem certificado nem licenças', async () => {
    const service = makeService();
    service.consultCompany = jest
      .fn()
      .mockResolvedValueOnce(consulta(cadastro({})))
      .mockResolvedValueOnce(
        consulta(cadastro({ IDTokenCscSEFAZ: '1', CscSEFAZ: CSC })),
      );

    await expect(enviar(service)).resolves.toEqual({ alterado: true });

    const [url, payload] = service.httpClient.put.mock.calls[0];
    expect(url).toBe('https://apibr.invoicy.com.br/companies');
    expect(payload).toEqual([
      {
        EmpCNPJ: CNPJ,
        EmpRazSocial: 'Atrupe Sistemas',
        EmpNomFantasia: 'Atrupe Sistemas Administrativos LTDA',
        EmpApelido: 'Atrupe',
        Parametros: {
          NFe: { FormaRetornoPDFIntegracao: 3 },
          NFCe: {
            FormaRetornoPDFIntegracao: 3,
            PossuiLeituraX: 'N',
            IDTokenCscSEFAZ: '1',
            CscSEFAZ: CSC,
          },
        },
      },
    ]);
    expect(service.logger.error).not.toHaveBeenCalled();
  });

  it('não reescreve o cadastro quando o CSC já é o mesmo ("000001" = "1")', async () => {
    const service = makeService();
    service.consultCompany = jest
      .fn()
      .mockResolvedValue(
        consulta(
          cadastro({ IDTokenCscSEFAZ: '000001', CscSEFAZ: CSC.toLowerCase() }),
        ),
      );

    await expect(enviar(service)).resolves.toEqual({ alterado: false });
    expect(service.httpClient.put).not.toHaveBeenCalled();
  });

  it('falha quando a consulta seguinte não mostra o CSC', async () => {
    const service = makeService();
    service.consultCompany = jest
      .fn()
      .mockResolvedValue(consulta(cadastro({})));

    await expect(enviar(service)).rejects.toThrow(
      'o CSC não aparece no cadastro',
    );
  });

  it('falha quando o provedor recusa a atualização no código de topo', async () => {
    const service = makeService();
    service.consultCompany = jest
      .fn()
      .mockResolvedValue(consulta(cadastro({})));
    service.httpClient.put = jest.fn().mockResolvedValue({
      data: [{ Codigo: 101, Descricao: 'Dados inválidos' }],
    });

    await expect(enviar(service)).rejects.toThrow(
      'Codigo 101 - Dados inválidos',
    );
  });

  it('não confunde item 102 ("certificado não informado") com recusa', async () => {
    const service = makeService();
    service.consultCompany = jest
      .fn()
      .mockResolvedValueOnce(consulta(cadastro({})))
      .mockResolvedValueOnce(
        consulta(cadastro({ IDTokenCscSEFAZ: '1', CscSEFAZ: CSC })),
      );
    service.httpClient.put = jest.fn().mockResolvedValue({
      data: [
        {
          Codigo: 100,
          Descricao: 'Solicitação de cadastro de empresa recebida.',
          RetornoCadastro: [
            { Codigo: 102, Descricao: 'Certificado não informado' },
          ],
        },
      ],
    });

    await expect(enviar(service)).resolves.toEqual({ alterado: true });
  });

  it('registra, sem valores, outros campos que o PUT tenha mudado', async () => {
    const service = makeService();
    const depois = cadastro({ IDTokenCscSEFAZ: '1', CscSEFAZ: CSC });
    depois.Certificado = undefined as any;
    service.consultCompany = jest
      .fn()
      .mockResolvedValueOnce(consulta(cadastro({})))
      .mockResolvedValueOnce(consulta(depois));

    await expect(enviar(service)).resolves.toEqual({ alterado: true });

    const linha = service.logger.error.mock.calls[0][0];
    expect(linha).toContain('$.Certificado');
    expect(linha).not.toContain('2027-01-01');
  });

  it('falha com mensagem clara quando a empresa não está no cadastro', async () => {
    const service = makeService();
    service.consultCompany = jest
      .fn()
      .mockResolvedValue([{ Codigo: 100, RetornoConsulta: [] }]);

    await expect(enviar(service)).rejects.toThrow(
      'não encontrada no cadastro do Invoicy',
    );
    expect(service.httpClient.put).not.toHaveBeenCalled();
  });
});
