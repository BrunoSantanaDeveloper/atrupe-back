/**
 * Extratores do sistema legado.
 *
 * Cada extrator devolve linhas no MESMO formato que o CSV do importador. Assim
 * a migração reaproveita a validação e a gravação já existentes, em vez de
 * abrir um segundo caminho de escrita que divergiria com o tempo.
 *
 * O legado é um banco MySQL por cliente (`acn_<numero>`), então o nome da base
 * entra como parâmetro em toda consulta.
 */

/**
 * O legado grava data vazia como 1899-11-30 (sentinela do Delphi/Access de
 * origem). Sem tratar, todo registro migraria com essa data.
 */
const EMPTY_DATE_SENTINEL = '1899-11-30';

export function normalizeLegacyDate(value: any): string {
  if (!value) return '';

  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return '';

  const iso = date.toISOString().slice(0, 10);
  if (iso <= EMPTY_DATE_SENTINEL) return '';

  return iso;
}

/** O legado usa 1/0 para status; o CSV do importador espera SIM/NAO. */
export function toSimNao(value: any): string {
  return Number(value) === 1 ? 'SIM' : 'NAO';
}

/** Campo textual vazio no legado vem como '' ou null; normaliza para ''. */
export function text(value: any): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

export interface LegacyExtractor {
  /** Nome da entidade no importador (define qual schema valida a linha). */
  entity: string;
  /** Rótulo exibido no relatório. */
  label: string;
  sql: (base: string) => string;
  /** Converte a linha do MySQL para o formato do CSV. */
  map: (row: any) => Record<string, string>;
  /**
   * Quantos documentos existem na origem, para o relatório acusar quando a
   * extração deixa algo para trás. Sem isso a perda é silenciosa: as vendas
   * que só têm linha sintética, por exemplo, simplesmente não apareceriam.
   */
  expectedSql?: (base: string) => string;
  /** Como contar documentos no resultado, quando uma linha não é um documento. */
  documentKey?: (row: Record<string, string>) => string;
}

export const EMPLOYEE_EXTRACTOR: LegacyExtractor = {
  entity: 'employee',
  label: 'Colaboradores',
  sql: (base) => `
    SELECT
      f.idfuncionario           AS codigoLegado,
      e.nome                    AS nome,
      e.cpf                     AS cpf,
      e.rg                      AS rg,
      s.setor                   AS setor,
      c.cargo                   AS cargo,
      pv.perfil                 AS perfilVendedor,
      f.salario_base            AS salario,
      f.fkidstatus              AS ativo,
      (SELECT cv.descricao
         FROM ${base}.vp_entidade_contato ct
         JOIN ${base}.vp_entidade_contato_valor cv ON cv.fkidcontato = ct.idcontato
        WHERE ct.fkidentidade = e.identidade AND cv.fkidtipo = 2
        LIMIT 1)                AS telefone,
      (SELECT cv.descricao
         FROM ${base}.vp_entidade_contato ct
         JOIN ${base}.vp_entidade_contato_valor cv ON cv.fkidcontato = ct.idcontato
        WHERE ct.fkidentidade = e.identidade AND cv.fkidtipo = 3
        LIMIT 1)                AS celular
    FROM ${base}.rh_funcionario f
    LEFT JOIN ${base}.vp_entidade e  ON e.identidade = f.fkidentidade
    LEFT JOIN ${base}.emp_setor s    ON s.idsetor = f.fkidsetor
    LEFT JOIN ${base}.rh_cargo c     ON c.idcargo = f.fkidcargo
    LEFT JOIN ${base}.sales_perfil_vendedor pv ON pv.idperfilvendedor = f.fkidperfilvendedor
    ORDER BY f.idfuncionario
  `,
  map: (row) => ({
    codigoLegado: text(row.codigoLegado),
    nome: text(row.nome),
    cpf: text(row.cpf),
    rg: text(row.rg),
    telefone: text(row.telefone),
    celular: text(row.celular),
    setor: text(row.setor),
    cargo: text(row.cargo),
    perfilVendedor: text(row.perfilVendedor),
    salario: text(row.salario),
    ativo: toSimNao(row.ativo),
  }),
};

