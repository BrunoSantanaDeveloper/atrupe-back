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
 * Ordem de carga. Cada etapa depende das anteriores: o importador procura o
 * registro relacionado por nome ou por código do legado.
 */
export const EXTRACTORS: LegacyExtractor[] = [
  EMPLOYEE_EXTRACTOR,
  CLIENT_EXTRACTOR,
  SUPPLIER_EXTRACTOR,
  PRODUCT_EXTRACTOR,
];

/** Consulta de conferência: identidade da empresa no legado. */
export const LEGACY_COMPANY_SQL = (base: string) => `
  SELECT e.nome, e.razao_social, e.cnpj, e.cpf
    FROM ${base}.emp_minha_empresa m
    JOIN ${base}.vp_entidade e ON e.identidade = m.fkidentidade
   LIMIT 1
`;
