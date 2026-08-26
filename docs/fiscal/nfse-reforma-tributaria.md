# NFS-e e Reforma Tributária (IBS/CBS) — estado e plano

> **Situação em 19/08/2026.** Este documento existe para que quem retomar o
> assunto — pessoa ou agente — entenda o que foi decidido, com que evidência, e
> o que deliberadamente ficou de fora. Datas e números abaixo têm origem citada;
> confira antes de tratar como verdade atual.

## Por que a implementação parou onde parou

A Reforma Tributária acrescentou à NFS-e um bloco `IBSCBS` com CST e código de
classificação tributária. A implementação foi fatiada em três, e **só a fatia 1
está pronta**. A razão de não seguir para a 2 não é falta de tempo: é que os
clientes desta plataforma **não são obrigados a preencher esses campos em
2026**.

### Perfil da base (levantado em 19/08/2026, produção)

| Métrica | Valor |
|---|---|
| Empresas | 330 |
| Emissores configurados (`invoicy_configs`) | 15 — **todos `emitCrt = 1`** |
| Emissores que já emitiram NFS-e | 5 — **todos Simples Nacional** |
| Serviços (`products.isService = true`) | 52 |
| Produtos | 11.169 |
| Serviços com `codigoServico` | 37 (36 deles em `13.05`) |

Consultas usadas:

```sql
SELECT COALESCE("emitCrt"::text,'(nulo)'), COUNT(*) FROM invoicy_configs GROUP BY 1;

SELECT fd."codigoServico", COUNT(*), MIN(p.name)
FROM product_fiscal_data fd JOIN products p ON p.id = fd."productId"
WHERE fd."codigoServico" <> '' GROUP BY 1 ORDER BY 2 DESC;
```

### Ramo de atividade

CNAEs cadastrados: **3299003** (letras, letreiros e placas — 6 empresas) e
**1813-0/01** (impressão de material publicitário — 4). O catálogo confirma:
adesivos, acrílico com corte laser, letra caixa PVC, banner, lona, painel
ACM/back light/front light, totem, display, DTF, fotolito, cartão de visita.

**É comunicação visual e gráfica.**

### Prazo — a razão de não implementar agora

Optantes do Simples Nacional estão **dispensados de informar CST e cClassTrib
durante todo o exercício de 2026**; a obrigatoriedade começa em **01/01/2027**.
O regime normal passou a ser exigido em **03/08/2026** para NF-e, NFC-e, CT-e e
MDF-e.

Como 100% dos emissores são Simples Nacional, nada aqui é urgente até o último
trimestre de 2026. E a tabela oficial (`RT 2025.002`) **ainda está mudando** —
já vai na versão 1.40, com códigos sendo ativados e desativados. Fixar valores
hoje é fixar uma tabela que vai mudar.

O campo aparecer no emissor nacional em 2026 **não significa** que virou
obrigatório para o Simples.

> Fontes consultadas em 19/08/2026: tecnospeed.com.br/blog/tabela-cclasstrib,
> kontymax.com.br/blog/ibs-cbs-notas-fiscais-2026, blog.spedy.com.br.
> **Reconfirme os prazos antes de agir** — legislação de transição muda.

---

## Fatia 1 — PRONTA (commit `e513011`)

Campos que já eram cadastrados em `ProductFiscalData` e eram descartados na
montagem do payload. Nenhum deles aparecia em `nfse.service.ts` antes.

| Cadastro | InvoiCy |
|---|---|
| `nbs` | `Servico.CodigoNBS` |
| `codTribNacional` | `Servico.codTributNacional` |
| `codTribMunicipio` | `Servico.TributMunicipio` |
| `cnae` | `Servico.Cnae` |
| `codClassificacao` | `Servico.IBSCBS.cClassTrib` |

Implementado em `NfseService.classificacaoFiscalDoServico()`. Cada campo é
**omitido quando não cadastrado**, para não alterar o payload de quem já emite.