export const CLIENT_EXTRACTOR: LegacyExtractor = {
  entity: 'client',
  label: 'Clientes',
  sql: (base) => `
    SELECT
      c.idcliente               AS codigoLegado,
      e.nome                    AS nome,
      e.razao_social            AS razaoSocial,
      e.cpf                     AS cpf,
      e.cnpj                    AS cnpj,
      e.rg                      AS rg,
      e.fkidtipo                AS tipoLegado,
      e.datanascimento          AS dataNascimento,
      e.is_filial               AS filial,
      e.descricao               AS observacoes,
      en.cep                    AS cep,
      en.rua                    AS rua,
      en.numero                 AS numero,
      en.complemento            AS complemento,
      en.bairro                 AS bairro,
      ci.cidade                 AS cidade,
      uf.sigla                  AS uf,
      (SELECT cv.descricao
         FROM ${base}.vp_entidade_contato ct
         JOIN ${base}.vp_entidade_contato_valor cv ON cv.fkidcontato = ct.idcontato
        WHERE ct.fkidentidade = e.identidade AND cv.fkidtipo = 1
        LIMIT 1)                AS email,
      (SELECT cv.descricao
         FROM ${base}.vp_entidade_contato ct
         JOIN ${base}.vp_entidade_contato_valor cv ON cv.fkidcontato = ct.idcontato
        WHERE ct.fkidentidade = e.identidade AND cv.fkidtipo = 2
        LIMIT 1)                AS telefone,
      (SELECT cv.descricao
         FROM ${base}.vp_entidade_contato ct
         JOIN ${base}.vp_entidade_contato_valor cv ON cv.fkidcontato = ct.idcontato
        WHERE ct.fkidentidade = e.identidade AND cv.fkidtipo = 3
        LIMIT 1)                AS celular
    FROM ${base}.crm_cliente c
    JOIN ${base}.vp_entidade e ON e.identidade = c.fkidentidade
    LEFT JOIN ${base}.vp_endereco en      ON en.idendereco = e.fkidendereco_principal
    LEFT JOIN ${base}.vp_endereco_cidade ci ON ci.idcidade = en.fkidcidade
    LEFT JOIN ${base}.vp_endereco_uf uf   ON uf.iduf = ci.fkiduf
    ORDER BY c.idcliente
  `,
  map: (row) => ({
    codigoLegado: text(row.codigoLegado),
    nome: text(row.nome),
    razaoSocial: text(row.razaoSocial),
    // fkidtipo: 1 = Pessoa Física, 2 = Pessoa Jurídica
    tipo: Number(row.tipoLegado) === 2 ? 'EMPRESA' : 'PESSOA',
    cpf: text(row.cpf),
    cnpj: text(row.cnpj),
    rg: text(row.rg),
    email: text(row.email),
    telefone: text(row.telefone),
    celular: text(row.celular),
    dataNascimento: normalizeLegacyDate(row.dataNascimento),
    filial: toSimNao(row.filial),
    observacoes: text(row.observacoes),
    cep: text(row.cep),
    rua: text(row.rua),
    numero: text(row.numero),
    complemento: text(row.complemento),
    bairro: text(row.bairro),
    cidade: text(row.cidade),
    uf: text(row.uf),
  }),
};

/**
 * Código do produto, garantido único dentro da empresa.
 *
 * No legado o código não é único: na base piloto, 57 produtos usam 46 códigos,
 * e as repetições são produtos genuinamente diferentes — um mesmo "WBRV" cobre
 * quatro tamanhos de Wind Banner. Como o sistema novo tem chave única por
 * código e o importador atualiza o registro existente, importar sem tratar
 * fundiria produtos distintos num só.
 *
 * A expressão preserva o código quando ele já é único e acrescenta o id do
 * legado quando repete. Fica em constante porque o extrator de vendas precisa
 * derivar exatamente o mesmo código para casar o item com o produto.
 */
