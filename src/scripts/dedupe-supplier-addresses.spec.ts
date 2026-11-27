import {
  duplicateAddressGroups,
  SupplierAddress,
} from './dedupe-supplier-addresses';

/**
 * A gravação do fornecedor apagava os endereços pelo `ownerId` (que é do
 * cliente) e recriava os do formulário, então cada salvamento deixava uma
 * cópia a mais. O reparo tira as cópias e não pode levar endereço diferente
 * nem endereço de outro fornecedor.
 */
describe('duplicateAddressGroups', () => {
  const endereco = (over: Partial<SupplierAddress> = {}): SupplierAddress => ({
    id: 'a1',
    supplierId: 'forn-1',
    type: 'Principal',
    zipcode: '13389200',
    street: 'Rua dos Brilhantes',
    number: '149',
    complement: null,
    neighborhood: 'Centro',
    city: 'Limeira',
    state: 'SP',
    ...over,
  });

  it('mantém uma cópia e devolve as outras', () => {
    const grupos = duplicateAddressGroups([
      endereco({ id: 'a1' }),
      endereco({ id: 'a2' }),
      endereco({ id: 'a3' }),
    ]);

    expect(grupos).toEqual([{ manter: 'a1', remover: ['a2', 'a3'] }]);
  });

  it('não junta endereços diferentes', () => {
    const grupos = duplicateAddressGroups([
      endereco({ id: 'a1' }),
      endereco({ id: 'a2', number: '150' }),
      endereco({ id: 'a3', street: 'Rua Outra' }),
      endereco({ id: 'a4', type: 'Entrega' }),
      endereco({ id: 'a5', complement: 'Sala 2' }),
    ]);

    expect(grupos).toEqual([]);
  });

  it('não junta o endereço igual de outro fornecedor', () => {
    const grupos = duplicateAddressGroups([
      endereco({ id: 'a1' }),
      endereco({ id: 'a2', supplierId: 'forn-2' }),
    ]);

    expect(grupos).toEqual([]);
  });

  it('junta o mesmo CEP escrito com e sem pontuação', () => {
    const grupos = duplicateAddressGroups([
      endereco({ id: 'a1', zipcode: '13.389-200' }),
      endereco({ id: 'a2', zipcode: '13389200' }),
    ]);

    expect(grupos).toEqual([{ manter: 'a1', remover: ['a2'] }]);
  });

  it('junta o mesmo endereço com maiúsculas e espaços diferentes', () => {
    const grupos = duplicateAddressGroups([
      endereco({ id: 'a1', street: 'Rua dos Brilhantes' }),
      endereco({ id: 'a2', street: '  RUA  DOS BRILHANTES ' }),
    ]);

    expect(grupos).toEqual([{ manter: 'a1', remover: ['a2'] }]);
  });

  it('trata endereço vazio, que a migração deixou sem nada', () => {
    const vazio = {
      type: 'Principal',
      zipcode: null,
      street: null,
      number: null,
      complement: null,
      neighborhood: null,
      city: null,
      state: null,
    };

    const grupos = duplicateAddressGroups([
      endereco({ id: 'a1', ...vazio }),
      endereco({ id: 'a2', ...vazio }),
    ]);

    expect(grupos).toEqual([{ manter: 'a1', remover: ['a2'] }]);
  });
});