**`TributMunicipio` é a exceção e merece cuidado.** Ele carrega historicamente o
código IBGE do município (ex.: 3205002). Pelo layout de referência do InvoiCy
isso parece semanticamente errado — ali o campo é o código de tributação
municipal (o "001" do cadastro). Mas notas vêm sendo **autorizadas** com o IBGE,
então o código municipal só substitui o IBGE **quando cadastrado no serviço**.
Se isso causar recusa, apagar o cadastro reverte sem deploy.

---

## Campos de emissão implementados em 26/08/2026

A pedido dos clientes, os campos de emissão do InvoiCy Web foram trazidos para
as duas telas de NFS-e (via O.S. e avulsa), na seção recolhível "Campos
adicionais". Mapeamento verificado na planilha oficial
`Layout_Recepcao_NFSe_Reforma_Tributaria - versão 4.xlsx` do repositório
`migrate-company/integracao-InvoiCy-BR` — não deduzido:

| Rótulo (InvoiCy Web) | Campo InvoiCy | Valores |
|---|---|---|
| Indicador de Operação | `cIndOp` (RPS) | Anexo VII, 6 dígitos |
| Uso ou Consumo Pessoal | `indFinal` (RPS) | 0=Não, 1=Sim |
| Destinatário dos serviços | `indDest` (RPS) | 0=tomador é o destinatário, 1=diverso |
| Operação c/ Entes Governamentais | `tpEnteGov`+`xTpEnteGov` (RPS) | 1..4, 9=outro |
| Tipo de operação (ente gov) | `tpOper` (RPS) | 1..5 |
| Trib Aprox Fed/Est/Mun | `ValRetFederais/Estaduais/Municipais` | R$ (Modelo Nacional) |
| % INSS | `ValAliqINSS` | **decimal**: 0,05 = 5% (conversão no backend) |
| Valor INSS | `ValINSS` | R$ |

Pegadinha: apesar do prefixo "Ret", `ValRetFederais/Estaduais/Municipais` são
os **valores monetários aproximados dos tributos** por esfera no Modelo
Nacional — a planilha oficial é explícita. Não confundir com retenções.

Todos opcionais e omitidos do payload quando vazios — sem preenchimento a nota
sai exatamente como antes (testes `Reforma` no nfse.service.spec.ts travam os
dois sentidos).

### Lista de Serviços da empresa (26/08/2026)

Espelho da "Lista de Serviços" do InvoiCy Web: modelo `NfseServico`
(company-level, tabela `nfse_servicos`), CRUD em `/fiscal/nfse-servicos`
(controller próprio para não disputar com o `@Get(':id')` do NfseController),
gerenciada em Configurações → Emissores → aba NFS-e → "Gerenciar".

Nas telas de emissão, o seletor "Lista de Serviços" preenche código + alíquota
e envia a classificação (NBS, cód. nacional/municipal, cClassTrib) no payload,
com precedência sobre a classificação do produto (`ProductFiscalData`). É
company-level e não por produto porque a avulsa não tem produto e uma empresa
presta serviços de códigos distintos.

---

## Fatia 2 — PLANEJADA, não implementada

### O que falta enviar

Do exemplo oficial `Layout Integração - Reforma Tributária/Exemplos JSON/NFSe/
Envio_NFSe_CST_011.json` (repositório `migrate-company/integracao-InvoiCy-BR`):

```json
"Servico": {
  "CST": "",
  "IBSCBS": {
    "CSTIBSCBS": "011",
    "cClassTrib": "011003",
    "TribRegular": { "CSTReg": 0, "cClassTribReg": 0 },
    "cLocalidadeIncid": 1,
    "xLocalidadeIncid": "TESTE",
    "cCredPres": 0,
    "PagParceladoAntecipado": "1",
    "NCM": "121",
    "indCompGov": ""
  }
}
```

Também ausentes, do nível do RPS: `cIndOp` (indicador de operação), `indFinal`,
`indDest`, `tpEnteGov`/`xTpEnteGov`, `ListaDedIBSCBS`, e os tributos aproximados
(`ValAproxTrib`, `CargaTribValor/Percentual/Fonte`, `ValAliqINSS`).

### Pré-requisito de schema

`ProductFiscalData` **não tem** campo de CST IBS/CBS. Precisa de migration antes
de qualquer coisa. `codClassificacao` já existe (default `'000001'`).