export const PRODUCT_CODE_SQL = (base: string, alias: string) => `
  CASE WHEN (SELECT COUNT(*) FROM ${base}.est_produto d WHERE d.cod = ${alias}.cod) > 1
       THEN CONCAT(${alias}.cod, '-', ${alias}.idproduto)
       ELSE ${alias}.cod END
`;

export const SUPPLIER_EXTRACTOR: LegacyExtractor = {
  entity: 'supplier',
  label: 'Fornecedores',
  sql: (base) => `
    SELECT
      f.idfornecedor            AS codigoLegado,
      e.nome                    AS nome,
      e.razao_social            AS razaoSocial,
      e.cpf                     AS cpf,
      e.cnpj                    AS cnpj,
      e.rg                      AS rg,
      e.fkidtipo                AS tipoLegado,
      e.is_filial               AS filial,
      e.descricao               AS observacoes,
      cat.categoria             AS categoria,
      en.cep                    AS cep,
      en.rua                    AS rua,
      en.numero                 AS numero,
      en.complemento            AS complemento,
      en.bairro                 AS bairro,
      ci.cidade                 AS cidade,
      uf.sigla                  AS uf,
      (SELECT cv.descricao
         FROM ${base}.vp_entidade_contato ct
         JOIN ${base}.vp_entidade_contato_valor cv ON cv.fkidcontato = ct.idcontato
        WHERE ct.fkidentidade = e.identidade AND cv.fkidtipo = 1
        LIMIT 1)                AS email,
      (SELECT cv.descricao
         FROM ${base}.vp_entidade_contato ct
         JOIN ${base}.vp_entidade_contato_valor cv ON cv.fkidcontato = ct.idcontato
        WHERE ct.fkidentidade = e.identidade AND cv.fkidtipo = 2
        LIMIT 1)                AS telefone,
      (SELECT cv.descricao
         FROM ${base}.vp_entidade_contato ct
         JOIN ${base}.vp_entidade_contato_valor cv ON cv.fkidcontato = ct.idcontato
        WHERE ct.fkidentidade = e.identidade AND cv.fkidtipo = 3
        LIMIT 1)                AS celular
    FROM ${base}.forn_fornecedor f
    JOIN ${base}.vp_entidade e ON e.identidade = f.fkidentidade
    LEFT JOIN ${base}.forn_categoria cat  ON cat.idcategoria = f.fkidcategoria
    LEFT JOIN ${base}.vp_endereco en      ON en.idendereco = e.fkidendereco_principal
    LEFT JOIN ${base}.vp_endereco_cidade ci ON ci.idcidade = en.fkidcidade
    LEFT JOIN ${base}.vp_endereco_uf uf   ON uf.iduf = ci.fkiduf
    ORDER BY f.idfornecedor
  `,
  map: (row) => ({
    codigoLegado: text(row.codigoLegado),
    nome: text(row.nome),
    razaoSocial: text(row.razaoSocial),
    tipo: Number(row.tipoLegado) === 1 ? 'PESSOA' : 'EMPRESA',
    cpf: text(row.cpf),
    cnpj: text(row.cnpj),
    rg: text(row.rg),
    email: text(row.email),
    telefone: text(row.telefone),
    celular: text(row.celular),
    categoria: text(row.categoria),
    filial: toSimNao(row.filial),
    observacoes: text(row.observacoes),
    cep: text(row.cep),
    rua: text(row.rua),
    numero: text(row.numero),
    complemento: text(row.complemento),
    bairro: text(row.bairro),
    cidade: text(row.cidade),
    uf: text(row.uf),
  }),
};

