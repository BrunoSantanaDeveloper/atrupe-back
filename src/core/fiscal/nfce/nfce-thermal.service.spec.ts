import { NotFoundException } from '@nestjs/common';
import { NfceStatus } from '@prisma/client';
import { NfceThermalService } from './nfce-thermal.service';

describe('NfceThermalService', () => {
  const prisma = {
    nfce: {
      findFirst: jest.fn(),
    },
  };

  let service: NfceThermalService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NfceThermalService(prisma as any);
  });

  it('should generate thermal DANFE HTML', async () => {
    prisma.nfce.findFirst.mockResolvedValue({
      id: 'nfce-1',
      companyId: 'company-1',
      numero: 10,
      serie: 1,
      status: NfceStatus.AUTHORIZED,
      ambiente: 1,
      valorTotal: 25,
      valorDesconto: 0,
      valorTroco: 0,
      consumidorNome: 'Cliente Teste',
      cpfConsumidor: '12345678900',
      informacoesComplementares: 'Obrigado pela preferencia',
      protocolo: '123456789',
      chaveAcesso: '35260612345678000165650010000000101234567890',
      qrCodeUrl: 'https://example.com/qrcode.png',
      urlConsulta: 'https://example.com/consulta',
      dataAutorizacao: new Date('2026-06-08T12:00:00.000Z'),
      dataEmissao: new Date('2026-06-08T12:00:00.000Z'),
      itensSnapshot: [
        {
          codigo: '001',
          descricao: 'Produto Teste',
          unidade: 'UN',
          quantidade: 1,
          valorUnitario: 25,
        },
      ],
      pagamentosSnapshot: [{ tipo: '01', valor: 25 }],
      company: {
        name: 'Empresa Teste',
        legalName: 'Empresa Teste LTDA',
        cnpj: '12345678000123',
        stateRegistration: '123456789',
        address: [
          {
            street: 'Rua Teste',
            number: '100',
            neighborhood: 'Centro',
            city: 'Sao Paulo',
            state: 'SP',
            zipcode: '01000-000',
          },
        ],
      },
    });

    const html = await service.generateHtml('nfce-1', 'company-1');

    expect(html).toContain('DANFE NFC-e');
    expect(html).toContain('Empresa Teste LTDA');
    expect(html).toContain('Produto Teste');
    expect(html).toContain('25,00');
    expect(html).toContain('window.print');
  });

  it('should throw when NFC-e is not found', async () => {
    prisma.nfce.findFirst.mockResolvedValue(null);

    await expect(service.generateHtml('nfce-1', 'company-1')).rejects.toThrow(
      NotFoundException,
    );
  });
});
