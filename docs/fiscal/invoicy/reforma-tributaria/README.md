# Reforma Tributária na NF-e / NFC-e — layout do provedor

Exemplos oficiais copiados de
`migrate-company/integracao-InvoiCy-BR`, pasta
`Layout Integração - Reforma Tributária/Exemplos JSON/NFe`.
São a referência de forma do payload usada em
[`ibs-cbs-nfe.util.ts`](../../../../src/core/fiscal/utils/ibs-cbs-nfe.util.ts)
e nos seus testes.

## O grupo não trafega no layout que emitimos

Conferido em 31/08/2026, direto no repositório do provedor:

| Artefato | Ocorrências de IBS/CBS |
| --- | --- |
| `Emissão/Schemas/Invoicy_NFe-NFCe v4.00.xsd` (310.000 bytes) | 0 |
| `Emissão/Layouts/Layout 4.0 NFe_NFCe.xlsx` (2.441 termos) | 0 |
| `…Reforma Tributária/Schemas/…Reforma Tributária.xsd` (377.867 bytes) | grupo completo |
| `…Reforma Tributária/Layout 4.0 NFe_NFCe Reforma Tributária.xlsx` (2.937 termos) | 160 |

A Reforma é um **layout paralelo**, não uma extensão do atual. Enviar o grupo
antes da ativação é campo ignorado em silêncio.

## Ativação

O layout de cadastro de empresa (`Cadastro de empresa/Layouts/LayoutCadastroEmpresa.xlsx`,
aba `Retorno_Consulta_Empresas`) traz `AtivacaoReformaTributaria` como campo de
**retorno apenas** — quem ativa é o provedor, por empresa e por módulo:

```
Parametros (A32)
  ├─ AtivacaoReformaTributaria  (A53)   ← empresa
  ├─ NFe  (A54) → AtivacaoReformaTributaria  (A69)
  ├─ NFCe (A117) → AtivacaoReformaTributaria (A135)
  └─ CTe  (A140) → AtivacaoReformaTributaria (A155)
```

Lê-se pela consulta que já existe: `GET /companies?CNPJ=` em
[`invoicy-http.service.ts`](../../../../src/core/fiscal/invoicy/invoicy-http.service.ts).
No nosso lado o espelho é a coluna `InvoicyConfig.reformaTributariaAtiva`,
desligada por padrão. **Ainda não há sincronização automática**: a coluna é
ajustada à mão quando o provedor ativar.

## Defeitos observados nos exemplos oficiais

Mesma natureza dos já catalogados no [README do layout vigente](../README.md).

1. **`vNFIBScbsIS` divergente entre os exemplos.** Para item idêntico
   (R$ 10,00, IBS 0,01, CBS 0,09) a NF-e envia `10.1` e a NFC-e envia `10`.
   Adotamos a NF-e: o campo existe para carregar o total *com* os novos
   tributos, já que a regra nacional proíbe somá-los em `vProd`/`vNF` durante
   2025 e 2026.
2. **Ocorrência do XSD não bate com os exemplos.** O schema declara `gIBSCBS`,
   `gCredPresOper`, `gIBSCBSMono`, `gTransfCred`, `gAjusteCompet` e
   `gEstornoCred` todos como `1-1`. Os exemplos enviam só o que a operação
   exige, e o CST 410 omite `gIBSCBS` por completo. Os exemplos são a
   referência; o XSD, não.
3. **`Envio_NFCe_CST_410.json` é JSON inválido** — vírgula sobrando antes do
   fecha-chaves na linha 37.
4. **`ICMSTot` vs `ICMStot`.** O exemplo CST 000 usa `ICMSTot`; o CST 410 usa
   `ICMStot`. Emitimos `ICMStot`, que é o que funciona em produção hoje.

## Regra de preenchimento

O que decide se a nota leva valores é o indicador **`ind_gIBSCBS`** da tabela
nacional de CST (LC 214/2025, Informe Técnico 2025.002) — não é dedutível do
código, é tabelado. A tabela está em
[`ibs-cbs-cst.util.ts`](../../../../src/core/fiscal/utils/ibs-cbs-cst.util.ts),
com `verificado: true` apenas nos dois CSTs conferidos contra estes exemplos
(000 e 410). Os demais precisam de conferência do contador antes de a Reforma
ser ativada.

Outra regra do layout que vale registrar, extraída da composição de `vItem`:

> Em 2025 e 2026 não somar vIBS, vCBS, vIS, vTotIBSMonoItem, vTotCBSMonoItem.