export const PRODUCT_EXTRACTOR: LegacyExtractor = {
  entity: 'product',
  label: 'Produtos',
  sql: (base) => `
    SELECT
      ${PRODUCT_CODE_SQL(base, 'p')} AS codigo,
      p.nome                    AS nome,
      p.descricao               AS descricao,
      s.setor                   AS setor,
      cat.categoria             AS grupo,
      sv.ser_un_comercial       AS unidadeMedida,
      sv.valor                  AS valorUnitario
    FROM ${base}.est_produto p
    LEFT JOIN ${base}.emp_setor s             ON s.idsetor = p.fkidsetor
    LEFT JOIN ${base}.est_produto_categoria cat ON cat.idcategoria = p.fkidcategoria
    LEFT JOIN ${base}.ven_servico sv          ON sv.idservico = p.fkidservico
    ORDER BY p.idproduto
  `,
  map: (row) => ({
    codigo: text(row.codigo),
    nome: text(row.nome),
    descricao: text(row.descricao),
    setor: text(row.setor),
    grupo: text(row.grupo),
    unidadeMedida: text(row.unidadeMedida),
    valorUnitario: text(row.valorUnitario),
  }),
};

/**
 * Itens de venda que são produto de verdade.
 *
 * O legado usa a mesma tabela para linhas sintéticas: na base piloto, dos 9.592
 * itens só os 3.397 do tipo 1 casam com o cadastro de produtos; os tipos 90, 98
 * e 99 são comissão e entrega, com valor zero ou frete. Importar os demais
 * criaria produtos inexistentes e dobraria valores.
 */
const REAL_ITEM_TYPE = 1;

/**
 * Uma linha por item de venda, com os campos da venda repetidos — é assim que o
 * importador espera, agrupando por NumeroVenda e Serie.
 *
 * A entrega vem por subconsulta, não por junção: o legado grava um registro de
 * entrega por item, e juntar multiplicaria as linhas da venda.
 */
const saleSql = (base: string, statusIn: string) => `
  SELECT
    v.venda_numero              AS NumeroVenda,
    v.venda_serie               AS Serie,
    v.venda_fkidstatus          AS statusLegado,
    (SELECT MAX(e2.entrega_fkidstatus) FROM ${base}.sales_entrega e2
      WHERE e2.fkidsale = v.idsale)          AS statusEntrega,
    v.cadastro_dt               AS DataVenda,
    v.venda_data_aprovacao      AS dataAprovacao,
    (SELECT MAX(e2.entrega_prazo) FROM ${base}.sales_entrega e2
      WHERE e2.fkidsale = v.idsale)          AS DataEntrega,
    v.cliente_fkidcliente       AS ClienteCodigoLegado,
    v.cliente_nome              AS ClienteNome,
    v.vendedor_fkidfuncionario  AS VendedorCodigoLegado,
    v.venda_fkidcondpag         AS CondicaoPagamentoCodigoLegado,
    (SELECT MAX(e2.fkidtipoentrega) FROM ${base}.sales_entrega e2
      WHERE e2.fkidsale = v.idsale)          AS tipoEntregaLegado,
    (SELECT SUM(e2.entrega_custo) FROM ${base}.sales_entrega e2
      WHERE e2.fkidsale = v.idsale)          AS FreteCusto,
    (SELECT SUM(e2.entrega_valor) FROM ${base}.sales_entrega e2
      WHERE e2.fkidsale = v.idsale)          AS FreteValor,
    i.idsalevendaitem           AS ItemID,
    ${PRODUCT_CODE_SQL(base, 'p')} AS ProdutoCodigo,
    p.nome                      AS ProdutoNome,
    i.vendaitem_quantidade      AS Quantidade,
    i.vendaitem_valor_unitario  AS ValorUnitario,
    i.vendaitem_valor_total     AS ValorTotal,
    i.vendaitem_valor_desconto  AS Desconto,
    i.vendaitem_observacao      AS ObservacaoItem
  FROM ${base}.sales_venda v
  JOIN ${base}.sales_venda_item i ON i.fkidsalesvenda = v.idsale
                                 AND i.fkidtipovendaitem = ${REAL_ITEM_TYPE}
  JOIN ${base}.est_produto p      ON p.idproduto = i.vendaitem_fkidproduto
  WHERE v.venda_fkidstatus IN (${statusIn})
  ORDER BY v.venda_numero, i.idsalevendaitem
`;

