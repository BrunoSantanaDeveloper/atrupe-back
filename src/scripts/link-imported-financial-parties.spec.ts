import {
  Cadastros,
  decidirVinculo,
  idLegadoDaDescricao,
} from './link-imported-financial-parties';

const cadastros = (): Cadastros => ({
  cliente: new Map([['482', 'cli-1']]),
  fornecedor: new Map([['57', 'for-1']]),
  colaborador: new Map([['12', 'col-1']]),
});

const papeis = (over: Partial<Record<string, string | null>> = {}) => ({
  cliente: null,
  fornecedor: null,
  colaborador: null,
  ...over,
});

describe('idLegadoDaDescricao', () => {
  it('lê o id que a carga põe no fim da descrição', () => {
    expect(idLegadoDaDescricao('FOLHA #188 - 09/2026 - SALÁRIO [2715]')).toBe(
      '2715',
    );
    expect(idLegadoDaDescricao('Venda 3495-V1 - placa [3679] ')).toBe('3679');
  });

  it('sem colchetes no fim, não há id', () => {
    expect(idLegadoDaDescricao('Aluguel de novembro')).toBeNull();
    expect(idLegadoDaDescricao(null)).toBeNull();
  });
});

describe('decidirVinculo', () => {
  it('folha: a conta a pagar aponta para o colaborador', () => {
    expect(
      decidirVinculo('payable', papeis({ colaborador: '12' }), cadastros()),
    ).toEqual({ vinculos: [{ campo: 'employeeId', id: 'col-1' }] });
  });

  it('despesa de quem é cliente e fornecedor fica no fornecedor', () => {
    expect(
      decidirVinculo(
        'payable',
        papeis({ cliente: '482', fornecedor: '57' }),
        cadastros(),
      ),
    ).toEqual({ vinculos: [{ campo: 'supplierId', id: 'for-1' }] });
  });

  it('despesa de quem é só cliente (estorno) fica no cliente', () => {
    expect(
      decidirVinculo('payable', papeis({ cliente: '482' }), cadastros()),
    ).toEqual({ vinculos: [{ campo: 'clientId', id: 'cli-1' }] });
  });

  it('receita fica no cliente, mesmo que ele também seja fornecedor', () => {
    expect(
      decidirVinculo(
        'receivable',
        papeis({ cliente: '482', fornecedor: '57' }),
        cadastros(),
      ),
    ).toEqual({ vinculos: [{ campo: 'clientId', id: 'cli-1' }] });
  });

  it('receita de quem é só fornecedor fica no fornecedor', () => {
    expect(
      decidirVinculo('receivable', papeis({ fornecedor: '57' }), cadastros()),
    ).toEqual({ vinculos: [{ campo: 'supplierId', id: 'for-1' }] });
  });

  it('papel sem cadastro no Atrupe diz qual falta', () => {
    expect(
      decidirVinculo('payable', papeis({ fornecedor: '999' }), cadastros()),
    ).toEqual({ motivo: 'sem cadastro no Atrupe (fornecedor 999)' });
  });

  it('receita de cliente sem cadastro não cai no fornecedor', () => {
    // A entidade é cliente: ligar ao fornecedor seria trocar de pessoa.
    expect(
      decidirVinculo(
        'receivable',
        papeis({ cliente: '999', fornecedor: '57' }),
        cadastros(),
      ),
    ).toEqual({ motivo: 'sem cadastro no Atrupe (cliente 999)' });
  });

  it('entidade sem papel nenhum fica sem ninguém', () => {
    expect(decidirVinculo('payable', papeis(), cadastros())).toEqual({
      motivo: 'a entidade não é cliente, fornecedor nem colaborador no legado',
    });
  });

  it('conta que não existe no legado', () => {
    expect(decidirVinculo('receivable', null, cadastros())).toEqual({
      motivo: 'conta não encontrada no legado',
    });
  });
});
