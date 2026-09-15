# Contrato do Invoicy — Eventos e Inutilização

Cópia versionada do contrato publicado pelo provedor em
<https://github.com/migrate-company/integracao-InvoiCy-BR> (pastas
`Eventos/Exemplos JSON/NFe` e `Eventos/Schemas`).

Este repositório já era citado em `invoicy-api.service.ts` e `invoicy.types.ts`,
mas nunca tinha sido aberto. Em 05/08/2026 ele resolveu um incidente que estava
aberto desde sempre: **nenhum evento fiscal (carta de correção, cancelamento,
inutilização) jamais funcionou neste sistema**, porque o payload que montávamos
não corresponde ao contrato.

## O que o provedor responde quando o payload não bate

```json
[{ "Codigo": 606,
   "Descricao": "Não foi possível processar a operação, verifique os dados enviados e tente novamente." }]
```

`606` é **erro genérico de validação de payload**. Não é "empresa não
habilitada" — isso era um rótulo que inventamos e que apontava o usuário para
reativar o emissor, um passo que não tem relação nenhuma com o fluxo de evento.
Medido em produção: no mesmo ambiente e com a mesma credencial, a empresa
autentica, emite e consulta o documento normalmente.

## Os três defeitos do payload antigo

Comparando `evento-carta-correcao.exemplo.json` e `Envio_NFe-NFCe_4.0.xsd` com o
que enviávamos:

1. **O wrapper `Documento` não existe no evento.** A raiz do XSD é
   `EnvioEvento = { ModeloDocumento, Versao, ChaveParceiro?, ChaveAcesso?, Evento }`.
   Enviávamos `{ Documento: { ModeloDocumento, Versao, Evento: {...} } }`.

   O wrapper `Documento` **é** correto na emissão — é isso que explica o padrão
   "emite mas não eventa".

2. **O documento não é endereçado pela chave de acesso.** Os obrigatórios são
   `NtfCnpjEmissor` (ou `NtfCpfEmissor`), `NtfNumero`, `NtfSerie` e `tpAmb`.
   `ChaAcesso` existe, mas é `minOccurs="0"`. Não enviávamos nenhum dos quatro.

3. **Os nomes eram todos inventados.** `ChaveNFe`, `TipoEvento`, `nSeqEvento`,
   `Correcao` e `Justificativa` não existem no dicionário do provedor. Os
   corretos são `ChaAcesso`, `EveTp`, `EvenSeq`, `EveCorrecao` e `EvexJust`, e os
   três últimos ficam aninhados em `EveInf.Evedet`.

## Inutilização

`inutilizacao.exemplo.json` mostra que a inutilização também é **plana**, sem
wrapper `Documento`, e usa `CnpjEmissor` (grafia diferente da do evento, que é
`NtfCnpjEmissor`). Enviávamos `{ Documento: { Inutilizacao: {...} } }` — o mesmo
defeito estrutural.

## Ao mexer nestes fluxos

Confira contra o XSD e os exemplos **antes** de tentar contra o provedor: cada
tentativa é uma chamada externa real e o `606` não diz qual campo falhou.

O lado da resposta (`Codigo`, `Descricao`, `Documentos[].Situacao`,
`DocProtocolo`, `DocXMLBase64`) foi escrito com a documentação em mãos e está
correto — ver `Retorno_evento.xsd`.

## NF-e referenciada — `NFRef`, não `NFref` (11/09/2026)

Toda NF-e de devolução era rejeitada com a **321** ("NF-e de devolução de
mercadoria não possui documento fiscal referenciado"), mesmo com a chave
preenchida na tela. O payload enviava `ide.NFref` — a grafia da tag no XML da
SEFAZ —, mas o contrato do provedor usa **`NFRef`**, com R maiúsculo. O
provedor casa chaves respeitando a caixa, ignorava a desconhecida sem erro e o
XML saía sem o grupo.

A forma certa é `ide.NFRef: [{ refNFe: "<44 dígitos>" }]`. O XSD declara um
nível `NFRefItem`, mas no JSON ele fica implícito no array — é assim com
`det`/`detItem`, `dup`/`dupItem`, `pag`/`pagItem` e `vol`/`volItem`, todos já
funcionando em produção. O exemplo oficial `NF-e Devolução.json` mostra
`"NFRef": [ "NFRefItem": {...} ]`, que não é JSON válido: não copiar.

`Envio_NFe-NFCe_4.0.xsd` desta pasta **não cobre o corpo da NF-e** (não tem
`NFRef`, nem `prod`). O schema completo do provedor está em
`Envio_NFe-NFCe_4.0.oficial-completo.xsd` (Emissão/Schemas, 6.709 linhas) — é
contra ele que se confere a emissão.
