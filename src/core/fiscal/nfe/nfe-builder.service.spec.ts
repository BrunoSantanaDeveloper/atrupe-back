import { Test, TestingModule } from '@nestjs/testing';
import { NfeBuilderService } from './nfe-builder.service';
import { PrismaService } from 'nestjs-prisma';
import { fetchCepData } from '../utils/cep.util';
import { BadRequestException } from '@nestjs/common';

// Mock do utilitário externo de CEP
jest.mock('../utils/cep.util', () => ({
  fetchCepData: jest.fn(),
}));

describe('NfeBuilderService', () => {
  let service: NfeBuilderService;
  let mockFetchCepData: jest.Mock;

  const mockPrisma = {};

  const defaultConfig = {
    ambiente: 'PRODUCAO',
    ibgeCode: '3550308',
    serieNfe: 1,
    company: {
      cnpj: '00.000.000/0001-00',
      legalName: 'Empresa Emissora LTDA',
      stateRegistration: '123456789',
      address: {
        street: 'Rua Origem',
        number: '100',
        neighborhood: 'Centro',
        city: 'São Paulo',
        state: 'SP',
        zipcode: '01000-000',
      },
    },
  };

  const defaultDto: any = {
    destNome: 'Cliente Destino',
    destCnpjCpf: '111.111.111-11', // CPF - 11 dígitos
    destUf: 'SP',
    destMunicipio: 'São Paulo',
    destCep: '02000-000',
    destEndereco: 'Rua Destino',
    destNumero: '200',
    destBairro: 'Bairro B',
    items: [
      {
        productId: 'P1',
        description: 'Produto 1',
        quantity: 2,
        unitValue: 50.0,
        cfop: 5102,
        ncm: '12345678',
      },
    ],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NfeBuilderService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<NfeBuilderService>(NfeBuilderService);
    mockFetchCepData = fetchCepData as jest.Mock;

    // Default mock response para fetchCepData
    mockFetchCepData.mockResolvedValue({
      codigoIbge: '3550308',
      uf: 'SP',
      cidade: 'São Paulo',
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('deve estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('1. Inteligência de CFOP (Operação Interna vs Interestadual)', () => {
    it('deve manter o CFOP 5102 se a operação for interna (SP para SP)', async () => {
      const result = await service.buildInvoicyRequest(
        defaultDto,
        defaultConfig,
        1,
      );

      const itemConfigurado = result.Documento.det[0].prod;
      expect(itemConfigurado.CFOP).toBe(5102);
    });

    it('deve alterar o CFOP 5102 para 6102 se a operação for interestadual (SP para RJ)', async () => {
      // Destinatário no Rio de Janeiro
      const dtoRj = { ...defaultDto, destUf: 'RJ' };

      // Ajusta o mock do CEP para retornar RJ
      mockFetchCepData.mockResolvedValueOnce({
        codigoIbge: '3304557',
        uf: 'RJ',
        cidade: 'Rio de Janeiro',
      });

      const result = await service.buildInvoicyRequest(dtoRj, defaultConfig, 1);

      const itemConfigurado = result.Documento.det[0].prod;
      expect(itemConfigurado.CFOP).toBe(6102);
    });

    it('deve alterar o CFOP 6102 para 5102 se a operação for interna equivocada (SP para SP)', async () => {
      // O usuário informou CFOP de fora do estado, mas vendeu para dentro
      const dtoSpErrado = {
        ...defaultDto,
        items: [{ ...defaultDto.items[0], cfop: 6102 }],
      };

      const result = await service.buildInvoicyRequest(
        dtoSpErrado,
        defaultConfig,
        1,
      );

      const itemConfigurado = result.Documento.det[0].prod;
      expect(itemConfigurado.CFOP).toBe(5102); // O Builder corrigiu para 5xxx
    });
  });

  describe('2. Acesso Externo ao CEP e cMun', () => {
    it('deve utilizar os dados do utilitário fetchCepData quando acionado', async () => {
      await service.buildInvoicyRequest(defaultDto, defaultConfig, 1);
      expect(mockFetchCepData).toHaveBeenCalledWith('02000-000');
    });

    it('deve lançar BadRequestException se o CEP não retornar cMun válido e não houver um fallback', async () => {
      // Simula uma falha na API de CEP
      mockFetchCepData.mockResolvedValueOnce(null);

      await expect(
        service.buildInvoicyRequest(defaultDto, defaultConfig, 1),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('3. Trava de Segurança de Homologação', () => {
    it('deve utilizar o nome obrigatório na razão social do destinatário quando for HOMOLOGACAO', async () => {
      const homologConfig = { ...defaultConfig, ambiente: 'HOMOLOGACAO' };

      const result = await service.buildInvoicyRequest(
        defaultDto,
        homologConfig,
        1,
      );

      const dest = result.Documento.dest;
      expect(dest.xNome_dest).toBe(
        'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL',
      );
      expect(result.Documento.ide.tpAmb).toBe(2); // 2 = Homologação
    });

    it('deve preservar o nome original do destinatário quando for PRODUCAO', async () => {
      const prodConfig = { ...defaultConfig, ambiente: 'PRODUCAO' };

      const result = await service.buildInvoicyRequest(
        defaultDto,
        prodConfig,
        1,
      );

      const dest = result.Documento.dest;
      expect(dest.xNome_dest).toBe('Cliente Destino');
      expect(result.Documento.ide.tpAmb).toBe(1); // 1 = Produção
    });
  });

  describe('4. Identificação do Consumidor Final (indFinal)', () => {
    it('deve setar indFinal = 1 (Consumidor Final) se for um CPF (11 dígitos)', async () => {
      const dtoCpf = { ...defaultDto, destCnpjCpf: '111.222.333-44' }; // 11 números

      const result = await service.buildInvoicyRequest(
        dtoCpf,
        defaultConfig,
        1,
      );

      expect(result.Documento.ide.indFinal).toBe(1);
      expect(result.Documento.dest.CPF_dest).toBe('11122233344');
      expect(result.Documento.dest.CNPJ_dest).toBeUndefined();
    });

    it('deve setar indFinal = 0 (Normal) se for um CNPJ (14 dígitos)', async () => {
      const dtoCnpj = { ...defaultDto, destCnpjCpf: '11.222.333/0001-44' }; // 14 números

      const result = await service.buildInvoicyRequest(
        dtoCnpj,
        defaultConfig,
        1,
      );

      expect(result.Documento.ide.indFinal).toBe(0);
      expect(result.Documento.dest.CNPJ_dest).toBe('11222333000144');
      expect(result.Documento.dest.CPF_dest).toBeUndefined();
    });
  });

  describe('5. Tratamento de GTIN / Código de Barras', () => {
    it('deve passar o EAN se for válido (8, 12, 13 ou 14 dígitos)', async () => {
      const dtoComEan = {
        ...defaultDto,
        items: [{ ...defaultDto.items[0], ean: '1234567890123' }], // 13 dígitos
      };

      const result = await service.buildInvoicyRequest(
        dtoComEan,
        defaultConfig,
        1,
      );

      expect(result.Documento.det[0].prod.cEAN).toBe('1234567890123');
    });

    it('deve substituir o EAN por "SEM GTIN" se for inválido (ex: letras, ou tamanho errado)', async () => {
      const dtoEanInvalido = {
        ...defaultDto,
        items: [{ ...defaultDto.items[0], ean: 'CODIGO_INTERNO' }],
      };

      const result = await service.buildInvoicyRequest(
        dtoEanInvalido,
        defaultConfig,
        1,
      );

      expect(result.Documento.det[0].prod.cEAN).toBe('SEM GTIN');
    });
  });

  describe('6. Cálculo de Totais', () => {
    it('deve somar corretamente a quantidade x valor unitário e abater desconto', async () => {
      const dtoValores = {
        ...defaultDto,
        items: [
          { quantity: 2, unitValue: 50.0, discount: 10.0 }, // 100 - 10 = 90
          { quantity: 1, unitValue: 20.0, discount: 0.0 }, // 20 - 0 = 20
        ], // Total = 110
      };

      const result = await service.buildInvoicyRequest(
        dtoValores,
        defaultConfig,
        1,
      );

      const totais = result.Documento.total.ICMStot;
      expect(totais.vProd_ttlnfe).toBe('110.00'); // Valor total bruto ou líquido dos produtos na regra local do mock
      expect(totais.vDesc_ttlnfe).toBe('10.00');
    });
  });
});
