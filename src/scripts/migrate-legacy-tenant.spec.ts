import {
  assertSameCompany,
  onlyDigits,
  prepareReferences,
  prepareStep,
} from './migrate-legacy-tenant';
import { EXTRACTORS } from './legacy-extractors';
import { QUOTATION_IMPORT_SCHEMA } from '../core/import/schemas/quotation-import.schema';
import { ORDER_IMPORT_SCHEMA } from '../core/import/schemas/order-import.schema';
import {
  CLIENT_EXTRACTOR,
  EMPLOYEE_EXTRACTOR,
  FINANCIAL_EXTRACTOR,
  LEGACY_COST_TYPE,
  decimal,
  ORDER_EXTRACTOR,
  PAYMENT_CONDITION_EXTRACTOR,
  PRODUCT_CODE_SQL,
  PRODUCT_EXTRACTOR,
  QUOTATION_EXTRACTOR,
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

describe('extratores de venda', () => {
  const saleRow = {
    NumeroVenda: 2154,
    Serie: 'T1',
    statusLegado: 3,
    statusEntrega: 4,
    DataVenda: '2026-08-01T12:00:00.000Z',
    DataEntrega: '2026-08-10T00:00:00.000Z',
    ClienteCodigoLegado: 482,
    ClienteNome: 'Cliente Exemplo',
    VendedorCodigoLegado: 15,
    CondicaoPagamentoCodigoLegado: 3,
    tipoEntregaLegado: 1,
    FreteCusto: '0.00',
    FreteValor: '0.00',
    ItemID: 9001,
    ProdutoCodigo: 'WBRV-47',
    ProdutoNome: 'WIND BANNER 3 MT',
    Quantidade: '2',
    ValorUnitario: '110.00',
    ValorTotal: '220.00',
    Desconto: '0.00',
    ObservacaoItem: '',
  };

  it('identifica a venda por códigos do legado, não por documento nem e-mail', () => {
    const row = ORDER_EXTRACTOR.map(saleRow);

    expect(row.ClienteCodigoLegado).toBe('482');
    expect(row.VendedorCodigoLegado).toBe('15');
    expect(row.CondicaoPagamentoCodigoLegado).toBe('3');
    expect(row.ClienteCpfCnpj).toBe('');
    expect(row.VendedorEmail).toBe('');
  });

  it('deriva o status da ordem pela entrega, com o cancelamento vencendo', () => {
    expect(ORDER_EXTRACTOR.map(saleRow).StatusOrdem).toBe('FINISHED');
    expect(
      ORDER_EXTRACTOR.map({ ...saleRow, statusEntrega: 2 }).StatusOrdem,
    ).toBe('IN_PRODUCTION');
    // Ordem cancelada continua cancelada mesmo com entrega finalizada
    expect(
      ORDER_EXTRACTOR.map({ ...saleRow, statusLegado: 4 }).StatusOrdem,
    ).toBe('CANCELED');
  });

  it('traduz o tipo de entrega', () => {
    expect(ORDER_EXTRACTOR.map(saleRow).TipoEntrega).toBe('PICKUP');
    expect(
      ORDER_EXTRACTOR.map({ ...saleRow, tipoEntregaLegado: 2 }).TipoEntrega,
    ).toBe('CARRIER');
  });

  it('não preenche parcelas na venda', () => {
    // O contas a receber vem do financeiro do legado, com as parcelas reais.
    // Preencher aqui criaria um segundo recebível para a mesma venda.
    const row: any = ORDER_EXTRACTOR.map(saleRow);

    expect(row.Parcela1Valor).toBeUndefined();
    expect(row.QtdParcelas).toBeUndefined();
    expect(row.EntradaValor).toBeUndefined();
  });

  it('separa orçamento de ordem pelo status da origem', () => {
    expect(QUOTATION_EXTRACTOR.sql('acn_1')).toContain('IN (1, 2)');
    expect(ORDER_EXTRACTOR.sql('acn_1')).toContain('IN (3, 4)');
  });

  it('traduz a situação do orçamento pelo substatus do legado', () => {
    // No legado: status 1 substatus 1 = Digitação, substatus 2 = Fechado (que
    // a tela dele lista como Aguardando). Tudo virava digitação no Atrupe.
    const digitacao = QUOTATION_EXTRACTOR.map({
      ...saleRow,
      statusLegado: 1,
      substatusLegado: 1,
    });
    const fechado = QUOTATION_EXTRACTOR.map({
      ...saleRow,
      statusLegado: 1,
      substatusLegado: 2,
    });

    expect(digitacao.Status).toBe('OPEN');
    expect(fechado.Status).toBe('CONCLUIDO');
  });

  it('trata o "orçamento cancelado" do legado como rejeitado', () => {
    // Os substatus do status 2 são motivos de perda — concorrência, valor
    // acima do esperado, validade expirada —, que é o Rejeitados da tela.
    const perdido = QUOTATION_EXTRACTOR.map({
      ...saleRow,
      statusLegado: 2,
      substatusLegado: 34,
    });

    expect(perdido.Status).toBe('REJEITADO');
  });

  it('traz a data de fechamento do orçamento', () => {
    const row = QUOTATION_EXTRACTOR.map({
      ...saleRow,
      dataFechamento: '2024-11-16T14:32:00.000Z',
    });

    expect(row.DataConclusao).toBe('2024-11-16');
  });

  it('lê a entrega por subconsulta, não por junção', () => {
    // Há um registro de entrega por item: juntar multiplicaria as linhas.
    const sql = ORDER_EXTRACTOR.sql('acn_1');
    expect(sql).not.toMatch(/JOIN\s+acn_1\.sales_entrega/);
    expect(sql).toContain('FROM acn_1.sales_entrega e2');
  });

  it('traz só o item que é produto de verdade', () => {
    // Os tipos 90, 98 e 99 são comissão e entrega: importá-los criaria
    // produtos inexistentes e dobraria valores.
    expect(ORDER_EXTRACTOR.sql('acn_1')).toContain('fkidtipovendaitem = 1');
  });
});

describe('FINANCIAL_EXTRACTOR', () => {
  const parcela = {
    contaLegado: 1811,
    tipoLegado: 1,
    Referencia: 'Venda 2179-T1 - ADESIVOS',
    Observacao: '',
    DataReferencia: '2026-08-28T03:00:00.000Z',
    ValorTotal: '2130.89',
    ClienteCodigoLegado: 482,
    Natureza: 'Operacional',
    SubCategoria: 'Vendas',
    ContaBancaria: 'PIX',
    Parcela: 1,
    QuantidadeParcelas: 2,
    DataVencimento: '2026-09-28T03:00:00.000Z',
    ValorParcela: '1065.45',
    ValorPago: '0.00',
    DataPagamento: null,
    CondicaoPagamentoCodigoLegado: 3,
  };

  it('gera uma linha por parcela, sem o teto de três da venda', () => {
    // Na base piloto há lançamentos com até seis parcelas.
    const row = FINANCIAL_EXTRACTOR.map(parcela);

    expect(row.Parcela).toBe('1');
    expect(row.QuantidadeParcelas).toBe('2');
    expect(row.ValorParcela).toBe('1065.45');
  });

  it('deriva o status pelo pagamento', () => {
    expect(FINANCIAL_EXTRACTOR.map(parcela).Status).toBe('PENDENTE');
    expect(
      FINANCIAL_EXTRACTOR.map({
        ...parcela,
        DataPagamento: '2026-09-28T03:00:00.000Z',
      }).Status,
    ).toBe('PAGO');
  });

  it('inclui o id do lançamento na descrição', () => {
    // O importador agrupa por tipo, descrição e data: sem o id, dois
    // lançamentos do mesmo dia com o mesmo texto virariam um só.
    expect(FINANCIAL_EXTRACTOR.map(parcela).Descricao).toContain('[1811]');
  });

  it('traduz receita e despesa', () => {
    expect(FINANCIAL_EXTRACTOR.map(parcela).Tipo).toBe('RECEITA');
    expect(FINANCIAL_EXTRACTOR.map({ ...parcela, tipoLegado: 2 }).Tipo).toBe(
      'DESPESA',
    );
  });

  it('ignora lançamento cancelado', () => {
    expect(FINANCIAL_EXTRACTOR.sql('acn_1')).toContain(
      'dtcancelamento IS NULL',
    );
  });
});

describe('PAYMENT_CONDITION_EXTRACTOR', () => {
  const legacyRow = {
    codigoLegado: 3,
    nome: 'À prazo',
    formaPagamentoLegado: 5,
    custoTipoLegado: 2,
    custo: '3.90',
    minParcelas: 1,
    maxParcelas: 6,
    intervaloDias: 28,
    ativo: 1,
  };

  it('entra antes das vendas na ordem de carga', () => {
    // A venda referencia a condição pelo código do legado: se a condição não
    // existir antes, toda venda falha ao procurá-la.
    const ordem = EXTRACTORS.map((e) => e.entity);

    expect(ordem.indexOf('paymentCondition')).toBeLessThan(
      ordem.indexOf('order'),
    );
    expect(ordem.indexOf('paymentCondition')).toBeLessThan(
      ordem.indexOf('quotation'),
    );
  });

  it('preserva o código do legado, que é a identidade real', () => {
    // O legado repete nomes com custos diferentes ("À prazo" com 5,00% e com
    // 3,90%), então o nome não serve como chave.
    const row = PAYMENT_CONDITION_EXTRACTOR.map(legacyRow);

    expect(row.codigoLegado).toBe('3');
    expect(row.nome).toBe('À prazo');
    expect(row.custo).toBe('3.90');
  });

  it('traduz o tipo de custo pelo mapa, não por adivinhação', () => {
    expect(PAYMENT_CONDITION_EXTRACTOR.map(legacyRow).custoTipo).toBe(
      LEGACY_COST_TYPE[2],
    );
    expect(
      PAYMENT_CONDITION_EXTRACTOR.map({ ...legacyRow, custoTipoLegado: 1 })
        .custoTipo,
    ).toBe(LEGACY_COST_TYPE[1]);
  });

  it('leva as faixas de parcelamento', () => {
    const row = PAYMENT_CONDITION_EXTRACTOR.map(legacyRow);

    expect(row.minParcelas).toBe('1');
    expect(row.maxParcelas).toBe('6');
    expect(row.intervaloDias).toBe('28');
    expect(row.ativo).toBe('SIM');
  });
});

describe('referências opcionais nas vendas e no financeiro', () => {
  it('não referencia condição de pagamento inexistente na origem', () => {
    // Venda com condição zerada ou apagada do cadastro: o campo sai vazio e o
    // importador usa a padrão da empresa, em vez de reprovar a venda inteira.
    const sql = ORDER_EXTRACTOR.sql('acn_1');

    expect(sql).toContain('WHERE cp.idcondpag = v.venda_fkidcondpag');
    expect(sql).toContain('CASE WHEN EXISTS');
  });

  it('cai para competência e cadastro quando falta a data de emissão', () => {
    // DataReferencia é obrigatória; parte dos lançamentos traz emissão vazia
    // ou com a sentinela de 1899.
    const semEmissao = {
      DataReferencia: '1899-11-30T03:06:28.000Z',
      dataCompetencia: '2026-08-20T00:00:00.000Z',
      dataCadastro: '2026-08-25T00:00:00.000Z',
    };
    expect(FINANCIAL_EXTRACTOR.map(semEmissao).DataReferencia).toBe(
      '2026-08-20',
    );

    const semEmissaoNemCompetencia = {
      DataReferencia: null,
      dataCompetencia: null,
      dataCadastro: '2026-08-25T00:00:00.000Z',
    };
    expect(
      FINANCIAL_EXTRACTOR.map(semEmissaoNemCompetencia).DataReferencia,
    ).toBe('2026-08-25');
  });

  it('mantém a data de emissão quando ela existe', () => {
    expect(
      FINANCIAL_EXTRACTOR.map({
        DataReferencia: '2026-08-01T00:00:00.000Z',
        dataCompetencia: '2026-08-20T00:00:00.000Z',
      }).DataReferencia,
    ).toBe('2026-08-01');
  });
});

describe('referência da venda', () => {
  it('traz o texto que o usuário reconhece no resumo', () => {
    // No resumo do orçamento, "Referência" é a descrição do documento. Sem
    // este campo ela ficava vazia: o importador usava a observação do item,
    // que quase sempre não existe.
    const row = ORDER_EXTRACTOR.map({
      NumeroVenda: 2154,
      ReferenciaVenda: 'ADESIVOS FACHADA',
      Serie: 'T1',
      statusLegado: 3,
      statusEntrega: 4,
    });

    expect(row.ReferenciaVenda).toBe('ADESIVOS FACHADA');
  });

  it('sai vazia quando a origem não tem referência', () => {
    expect(
      QUOTATION_EXTRACTOR.map({ NumeroVenda: 1, ReferenciaVenda: null })
        .ReferenciaVenda,
    ).toBe('');
  });
});

describe('idempotência das vendas', () => {
  it('leva o identificador da venda no legado', () => {
    // Sem ele a importação de vendas não é repetível: rodar de novo cria
    // documentos duplicados em vez de reconhecer os já migrados.
    const row = ORDER_EXTRACTOR.map({
      VendaCodigoLegado: 4821,
      NumeroVenda: 2154,
      Serie: 'T1',
      statusLegado: 3,
    });

    expect(row.VendaCodigoLegado).toBe('4821');
  });

  it('usa o id da venda, não o número do documento', () => {
    // Número de venda se repete entre séries; o id da tabela não.
    const sql = ORDER_EXTRACTOR.sql('acn_1');
    expect(sql).toContain('v.idsale                    AS VendaCodigoLegado');
  });
});

describe('unidade de medida do produto', () => {
  it('cai para a unidade do item de venda quando o serviço não a informa', () => {
    // No piloto, 73 dos 81 serviços não têm unidade cadastrada; quem a guarda
    // é o item de venda. Sem isso, produto vendido em m² entrava como unidade.
    const sql = PRODUCT_EXTRACTOR.sql('acn_1');

    expect(sql).toContain("NULLIF(sv.ser_un_comercial, '')");
    expect(sql).toContain('i.vendaitem_un_com');
    expect(sql).toContain('ORDER BY COUNT(*) DESC');
  });
});

describe('decimais do legado', () => {
  it('não confunde a casa decimal com separador de milhar', () => {
    // O driver devolve DECIMAL como texto: "3.500" é 3,5 e não 3500. O
    // importador trata ponto seguido de três dígitos como milhar, no formato
    // brasileiro, então 3,5 m viraria 3,5 km.
    expect(decimal('3.500')).toBe('3,500');
    expect(decimal('10.710')).toBe('10,710');
    expect(decimal('0.100')).toBe('0,100');
  });

  it('trata vazio e nulo', () => {
    expect(decimal(null)).toBe('');
    expect(decimal('')).toBe('');
  });

  it('as medidas da linha usam a conversão sem ambiguidade', () => {
    const row = ORDER_EXTRACTOR.map({
      NumeroVenda: 2199,
      ItemLargura: '3.500',
      ItemComprimento: '1.000',
      statusLegado: 3,
    });

    expect(row.ItemLargura).toBe('3,500');
    expect(row.ItemComprimento).toBe('1,000');
  });
});

describe('guarda de sanidade das medidas', () => {
  const campo = (schema: any, nome: string) =>
    schema.fields.find((f: any) => f.name === nome);

  it('avisa quando a medida está fora de escala, sem reprovar a linha', async () => {
    // Medida fora de escala não gera erro em lugar nenhum: entra como número
    // válido e distorce área e preço em silêncio. Foi assim que uma carga
    // inteira gravou 3,5 m como 3,5 km.
    for (const schema of [QUOTATION_IMPORT_SCHEMA, ORDER_IMPORT_SCHEMA]) {
      const largura = campo(schema, 'ItemLargura');

      const fora = await largura.validate('3500');
      expect(fora.severity).toBe('warning');
      expect(fora.error).toMatch(/fora de escala/);

      expect(await largura.validate('3,5')).toBeNull();
      expect(await largura.validate('')).toBeNull();
    }
  });
});

/**
 * Os cadastros de apoio não recusam a linha quando faltam: o produto entraria
 * sem setor e a parcela sem conta bancária. A preparação da etapa é o que
 * preserva esses vínculos, e a simulação precisa enxergar o que ela criaria.
 */
describe('prepareReferences', () => {
  const internals = (over: any = {}) => ({
    findMissingSectors: jest.fn().mockResolvedValue(['Corte']),
    ensureProductSectors: jest.fn().mockResolvedValue(['Corte']),
    findMissingReferences: jest.fn().mockResolvedValue([
      { type: 'bankAccount', name: 'Sicredi CC 47204-3' },
      { type: 'nature', name: 'Vendas' },
    ]),
    ensureFinancialReferences: jest.fn().mockResolvedValue({
      created: [{ type: 'bankAccount', name: 'Sicredi CC 47204-3' }],
      reactivated: [{ type: 'nature', name: 'Vendas' }],
      skipped: [{ type: 'nature', name: 'Operacional' }],
    }),
    findGenericBank: jest.fn().mockResolvedValue({ id: 'bank-000' }),
    ...over,
  });

  const etapa = (entity: string) => ({ entity }) as any;

  it('na simulação, apenas lista os setores que faltam', async () => {
    const service = internals();

    await expect(
      prepareReferences(service, etapa('product'), [], 'company-1', true),
    ).resolves.toEqual(['Corte']);
    expect(service.ensureProductSectors).not.toHaveBeenCalled();
  });

  it('na carga, cria os setores que faltam', async () => {
    const service = internals();

    await expect(
      prepareReferences(service, etapa('product'), [], 'company-1', false),
    ).resolves.toEqual(['Corte']);
    expect(service.findMissingSectors).not.toHaveBeenCalled();
  });

  it('na carga do financeiro, relata criados e reativados', async () => {
    const service = internals();

    await expect(
      prepareReferences(service, etapa('financial'), [], 'company-1', false),
    ).resolves.toEqual(['Sicredi CC 47204-3', 'Vendas']);
  });

  it('na simulação do financeiro, confere o banco genérico', async () => {
    // Sem ele a criação falharia só na carga real, depois de a simulação ter
    // aprovado.
    const service = internals({
      findGenericBank: jest.fn().mockResolvedValue(null),
    });

    await expect(
      prepareReferences(service, etapa('financial'), [], 'company-1', true),
    ).rejects.toThrow(/Banco de código 000 não encontrado/);
  });

  it('etapa sem cadastro de apoio não consulta nada', async () => {
    const service = internals();

    await expect(
      prepareReferences(service, etapa('client'), [], 'company-1', true),
    ).resolves.toEqual([]);
    expect(service.findMissingSectors).not.toHaveBeenCalled();
    expect(service.findMissingReferences).not.toHaveBeenCalled();
  });
});

/**
 * Preparação da etapa numa conta que já estava em uso: é ela que decide o que
 * a carga vai aproveitar, em que série o histórico entra e até onde o
 * financeiro vem — e que permite à simulação dizer isso antes de gravar.
 */
describe('prepareStep', () => {
  const internals = (over: any = {}) => ({
    buildAdoptionIndex: jest.fn().mockResolvedValue(new Map()),
    findProductAdoptions: jest
      .fn()
      .mockResolvedValue({ adopted: [], withoutItem: [] }),
    hasOwnDocuments: jest.fn().mockResolvedValue(false),
    findMissingImportSeries: jest.fn().mockResolvedValue([]),
    firstNonImportedActivity: jest.fn().mockResolvedValue(null),
    findMissingSectors: jest.fn().mockResolvedValue([]),
    ensureProductSectors: jest.fn().mockResolvedValue([]),
    findMissingReferences: jest.fn().mockResolvedValue([]),
    ensureFinancialReferences: jest
      .fn()
      .mockResolvedValue({ created: [], reactivated: [], skipped: [] }),
    findGenericBank: jest.fn().mockResolvedValue({ id: 'bank-000' }),
    ...over,
  });

  const etapa = (entity: string) => ({ entity }) as any;

  it('conta os cadastros que a conta já tem, sem repetir o mesmo destino', async () => {
    // Duas linhas do legado apontando para a mesma ficha contam uma adoção.
    const service = internals({
      buildAdoptionIndex: jest.fn().mockResolvedValue(
        new Map([
          ['11222333000181', 'cliente-1'],
          ['12345678901', 'cliente-1'],
        ]),
      ),
    });
    const linhas = [
      { cnpj: '11.222.333/0001-81' },
      { cpf: '123.456.789-01' },
      { cnpj: '99.888.777/0001-66' },
    ];

    const prep = await prepareStep(
      service,
      etapa('client'),
      linhas,
      'company-1',
      true,
    );

    expect(prep.adopted).toBe(1);
    expect(prep.adoptionIndex).toBeDefined();
  });

  it('avisa do produto adotado que não tem item cadastrado', async () => {
    const service = internals({
      findProductAdoptions: jest
        .fn()
        .mockResolvedValue({ adopted: ['10', '30'], withoutItem: ['30'] }),
    });

    const prep = await prepareStep(
      service,
      etapa('product'),
      [],
      'company-1',
      true,
    );

    expect(prep.adopted).toBe(2);
    expect(prep.notes.join(' ')).toMatch(/não têm item cadastrado.*30/s);
  });

  it('manda o histórico para série separada quando a conta tem documentos', async () => {
    const service = internals({
      hasOwnDocuments: jest.fn().mockResolvedValue(true),
    });

    const prep = await prepareStep(
      service,
      etapa('quotation'),
      [],
      'company-1',
      true,
    );

    expect(prep.historySeries).toBe(true);
    expect(prep.notes.join(' ')).toMatch(/série separada/);
  });

  it('mantém a série do legado na conta que ainda não foi usada', async () => {
    const prep = await prepareStep(
      internals(),
      etapa('order'),
      [],
      'company-1',
      true,
    );

    expect(prep.historySeries).toBe(false);
    expect(prep.notes).toEqual([]);
  });

  it('corta o financeiro na data em que a conta passou a ser usada', async () => {
    const service = internals({
      firstNonImportedActivity: jest
        .fn()
        .mockResolvedValue(new Date('2026-02-01T00:00:00Z')),
    });
    const linhas = [
      { DataReferencia: '2025-12-20' },
      { DataReferencia: '2026-01-31' },
      { DataReferencia: '2026-02-01' },
      { DataReferencia: '2026-03-15' },
    ];

    const prep = await prepareStep(
      service,
      etapa('financial'),
      linhas,
      'company-1',
      true,
    );

    expect(prep.rows).toHaveLength(2);
    expect(prep.notes.join(' ')).toMatch(/2 lançamento\(s\) de 01\/02\/2026/);
  });

  it('conta marcada como não usada ignora o corte por data', async () => {
    // A conta criada só para migrar pode ter um documento de teste, e a data
    // dele barrava justamente o período que o cliente ainda produziu no legado.
    const service = internals({
      firstNonImportedActivity: jest
        .fn()
        .mockResolvedValue(new Date('2026-02-01T00:00:00Z')),
    });
    const linhas = [{ DataReferencia: '2026-03-15' }];

    const prep = await prepareStep(
      service,
      etapa('financial'),
      linhas,
      'company-1',
      true,
      true,
    );

    expect(prep.rows).toHaveLength(1);
    expect(service.firstNonImportedActivity).not.toHaveBeenCalled();
    expect(prep.notes.join(' ')).toMatch(/Corte por data desligado/);
  });

  it('sem uso anterior, traz o financeiro inteiro', async () => {
    const linhas = [{ DataReferencia: '2026-03-15' }];

    const prep = await prepareStep(
      internals(),
      etapa('financial'),
      linhas,
      'company-1',
      true,
    );

    expect(prep.rows).toHaveLength(1);
    expect(prep.notes).toEqual([]);
  });
});