/**
 * Campos comuns às duas formas de venda.
 *
 * As colunas de parcela ficam vazias de propósito: o contas a receber vem do
 * financeiro do legado, que tem as parcelas reais — inclusive as que passam de
 * três, teto do arquivo de ordens.
 */
const mapSale = (row: any) => ({
  NumeroVenda: text(row.NumeroVenda),
  Serie: text(row.Serie),
  DataVenda: normalizeLegacyDate(row.DataVenda),
  DataEntrega: normalizeLegacyDate(row.DataEntrega),
  ClienteCodigoLegado: text(row.ClienteCodigoLegado),
  ClienteNome: text(row.ClienteNome),
  ClienteCpfCnpj: '',
  VendedorCodigoLegado: text(row.VendedorCodigoLegado),
  VendedorEmail: '',
  CondicaoPagamentoCodigoLegado: text(row.CondicaoPagamentoCodigoLegado),
  ItemID: text(row.ItemID),
  ProdutoCodigo: text(row.ProdutoCodigo),
  ProdutoNome: text(row.ProdutoNome),
  Quantidade: text(row.Quantidade),
  ValorUnitario: text(row.ValorUnitario),
  ValorTotal: text(row.ValorTotal),
  Desconto: text(row.Desconto),
  ObservacaoItem: text(row.ObservacaoItem),
  // fkidtipoentrega 2 = transportadora; 1 = retirada
  TipoEntrega: Number(row.tipoEntregaLegado) === 2 ? 'CARRIER' : 'PICKUP',
  FreteCusto: text(row.FreteCusto),
  FreteValor: text(row.FreteValor),
});

const saleCountSql = (base: string, statusIn: string) => `
  SELECT COUNT(*) AS total FROM ${base}.sales_venda
   WHERE venda_fkidstatus IN (${statusIn})
`;

const saleDocumentKey = (row: Record<string, string>) =>
  `${row.NumeroVenda}-${row.Serie}`;

export const ORDER_EXTRACTOR: LegacyExtractor = {
  entity: 'order',
  label: 'Ordens de serviço',
  // status 3 = Ordem de Serviço, 4 = Ordem de Serviço Cancelada
  sql: (base) => saleSql(base, '3, 4'),
  expectedSql: (base) => saleCountSql(base, '3, 4'),
  documentKey: saleDocumentKey,
  map: (row) => ({
    ...mapSale(row),
    // Entrega status 4 = finalizada; 2 = pendente. A ordem cancelada vence
    // qualquer status de entrega.
    StatusOrdem:
      Number(row.statusLegado) === 4
        ? 'CANCELED'
        : Number(row.statusEntrega) === 4
          ? 'FINISHED'
          : 'IN_PRODUCTION',
  }),
};

export const QUOTATION_EXTRACTOR: LegacyExtractor = {
  entity: 'quotation',
  label: 'Orçamentos',
  // status 1 = Orçamento, 2 = Orçamento Cancelado
  sql: (base) => saleSql(base, '1, 2'),
  expectedSql: (base) => saleCountSql(base, '1, 2'),
  documentKey: saleDocumentKey,
  map: (row) => ({
    ...mapSale(row),
    Status: Number(row.statusLegado) === 2 ? 'CANCELADO' : 'OPEN',
  }),
};

/**
 * Uma linha por parcela — é o formato do arquivo financeiro, e por isso ele
 * comporta qualquer quantidade de parcelas, sem o teto de três do arquivo de
 * vendas. Na base piloto há lançamentos com até seis.
 */
