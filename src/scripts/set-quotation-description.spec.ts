import {
  documentLabel,
  quotationWhere,
  setQuotationDescription,
} from './set-quotation-description';

/**
 * A saída para o documento que a tela não salva. O script existe para gravar
 * um campo só, então o que importa testar é que ele acha o documento certo e
 * não grava sem autorização.
 */
describe('quotationWhere', () => {
  it('busca pelo id quando ele vem', () => {
    expect(quotationWhere({ id: 'abc' })).toEqual({ id: 'abc' });
  });

  it('busca pelo número dentro da empresa', () => {
    expect(quotationWhere({ companyId: 'emp', number: 9162 })).toEqual({
      companyId: 'emp',
      quotationNumber: 9162,
    });
  });

  it('filtra pela série quando informada', () => {
    // O número se repete entre séries: a migração cria uma série própria.
    expect(
      quotationWhere({ companyId: 'emp', number: 9162, series: 'LEG-V1' }),
    ).toEqual({
      companyId: 'emp',
      quotationNumber: 9162,
      series: { code: 'LEG-V1' },
    });
  });

  it('recusa busca sem id e sem número', () => {
    expect(() => quotationWhere({ companyId: 'emp' })).toThrow(/--id/);
  });
});

describe('documentLabel', () => {
  it('junta número e série', () => {
    expect(
      documentLabel({ quotationNumber: 9162, series: { code: 'LEG-V1' } }),
    ).toBe('9162-LEG-V1');
  });

  it('aceita documento sem série', () => {
    expect(documentLabel({ quotationNumber: 9162, series: null })).toBe('9162');
  });
});

describe('setQuotationDescription', () => {
  const doc = {
    id: 'doc-1',
    description: '22-09',
    quotationNumber: 9162,
    series: { code: 'LEG-V1' },
  };

  const prismaFake = (docs: any[]) => {
    const update = jest.fn();
    return {
      prisma: {
        quotation: { findMany: jest.fn().mockResolvedValue(docs), update },
      } as any,
      update,
    };
  };

  it('simula por padrão', async () => {
    const { prisma, update } = prismaFake([doc]);

    const mudanca = await setQuotationDescription(
      prisma,
      { id: 'doc-1' },
      '23-09',
    );

    expect(mudanca).toMatchObject({
      documento: '9162-LEG-V1',
      antes: '22-09',
      depois: '23-09',
      alterado: true,
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('grava só o campo pedido com --yes', async () => {
    const { prisma, update } = prismaFake([doc]);

    await setQuotationDescription(prisma, { id: 'doc-1' }, '23-09', {
      apply: true,
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: { description: '23-09' },
    });
  });

  it('não grava quando a descrição já é a pedida', async () => {
    const { prisma, update } = prismaFake([doc]);

    const mudanca = await setQuotationDescription(
      prisma,
      { id: 'doc-1' },
      '22-09',
      {
        apply: true,
      },
    );

    expect(mudanca.alterado).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('aceita limpar a descrição', async () => {
    const { prisma, update } = prismaFake([{ ...doc, description: null }]);

    const mudanca = await setQuotationDescription(prisma, { id: 'doc-1' }, '');

    expect(mudanca.alterado).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('recusa quando a busca traz mais de um documento', async () => {
    const { prisma, update } = prismaFake([doc, { ...doc, id: 'doc-2' }]);

    await expect(
      setQuotationDescription(prisma, { companyId: 'emp', number: 9162 }, 'x', {
        apply: true,
      }),
    ).rejects.toThrow(/2 documentos/);
    expect(update).not.toHaveBeenCalled();
  });

  it('avisa quando não acha o documento', async () => {
    const { prisma } = prismaFake([]);

    await expect(
      setQuotationDescription(prisma, { id: 'nao-existe' }, 'x'),
    ).rejects.toThrow(/Nenhum documento/);
  });
});
