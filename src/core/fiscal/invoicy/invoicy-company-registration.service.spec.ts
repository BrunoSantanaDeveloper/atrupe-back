import { BadRequestException } from '@nestjs/common';
import { FiscalEnvironment } from '@prisma/client';
import { InvoicyCompanyRegistrationService } from './invoicy-company-registration.service';

/**
 * O CSC que vai ao cadastro do provedor sai do emissor, já aparado pelo
 * resolvedor. Formato que o provedor não guarda é barrado aqui, antes de
 * qualquer chamada, com mensagem para quem configura.
 */
describe('InvoicyCompanyRegistrationService.syncNfceCsc', () => {
  const CSC = 'ABCDEF12-3456-7890-ABCD-EF1234567890';

  const montar = (csc: { cscId: string | null; cscToken: string | null }) => {
    const prisma = {
      company: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ cnpj: '13.205.998/0001-02' }),
      },
    };
    const http = {
      updateCompanyNfceCsc: jest.fn().mockResolvedValue({ alterado: true }),
    };
    const resolver = {
      getEmissorCredentialsForValidation: jest
        .fn()
        .mockResolvedValue({ ...csc, nfceSeries: 1, nfceNextNumber: 1 }),
    };
    const service = new InvoicyCompanyRegistrationService(
      prisma as any,
      {} as any,
      {} as any,
      http as any,
      resolver as any,
    );
    return { service, http, resolver };
  };

  it('envia o CSC do ambiente ativado ao cadastro do provedor', async () => {
    const { service, http, resolver } = montar({ cscId: '1', cscToken: CSC });

    await expect(
      service.syncNfceCsc('company-1', 'e1', FiscalEnvironment.PRODUCAO),
    ).resolves.toEqual({ alterado: true });

    expect(resolver.getEmissorCredentialsForValidation).toHaveBeenCalledWith(
      'company-1',
      'e1',
      FiscalEnvironment.PRODUCAO,
    );
    expect(http.updateCompanyNfceCsc).toHaveBeenCalledWith({
      cnpj: '13205998000102',
      cscId: '1',
      cscToken: CSC,
      environment: 'PRODUCAO',
      signal: undefined,
    });
  });

  it('barra identificador que o provedor não guarda, sem chamar o provedor', async () => {
    const { service, http } = montar({
      cscId: '374425537129440041',
      cscToken: CSC,
    });

    const erro = await service
      .syncNfceCsc('company-1', 'e1', FiscalEnvironment.PRODUCAO)
      .catch((e) => e);

    expect(erro).toBeInstanceOf(BadRequestException);
    expect(erro.message).toContain('até 6 dígitos');
    expect(http.updateCompanyNfceCsc).not.toHaveBeenCalled();
  });

  it('cobra o CSC quando o emissor não tem um', async () => {
    const { service, http } = montar({ cscId: null, cscToken: null });

    await expect(
      service.syncNfceCsc('company-1', 'e1', FiscalEnvironment.PRODUCAO),
    ).rejects.toThrow('CSC da NFC-e não configurado');
    expect(http.updateCompanyNfceCsc).not.toHaveBeenCalled();
  });
});

/**
 * A empresa que o Atrupe cadastra nasce no Invoicy sem o módulo NFC-e. Quando a
 * ativação precisa pedi-lo, o pedido fica no histórico do emissor.
 */
describe('InvoicyCompanyRegistrationService.ensureNfceModule', () => {
  const montar = (solicitado: boolean) => {
    const prisma = {
      company: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ cnpj: '01.327.126/0001-38' }),
      },
      invoicyConfig: {
        findUnique: jest.fn().mockResolvedValue({ name: 'Emissor Clapp' }),
      },
    };
    const audit = {
      commitWithOutcome: jest.fn(async (_dados: any, fn: any) => fn()),
    };
    const http = {
      ensureNfceModuleLicensed: jest.fn().mockResolvedValue({ solicitado }),
    };
    const service = new InvoicyCompanyRegistrationService(
      prisma as any,
      {} as any,
      audit as any,
      http as any,
      {} as any,
    );
    return { service, audit, http };
  };

  it('pede ao provedor com o CNPJ sem máscara e registra o pedido no histórico', async () => {
    const { service, audit, http } = montar(true);

    await expect(
      service.ensureNfceModule('company-1', 'e1', FiscalEnvironment.PRODUCAO),
    ).resolves.toEqual({ solicitado: true });

    expect(http.ensureNfceModuleLicensed).toHaveBeenCalledWith({
      companyId: 'company-1',
      cnpj: '01327126000138',
      environment: 'PRODUCAO',
      signal: undefined,
    });
    expect(audit.commitWithOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company-1',
        invoicyConfigId: 'e1',
        emissorName: 'Emissor Clapp',
        environment: FiscalEnvironment.PRODUCAO,
        description: expect.stringContaining('Módulo NFC-e ativado'),
        result: 'SUCCESS',
      }),
      expect.any(Function),
    );
  });

  it('não registra nada quando o módulo já estava ligado', async () => {
    const { service, audit } = montar(false);

    await expect(
      service.ensureNfceModule('company-1', 'e1', FiscalEnvironment.PRODUCAO),
    ).resolves.toEqual({ solicitado: false });
    expect(audit.commitWithOutcome).not.toHaveBeenCalled();
  });

  it('falha no histórico não derruba a ativação: o módulo já está ligado', async () => {
    const { service, audit } = montar(true);
    audit.commitWithOutcome.mockRejectedValue(new Error('banco fora'));
    jest
      .spyOn((service as any).logger, 'error')
      .mockImplementation(() => undefined);

    await expect(
      service.ensureNfceModule('company-1', 'e1', FiscalEnvironment.PRODUCAO),
    ).resolves.toEqual({ solicitado: true });
  });
});