export const FINANCIAL_EXTRACTOR: LegacyExtractor = {
  entity: 'financial',
  label: 'Financeiro',
  expectedSql: (base) => `
    SELECT COUNT(*) AS total FROM ${base}.fin_conta WHERE dtcancelamento IS NULL
  `,
  documentKey: (row) => row.Descricao,
  sql: (base) => `
    SELECT
      c.idconta                 AS contaLegado,
      c.conf_arap               AS tipoLegado,
      c.referencia              AS Referencia,
      c.observacao              AS Observacao,
      c.dtemissao               AS DataReferencia,
      c.valor                   AS ValorTotal,
      cl.idcliente              AS ClienteCodigoLegado,
      nat.natureza              AS Natureza,
      cat.categoria             AS SubCategoria,
      cc.nome                   AS ContaBancaria,
      pc.x_parcela              AS Parcela,
      pc.x_total                AS QuantidadeParcelas,
      pc.dtvencimento           AS DataVencimento,
      pc.valor                  AS ValorParcela,
      pc.valor_pago             AS ValorPago,
      pc.dtpagamento            AS DataPagamento,
      pc.fkidformadepagamento   AS CondicaoPagamentoCodigoLegado
    FROM ${base}.fin_conta c
    JOIN ${base}.fin_conta_parcela pc ON pc.fkidconta = c.idconta
    LEFT JOIN ${base}.crm_cliente cl  ON cl.fkidentidade = c.fkidentidade
    LEFT JOIN ${base}.fin_natureza_categoria cat ON cat.idcategoria = c.fkidcategoria
    LEFT JOIN ${base}.fin_natureza nat ON nat.idnatureza = cat.fkidnatureza
    LEFT JOIN ${base}.fin_banco_conta cc ON cc.idcc = pc.fkidcc
    WHERE c.dtcancelamento IS NULL
    ORDER BY c.idconta, pc.x_parcela
  `,
  map: (row) => ({
    // O importador agrupa por Tipo + Descricao + DataReferencia; o id do
    // lançamento entra na descrição para que dois lançamentos do mesmo dia,
    // com o mesmo texto, não sejam fundidos num só.
    Tipo: Number(row.tipoLegado) === 1 ? 'RECEITA' : 'DESPESA',
    Descricao: `${text(row.Referencia)} [${text(row.contaLegado)}]`,
    Referencia: text(row.Referencia),
    DataReferencia: normalizeLegacyDate(row.DataReferencia),
    ValorTotal: text(row.ValorTotal),
    QuantidadeParcelas: text(row.QuantidadeParcelas),
    ClienteCodigoLegado: text(row.ClienteCodigoLegado),
    ClienteCpfCnpj: '',
    Natureza: text(row.Natureza),
    SubCategoria: text(row.SubCategoria),
    ContaBancaria: text(row.ContaBancaria),
    Parcela: text(row.Parcela),
    DataVencimento: normalizeLegacyDate(row.DataVencimento),
    ValorParcela: text(row.ValorParcela),
    ValorPago: text(row.ValorPago),
    DataPagamento: normalizeLegacyDate(row.DataPagamento),
    Status: row.DataPagamento ? 'PAGO' : 'PENDENTE',
    Observacoes: text(row.Observacao),
  }),
};

/**
 * Ordem de carga. Cada etapa depende das anteriores: o importador procura o
 * registro relacionado por nome ou por código do legado.
 */
export const EXTRACTORS: LegacyExtractor[] = [
  EMPLOYEE_EXTRACTOR,
  CLIENT_EXTRACTOR,
  SUPPLIER_EXTRACTOR,
  PRODUCT_EXTRACTOR,
  QUOTATION_EXTRACTOR,
  ORDER_EXTRACTOR,
  FINANCIAL_EXTRACTOR,
];

/** Consulta de conferência: identidade da empresa no legado. */
export const LEGACY_COMPANY_SQL = (base: string) => `
  SELECT e.nome, e.razao_social, e.cnpj, e.cpf
    FROM ${base}.emp_minha_empresa m
    JOIN ${base}.vp_entidade e ON e.identidade = m.fkidentidade
   LIMIT 1
`;
