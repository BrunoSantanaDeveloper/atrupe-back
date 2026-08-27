import { assertSameCompany, onlyDigits } from './migrate-legacy-tenant';
import { EXTRACTORS } from './legacy-extractors';
import {
  CLIENT_EXTRACTOR,
  EMPLOYEE_EXTRACTOR,
  PRODUCT_CODE_SQL,
  PRODUCT_EXTRACTOR,
  SUPPLIER_EXTRACTOR,
  normalizeLegacyDate,
  toSimNao,
} from './legacy-extractors';

describe('normalizeLegacyDate', () => {
  it('descarta a data sentinela que o legado usa para "vazio"', () => {
    // Sem isso, todo cliente migraria com data de nascimento em 1899.
    expect(normalizeLegacyDate('1899-11-30T03:06:28.000Z')).toBe('');
    expect(normalizeLegacyDate(new Date('1899-11-30'))).toBe('');
  });

  it('mantém data real', () => {
    expect(normalizeLegacyDate('1985-04-17T00:00:00.000Z')).toBe('1985-04-17');
  });

  it('trata nulo e valor inválido', () => {
    expect(normalizeLegacyDate(null)).toBe('');
    expect(normalizeLegacyDate('')).toBe('');
    expect(normalizeLegacyDate('não é data')).toBe('');
  });
});

describe('toSimNao', () => {
  it('converte o status numérico do legado', () => {
    expect(toSimNao(1)).toBe('SIM');
    expect(toSimNao(0)).toBe('NAO');
    expect(toSimNao(null)).toBe('NAO');
  });
});

describe('assertSameCompany', () => {
  const novo = { name: 'Cliente Piloto', cnpj: '11.222.333/0001-81' };

  it('aceita quando o CNPJ bate, ignorando pontuação', () => {
    expect(() =>
      assertSameCompany({ cnpj: '11222333000181' }, novo),
    ).not.toThrow();
  });

  it('recusa base de outro cliente', () => {
    // A proteção mais importante do script: nome de base trocado despejaria
    // os dados de um cliente dentro da empresa de outro, sem nenhum aviso.
    expect(() =>
      assertSameCompany(
        { cnpj: '99.888.777/0001-66', razao_social: 'Outra Empresa' },
        novo,
      ),
    ).toThrow(/não corresponde à empresa da conta/);
  });

  it('recusa quando falta CNPJ de um dos lados', () => {
    expect(() => assertSameCompany({ cnpj: '' }, novo)).toThrow(/CNPJ ausente/);
    expect(() =>
      assertSameCompany(
        { cnpj: '11222333000181' },
        {
          name: 'X',
          cnpj: null,
        },
      ),
    ).toThrow(/CNPJ ausente/);
  });
});

describe('onlyDigits', () => {
  it('extrai apenas dígitos', () => {
    expect(onlyDigits('11.222.333/0001-81')).toBe('11222333000181');
    expect(onlyDigits(null)).toBe('');
  });
});

describe('EMPLOYEE_EXTRACTOR.map', () => {
  const legacyRow = {
    codigoLegado: 15,
    nome: 'ANA VENDEDORA',
    cpf: '123.456.789-09',
    rg: '4973889',
    setor: 'Comercial',
    cargo: 'Vendedor',
    perfilVendedor: 'Gerente de Venda',
    salario: '7000.00',
    ativo: 1,
    telefone: '',
    celular: '(11) 98888-7777',
  };

  it('produz as colunas que o importador espera', () => {
    const row = EMPLOYEE_EXTRACTOR.map(legacyRow);

    expect(row.codigoLegado).toBe('15');
    expect(row.nome).toBe('ANA VENDEDORA');
    expect(row.ativo).toBe('SIM');
    expect(row.perfilVendedor).toBe('Gerente de Venda');
    expect(row.celular).toBe('(11) 98888-7777');
  });

  it('marca o desligado como NAO, sem descartá-lo', () => {
    const row = EMPLOYEE_EXTRACTOR.map({ ...legacyRow, ativo: 0 });
    expect(row.ativo).toBe('NAO');
  });

  it('normaliza nulo para string vazia', () => {
    const row = EMPLOYEE_EXTRACTOR.map({
      ...legacyRow,
      cpf: null,
      telefone: null,
    });
    expect(row.cpf).toBe('');
    expect(row.telefone).toBe('');
  });
});

