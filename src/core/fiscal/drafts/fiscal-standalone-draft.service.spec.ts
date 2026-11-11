import { NotFoundException } from '@nestjs/common';

import { FiscalStandaloneDraftService } from './fiscal-standalone-draft.service';

/**
 * O rascunho e' o unico lugar do fiscal onde guardar dado incompleto e'
 * correto: a tela avulsa perdia tudo ao sair da pagina. O que estes testes
 * protegem e' o isolamento por empresa — um id de rascunho nao pode alcancar
 * o rascunho de outra conta — e o fato de o payload nao ser validado.
 */
describe('FiscalStandaloneDraftService', () => {
  const companyId = 'empresa-1';
  let prisma: any;
  let service: FiscalStandaloneDraftService;

  beforeEach(() => {
    prisma = {
      fiscalStandaloneDraft: {
        create: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
    };
    service = new FiscalStandaloneDraftService(prisma);
  });

  it('cria quando não vem id, guardando o payload como está', async () => {
    const payload = { itens: [{ descricao: 'pela metade' }] };
    prisma.fiscalStandaloneDraft.create.mockResolvedValue({ id: 'rasc-1' });

    await service.save(
      companyId,
      { docType: 'NFCE', payload, description: 'NATALHA' } as any,
      { id: 'user-1', name: 'Diego' },
    );

    expect(prisma.fiscalStandaloneDraft.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId,
        docType: 'NFCE',
        description: 'NATALHA',
        payload,
        createdBy: 'user-1',
        createdByName: 'Diego',
      }),
    });
  });

  /**
   * `update` por id sozinho alcancaria o rascunho de outra empresa; por isso
   * a gravacao usa updateMany com o companyId no where.
   */
  it('atualiza sempre com a empresa no filtro', async () => {
    prisma.fiscalStandaloneDraft.updateMany.mockResolvedValue({ count: 1 });
    prisma.fiscalStandaloneDraft.findFirst.mockResolvedValue({ id: 'rasc-1' });

    await service.save(companyId, {
      id: 'rasc-1',
      docType: 'NFE',
      payload: {},
    } as any);

    expect(prisma.fiscalStandaloneDraft.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'rasc-1', companyId } }),
    );
  });

  it('recusa atualizar rascunho de outra empresa', async () => {
    prisma.fiscalStandaloneDraft.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.save(companyId, {
        id: 'de-outra-conta',
        docType: 'NFE',
        payload: {},
      } as any),
    ).rejects.toThrow(NotFoundException);
  });

  it('recusa abrir e apagar rascunho de outra empresa', async () => {
    prisma.fiscalStandaloneDraft.findFirst.mockResolvedValue(null);
    prisma.fiscalStandaloneDraft.deleteMany.mockResolvedValue({ count: 0 });

    await expect(service.findOne(companyId, 'de-outra')).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.remove(companyId, 'de-outra')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('lista por tipo de documento quando pedido', async () => {
    prisma.fiscalStandaloneDraft.findMany.mockResolvedValue([]);

    await service.list(companyId, 'NFSE');

    expect(prisma.fiscalStandaloneDraft.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId, docType: 'NFSE' },
        orderBy: { updatedAt: 'desc' },
      }),
    );
  });
});