### Tabela CST-IBS/CBS (RT 2025.002 — confira a versão vigente)

| CST | Descrição |
|---|---|
| 000 | Tributação integral |
| 010 | Alíquotas uniformes — setor financeiro |
| 011 | Tributação com alíquotas uniformes reduzidas (60% ou 30%) |
| 200 | Alíquota zero ou reduzida (30/40/50/60/70/80%) |
| 220 | Alíquota fixa |
| 400 | Isenção |
| 410 | Imunidade e não incidência |
| 510 | Diferimento |
| 550 | Suspensão |
| 620 | Tributação monofásica |
| 800 | Transferência de crédito |
| 830 | Exclusão de base de cálculo |

Regra de coerência: `cClassTrib` começa com o CST. Se `CST = 200`, os válidos
são `200001`, `200002`, ... Isso deve virar validação cruzada no cadastro.

### Agrupamento sugerido do catálogo

O catálogo está quase todo em `13.05` (36 de 37), o que é improvável. Os
serviços se dividem em cinco naturezas fiscais distintas:

| Natureza | Exemplos reais na base | LC 116 provável |
|---|---|---|
| Composição gráfica / impressão | Adesivo Impresso, Banner, Lona, DTF, Fotolito, Cartão de visita | 13.05 |
| Criação / arte | Criação, Criação de Arte | 17.06 ou 23.01 |
| Beneficiamento sob encomenda | Gravação a laser, Corte laser, Pintura de letreiro | 14.05 |
| Instalação / montagem | Instalação de Adesivos, Mão de obra montagem | 14.06, ou 7.02/7.05 |
| Bem produzido para venda | Letra caixa, Painel ACM, Totem, Display, Estrutura metálica | tende a ser **mercadoria (NF-e)** |

> **Esta coluna é leitura do catálogo, não parecer fiscal.** O enquadramento de
> composição gráfica tem disputa antiga entre ISS e ICMS quando o impresso é
> insumo para industrialização. O último grupo é o mais sensível: são itens
> marcados como serviço que na prática costumam ser bem industrializado — muda o
> documento fiscal, não só o código.
>
> **Nada disso deve ser aplicado sem o contador do cliente.**

### Ordem sugerida quando for a hora

1. Confirmar prazo e versão da tabela (ambos podem ter mudado).
2. Migration: campo de CST IBS/CBS em `ProductFiscalData`.
3. Tabela CST × cClassTrib versionada em código, com validação cruzada.
4. Campo no cadastro do serviço + no formulário de emissão.
5. Enviar o bloco `IBSCBS` completo, seguindo o padrão de omissão da fatia 1.
6. Testar em homologação com uma nota de cada natureza antes de produção.

---

## Higiene de cadastro — feito junto com este documento

A base tinha problemas que travam a emissão **hoje**, independentes da Reforma:

- **15 dos 52 serviços sem código LC 116** — incluindo "Adesivo Blackout
  Impresso", item de uma O.S. real emitida.
- **Lixo no campo CNAE**: um registro com `vitoria.uliani@hotmail.com`, outros
  com `13.05`/`130501` (código de serviço, não CNAE). Só 15 das 330 empresas
  têm CNAE preenchido.
- **"Criaçãu"** — erro de digitação virou serviço separado de "Criação".
- Um serviço "Criação" classificado como `07.03`, que é engenharia.

O que foi implementado:

- `validateCnae` e `validateCodigoServico` em `core/fiscal/utils/fiscal-validators.ts`
- Decorators `@IsCnae()` e `@IsCodigoServico()` em `helpers/validators/fiscal-servico.ts`,
  aplicados aos DTOs de `ProductFiscalData`
- `GET /fiscal/product/pendencias-fiscais` — lista serviços com cadastro
  incompleto, separando `bloqueia` (emissão sai errada) de `atencao` (exigido a
  partir de 2027)

A validação é **de forma, não de existência**: não confere se o subitem existe
na LC 116, porque cada município publica a sua com desdobramentos próprios.
Barra os erros que aparecem na prática.

### Conferência antes da emissão — e por que ela não bloqueia