describe('CLIENT_EXTRACTOR.map', () => {
  const legacyRow = {
    codigoLegado: 482,
    nome: 'Cliente Exemplo',
    razaoSocial: 'Cliente Exemplo LTDA',
    cpf: null,
    cnpj: '11.222.333/0001-81',
    rg: null,
    tipoLegado: 2,
    dataNascimento: '1899-11-30T03:06:28.000Z',
    filial: 0,
    observacoes: null,
    cep: '88.303-220',
    rua: 'Avenida Getúlio Vargas',
    numero: '162',
    complemento: null,
    bairro: 'Vila Operária',
    cidade: 'ITAJAÍ',
    uf: 'SC',
    email: 'contato@exemplo.com',
    telefone: '(11) 3333-4444',
    celular: null,
  };

  it('traduz o tipo de entidade do legado', () => {
    expect(CLIENT_EXTRACTOR.map(legacyRow).tipo).toBe('EMPRESA');
    expect(CLIENT_EXTRACTOR.map({ ...legacyRow, tipoLegado: 1 }).tipo).toBe(
      'PESSOA',
    );
  });

  it('descarta a data sentinela em vez de gravar 1899', () => {
    expect(CLIENT_EXTRACTOR.map(legacyRow).dataNascimento).toBe('');
  });

  it('preenche o endereço e o código do legado', () => {
    const row = CLIENT_EXTRACTOR.map(legacyRow);

    expect(row.codigoLegado).toBe('482');
    expect(row.cidade).toBe('ITAJAÍ');
    expect(row.uf).toBe('SC');
    expect(row.complemento).toBe('');
  });
});

describe('SQL dos extratores', () => {
  it('restringe todas as tabelas à base informada', () => {
    // Uma tabela sem prefixo leria da base errada, que é o mesmo risco que o
    // conferidor de CNPJ existe para evitar.
    for (const extractor of EXTRACTORS) {
      const sql = extractor.sql('acn_000001');
      const tableRefs = sql.match(/(?:FROM|JOIN)\s+(\S+)/gi) || [];

      expect(tableRefs.length).toBeGreaterThan(0);
      for (const ref of tableRefs) {
        expect(ref).toContain('acn_000001.');
      }
    }
  });
});

describe('SUPPLIER_EXTRACTOR.map', () => {
  const legacyRow = {
    codigoLegado: 12,
    nome: 'Empresa de Energia',
    razaoSocial: '',
    cpf: '',
    cnpj: '',
    rg: null,
    tipoLegado: 2,
    filial: 0,
    observacoes: null,
    categoria: 'Administrativo',
    cep: '',
    rua: '',
    numero: '',
    complemento: null,
    bairro: '',
    cidade: 'ITAJAÍ',
    uf: 'SC',
    email: null,
    telefone: null,
    celular: null,
  };

  it('mantém o código do legado como identidade', () => {
    // 22 dos 25 fornecedores da base piloto não têm documento: sem o código,
    // reprocessar duplicaria a base.
    const row = SUPPLIER_EXTRACTOR.map(legacyRow);

    expect(row.codigoLegado).toBe('12');
    expect(row.cnpj).toBe('');
    expect(row.cpf).toBe('');
  });

  it('traduz o tipo de entidade', () => {
    expect(SUPPLIER_EXTRACTOR.map(legacyRow).tipo).toBe('EMPRESA');
    expect(SUPPLIER_EXTRACTOR.map({ ...legacyRow, tipoLegado: 1 }).tipo).toBe(
      'PESSOA',
    );
  });

  it('leva a categoria, que o importador cria se não existir', () => {
    expect(SUPPLIER_EXTRACTOR.map(legacyRow).categoria).toBe('Administrativo');
  });
});

describe('PRODUCT_EXTRACTOR', () => {
  const legacyRow = {
    codigo: 'WBRV-47',
    nome: 'WIND BANNER 3 MT REVENDA',
    descricao: null,
    setor: 'Impressão',
    grupo: 'Material de Impressão',
    unidadeMedida: '',
    valorUnitario: '18.87',
  };

  it('usa o código já desambiguado pela consulta', () => {
    const row = PRODUCT_EXTRACTOR.map(legacyRow);

    expect(row.codigo).toBe('WBRV-47');
    expect(row.setor).toBe('Impressão');
    expect(row.valorUnitario).toBe('18.87');
  });

  it('deriva código único apenas quando o original repete', () => {
    // No legado o código não é único: 57 produtos usam 46 códigos, e as
    // repetições são produtos distintos (um "WBRV" cobre quatro tamanhos).
    // Sem isso, o importador fundiria produtos diferentes num só registro.
    const sql = PRODUCT_CODE_SQL('acn_000001', 'p');

    expect(sql).toContain('acn_000001.est_produto');
    expect(sql).toContain("CONCAT(p.cod, '-', p.idproduto)");
    expect(sql).toContain('ELSE p.cod');
  });
});
