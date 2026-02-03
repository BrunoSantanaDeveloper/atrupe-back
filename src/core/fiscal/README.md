# Módulo Fiscal

Este módulo gerencia a emissão e gestão de documentos fiscais eletrônicos: NF-e, NFS-e e NFC-e.

## Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│                      Controllers                            │
│   NfeController | NfseController | NfceController           │
└──────────┬──────────────┬────────────────┬──────────────────┘
           │              │                │
┌──────────▼──────┐ ┌─────▼────────┐ ┌─────▼────────────────┐
│   NfeService    │ │ NfseService  │ │    NfceService       │
│  (orquestrador) │ │(orquestrador)│ │   (orquestrador)     │
└───┬────┬────┬───┘ └───┬────┬─────┘ └───┬──────────────────┘
    │    │    │         │    │           │
┌───▼┐ ┌─▼─┐ ┌▼───┐ ┌───▼┐ ┌─▼───┐ ┌─────▼───────────────────┐
│Bldr│ │Dft│ │Evt │ │Bldr│ │Evt  │ │NfceContingencySyncService│
└────┘ └───┘ └────┘ └────┘ └─────┘ └─────────────────────────┘

All services → InvoicyApiService → InvoicyHttpService → Invoicy API
```

## Services

### Orquestradores

- `NfeService` - Orquestra emissão, cancelamento e consultas de NF-e
- `NfseService` - Orquestra emissão e cancelamento de NFS-e
- `NfceService` - Orquestra emissão de NFC-e (cupom fiscal)

### Especializados

- `NfeBuilderService` - Construção de payloads NF-e para Invoicy
- `NfeEventsService` - Eventos pós-emissão (cancelamento, CC-e)
- `NfeDraftService` - Gestão de rascunhos NF-e
- `NfseBuilderService` - Construção de payloads NFS-e
- `NfseEventsService` - Eventos pós-emissão NFS-e
- `NfseDraftService` - Gestão de rascunhos NFS-e
- `NfceContingencySyncService` - Sincronização automática de NFC-e em contingência

### Infraestrutura

- `InvoicyApiService` - Operações de API fiscal (emissão, cancelamento)
- `InvoicyHttpService` - Transporte HTTP com retry e circuit breaker
- `InvoicyService` - CRUD de configurações de emissores

## Validadores

O arquivo `utils/fiscal-validators.ts` contém validações para:

| Função                 | Descrição                                |
| ---------------------- | ---------------------------------------- |
| `validateNcm()`        | Valida NCM (8 dígitos)                   |
| `validateCfop()`       | Valida CFOP (4 dígitos)                  |
| `getCfopByUf()`        | Ajusta CFOP baseado em UF origem/destino |
| `validateCstIcms()`    | Valida CST de ICMS                       |
| `validateCsosn()`      | Valida CSOSN (Simples Nacional)          |
| `validateUf()`         | Valida UF brasileira                     |
| `validateFiscalItem()` | Validação completa de item fiscal        |

## Fluxos Principais

### Emissão de NF-e

1. `prepareFromOrder()` - Prepara dados da ordem para emissão
2. `createOrGetDraft()` - Cria rascunho para edição
3. `updateDraft()` - Atualiza dados do rascunho
4. `emitFromOrder()` - Emite a NF-e final

### Contingência NFC-e

1. NFC-e é salva com status `CONTINGENCY`
2. `NfceContingencySyncService` roda a cada 5 minutos
3. Verifica disponibilidade da SEFAZ
4. Transmite notas pendentes automaticamente

## Configuração

Cada empresa pode ter múltiplos emissores configurados via `InvoicyConfig`:

```typescript
{
  name: string; // Nome do emissor
  isDefault: boolean; // Emissor padrão
  ambiente: string; // PRODUCAO | HOMOLOGACAO
  serieNfe: number; // Série da NF-e
  serieNfse: string; // Série da NFS-e
  serieNfce: number; // Série da NFC-e
  proximoNumeroNfe: number;
  proximoNumeroNfce: number;
  proximoRpsNfse: number;
}
```

## Testes

### Unitários

```bash
cd back && npm test -- src/core/fiscal
```

### E2E

```bash
cd web && npx playwright test tests/e2e/fiscal
```

## Status Codes

| Status        | Descrição                |
| ------------- | ------------------------ |
| `DRAFT`       | Rascunho em digitação    |
| `PENDING`     | Aguardando processamento |
| `PROCESSING`  | Processando na SEFAZ     |
| `AUTHORIZED`  | Autorizada               |
| `REJECTED`    | Rejeitada pela SEFAZ     |
| `CANCELLED`   | Cancelada                |
| `CONTINGENCY` | Emitida em contingência  |