`GET /fiscal/nfse/conferir-emissao?orderIds=` devolve, por serviço, o código
próprio, o código que a nota vai carregar de fato e a origem dele
(`proprio` | `padrao_emissor` | `ausente`).

**O problema que ela resolve não é rejeição — é pior.** Sem código no serviço, a
emissão não falha: a cadeia
`dto.codigoServico || fiscalData.codigoServico || config.codigoServico` cai no
padrão do emissor, a prefeitura **autoriza**, e a nota fica com uma
classificação que pode não ser a do serviço. O erro só aparece numa
fiscalização, quando já não dá para corrigir sem cancelamento. Uma rejeição
seria melhor: falharia na hora.

Dois agravantes na montagem, ainda não corrigidos:

- `emitFromOrder` lê apenas `quotationProduct[0]`, então numa ordem com vários
  serviços o código do primeiro vale para a nota inteira (daí
  `codigosDivergentes` na resposta).
- `emitFromOrders` (consolidada) nem consulta o produto — vai direto ao padrão
  do emissor.

> **DECISÃO (19/08/2026, confirmada pelo dono do produto): confirmação
> explícita, não bloqueio.** A interface exige marcar "confirmo a classificação"
> para liberar o botão de emitir, mas **não impede** a emissão.
>
> Motivo: há clientes emitindo legitimamente apoiados no código padrão do
> emissor — para empresa de serviço único isso está correto. Bloquear de uma vez
> interromperia esse uso sem aviso prévio.
>
> **Não transforme isto em bloqueio duro sem decisão de produto.** Se um dia for
> a hora, o caminho é `handleEmit` em `IssueNfseForm.tsx`: trocar a guarda por um
> `return` incondicional quando `exigeConfirmacao`. O caminho gradual seria
> confirmação agora, bloqueio depois de um prazo para os clientes cadastrarem.

---

## Histórico de rejeições — o que cada erro ensinou

Sequência real de homologação (Plottec, prefeitura da Serra/ES). Cada erro
destravou o seguinte; serve de mapa se aparecer um novo.

| Erro | Causa | Correção |
|---|---|---|
| E0166 | `regApTribSN` nunca chegava na DPS: o campo foi tentado como `RegApuracao` e `RegApuracaoSN`, nomes que o InvoiCy ignora em silêncio | nome correto é **`regApTribSN`** |
| E0160 | `OptSN: 2` gerava `opSimpNac: 1` (não optante) | `OptSN: 1` = optante → `opSimpNac: 3` (ME/EPP) |
| E1235 | `<locPrest>` vazio no XML | `LocalPrestacao` sempre enviado; sem entrega usa o endereço do prestador |
| E0625 | `pAliq` enviado com `opSimpNac=3` e `tpRetISSQN=1` | alíquota omitida para ME/EPP do Simples sem retenção |
| HTTP 500 | `ValISS = 0.00025299999999999997` (ruído de ponto flutuante) | helpers `money()` / `rate()` arredondam na origem |

**`RegEspTrib`:** o comparativo do InvoiCy apontava repetidamente
`autorizado '8', rejeitado '6'`. O valor 8 é **"Tributação Normal (Exclusivo
E&L)"** — a Serra/ES usa o provedor E&L. A lista tem 16 valores, não 6: de 7 a
16 são exclusivos do provedor da prefeitura. Se voltar a implicar com regime
especial, **testar 8**.

## Armadilhas conhecidas do InvoiCy

- **Campos desconhecidos são ignorados em silêncio.** Um nome errado não gera
  erro; o valor simplesmente não aparece na DPS. Confirme no XML retornado
  (`DocXMLBase64`, base64), não no payload enviado.
- **Enumerações não são as do layout nacional.** `OptSN`, `RegEspTrib` e outros
  usam numeração ABRASF/própria, que o InvoiCy converte. Não deduza do XML.
- **A "sugestão de correção" (`#inv0398`) é heurística**, um diff contra a
  última nota autorizada. Aponta campos que mudaram, não a causa da recusa. A
  recusa real vem em `#inv0328`.
- **Não existe consulta com retry seguro na emissão.** `disableRetry=true` está
  ativo na emissão porque o payload não tem chave de idempotência. Para
  reconciliar use `POST /fiscal/nfse/reconcile`.
