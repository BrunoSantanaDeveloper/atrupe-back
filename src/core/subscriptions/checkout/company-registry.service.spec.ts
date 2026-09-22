import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { BrasilApiService } from 'src/svc/plug/brasilapi/brasilapi.service';
import { CompanyRegistryService } from './company-registry.service';

const CNPJ = '11.222.333/0001-81';

const raw = {
  razao_social: 'STUDIO NORTE ARQUITETURA LTDA',
  nome_fantasia: '',
  descricao_situacao_cadastral: 'ATIVA',
  descricao_tipo_de_logradouro: 'RUA',
  logradouro: 'DAS FLORES',
  numero: '10',
  complemento: '',
  bairro: 'CENTRO',
  municipio: 'GOIANIA',
  uf: 'GO',
  cep: 7400000,
  qsa: [
    {
      identificador_de_socio: 2,
      nome_socio: 'MARIA DA SILVA SOUZA',
      cnpj_cpf_do_socio: '***487787**',
      codigo_qualificacao_socio: 49,
      qualificacao_socio: 'Sócio-Administrador',
    },
    {
      identificador_de_socio: 1,
      nome_socio: 'HOLDING XYZ LTDA',
      cnpj_cpf_do_socio: '99888777000155',
      codigo_qualificacao_socio: 22,
      qualificacao_socio: 'Sócio',
    },
  ],
};

describe('CompanyRegistryService', () => {
  let service: CompanyRegistryService;
  const brasilApi = { companyRegistry: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompanyRegistryService,
        { provide: BrasilApiService, useValue: brasilApi },
      ],
    }).compile();
    service = module.get(CompanyRegistryService);
  });

  it('só pessoa física entra como possível representante', async () => {
    brasilApi.companyRegistry.mockResolvedValue(raw);

    const record = await service.lookup(CNPJ);

    expect(record.partners).toEqual([
      {
        name: 'MARIA DA SILVA SOUZA',
        qualification: 'Sócio-Administrador',
        qualificationCode: 49,
        maskedDocument: '***487787**',
      },
    ]);
    expect(record.cnpj).toBe('11222333000181');
    expect(record.isActive).toBe(true);
    // Sem nome fantasia no registro, fica nulo — a tela usa a razão social.
    expect(record.tradeName).toBeNull();
    expect(record.address.zipcode).toBe('07400000');
  });

  it('a visão da tela nunca traz o quadro societário', async () => {
    brasilApi.companyRegistry.mockResolvedValue(raw);

    const view = await service.publicView(CNPJ);

    expect(view).toMatchObject({
      found: true,
      legalName: 'STUDIO NORTE ARQUITETURA LTDA',
      canVerifyRepresentative: true,
    });
    expect(JSON.stringify(view)).not.toContain('MARIA');
    expect(JSON.stringify(view)).not.toContain('487787');
  });

  it('consulta a mesma empresa uma vez só em sequência', async () => {
    brasilApi.companyRegistry.mockResolvedValue(raw);
    await service.lookup(CNPJ);
    await service.lookup('11222333000181');
    expect(brasilApi.companyRegistry).toHaveBeenCalledTimes(1);
  });

  it('CNPJ inexistente devolve nulo', async () => {
    brasilApi.companyRegistry.mockRejectedValue(new NotFoundException());
    await expect(service.lookup(CNPJ)).resolves.toBeNull();
    expect((await service.publicView(CNPJ)).found).toBe(false);
  });

  it('base pública fora do ar é indisponibilidade, não "não encontrado"', async () => {
    brasilApi.companyRegistry.mockRejectedValue(new Error('timeout'));
    await expect(service.lookup(CNPJ)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('CNPJ com dígito errado nem chega à base', async () => {
    await expect(service.lookup('11.222.333/0001-82')).rejects.toThrow(
      BadRequestException,
    );
    expect(brasilApi.companyRegistry).not.toHaveBeenCalled();
  });
});
