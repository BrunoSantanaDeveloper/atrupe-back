import { BadRequestException, NotFoundException } from '@nestjs/common';
import { assertBelongsToCompany } from './company-scope';

describe('assertBelongsToCompany', () => {
  const delegate = { count: jest.fn() };

  beforeEach(() => jest.clearAllMocks());

  it('passa quando todos os ids são da empresa', async () => {
    delegate.count.mockResolvedValue(2);
    await assertBelongsToCompany(
      delegate,
      ['a', 'b', 'a'],
      { companyId: 'c-1' },
      'Não encontrado.',
    );
    expect(delegate.count).toHaveBeenCalledWith({
      where: { id: { in: ['a', 'b'] }, companyId: 'c-1' },
    });
  });

  it('recusa com 404 quando algum id é de outra empresa ou não existe', async () => {
    delegate.count.mockResolvedValue(1);
    await expect(
      assertBelongsToCompany(
        delegate,
        ['a', 'b'],
        { companyId: 'c-1' },
        'Fornecedor não encontrado.',
      ),
    ).rejects.toThrow(new NotFoundException('Fornecedor não encontrado.'));
  });

  it('aceita filtro pela relação', async () => {
    delegate.count.mockResolvedValue(1);
    await assertBelongsToCompany(
      delegate,
      'x',
      { client: { companyId: 'c-1' } },
      'Contato não encontrado.',
    );
    expect(delegate.count).toHaveBeenCalledWith({
      where: { id: { in: ['x'] }, client: { companyId: 'c-1' } },
    });
  });

  it.each([{ set: 'id-de-outra-empresa' }, ['x', { set: 'y' }], 42])(
    'valor presente que não é texto (%p) é recusado, sem consultar',
    async (ids) => {
      await expect(
        assertBelongsToCompany(delegate, ids as any, {}, 'x'),
      ).rejects.toThrow(new BadRequestException('Identificador inválido.'));
      expect(delegate.count).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, null, '', [], [null, '']])(
    'sem id (%p) não consulta',
    async (ids) => {
      await assertBelongsToCompany(delegate, ids as any, {}, 'x');
      expect(delegate.count).not.toHaveBeenCalled();
    },
  );
});
