# Histórico de Vendas Unificado

## Objetivo
Criar uma API unificada que retorna todo o histórico relacionado a uma venda, incluindo:
- Histórico do orçamento (criação, conclusão, reabertura, rejeição, aprovação)
- Histórico da ordem de serviço (criação, cancelamento)
- Histórico de receitas relacionadas ao orçamento
- Histórico de despesas relacionadas ao orçamento

Tudo em uma única resposta, ordenado por data, com informações de quem executou cada ação.

## Estrutura Implementada

```
src/core/sale/
└── sale-history/
    ├── sale-history.module.ts
    ├── sale-history.service.ts
    ├── sale-history.controller.ts
    └── dto/
        └── sale-history-response.dto.ts
```

## Endpoints

### 1. Buscar histórico por ID do orçamento
```http
GET /sales/history/quotation/:quotationId
```

**Descrição**: Retorna o histórico unificado de todos os eventos relacionados ao orçamento.

**Autenticação**: Requer JWT (JwtAuthGuard)

**Resposta**:
```json
{
  "total": 15,
  "quotationId": "uuid-do-orcamento",
  "orderId": "uuid-da-ordem",
  "history": [
    {
      "id": "uuid",
      "type": "quotation",
      "entityId": "uuid-do-orcamento",
      "action": "CREATED",
      "description": "Orçamento criado",
      "changes": null,
      "metadata": {
        "seriesId": "uuid",
        "companyId": "uuid",
        "quotationNumber": 123
      },
      "createdBy": "user-id",
      "createdByName": "João Silva",
      "createdAt": "2024-01-15T10:00:00.000Z",
      "user": {
        "id": "user-id",
        "name": "João Silva",
        "email": "joao@example.com",
        "avatar": "url"
      }
    },
    {
      "id": "uuid",
      "type": "order",
      "entityId": "uuid-da-ordem",
      "action": "CREATED",
      "description": "Ordem de serviço criada - Orçamento aprovado por Maria Santos",
      "changes": null,
      "metadata": {},
      "createdBy": "user-id",
      "createdByName": "Maria Santos",
      "createdAt": "2024-01-16T14:30:00.000Z",
      "user": {
        "id": "user-id",
        "name": "Maria Santos",
        "email": "maria@example.com",
        "avatar": "url"
      }
    },
    {
      "id": "uuid",
      "type": "receivable",
      "entityId": "uuid-da-receita",
      "action": "CREATE",
      "description": "[Receita] Título criado",
      "changes": null,
      "metadata": {
        "receivableDescription": "Receita da venda #123"
      },
      "createdBy": "user-id",
      "createdByName": "João Silva",
      "createdAt": "2024-01-16T14:35:00.000Z",
      "user": {
        "id": "user-id",
        "name": "João Silva",
        "email": "joao@example.com",
        "avatar": "url"
      }
    },
    {
      "id": "uuid",
      "type": "receivable",
      "entityId": "uuid-da-receita",
      "action": "PAY_INSTALLMENT",
      "description": "[Receita] Parcela 1 paga",
      "changes": null,
      "metadata": {
        "installmentNumber": 1,
        "receivableDescription": "Receita da venda #123"
      },
      "createdBy": "user-id",
      "createdByName": "Carlos Souza",
      "createdAt": "2024-01-20T09:00:00.000Z",
      "user": {
        "id": "user-id",
        "name": "Carlos Souza",
        "email": "carlos@example.com",
        "avatar": "url"
      }
    }
  ]
}
```

### 2. Buscar histórico por ID da ordem de serviço
```http
GET /sales/history/order/:orderId
```

**Descrição**: Retorna o histórico unificado buscando através do ID da ordem de serviço.

**Autenticação**: Requer JWT (JwtAuthGuard)

**Resposta**: Mesma estrutura do endpoint anterior.

## Campos da Resposta

### SaleHistoryResponseDto
- `total` (number): Total de registros de histórico
- `quotationId` (string): ID do orçamento
- `orderId` (string | null): ID da ordem de serviço (null se ainda não foi criada)
- `history` (UnifiedHistoryItemDto[]): Array de registros de histórico ordenados por data (mais recente primeiro)

### UnifiedHistoryItemDto
- `id` (string): ID único do registro de histórico
- `type` (string): Tipo da entidade - `quotation`, `order`, `receivable`, `payable`
- `entityId` (string): ID da entidade (orçamento, ordem, receita ou despesa)
- `action` (string): Ação executada (varia por tipo de entidade)
- `description` (string): Descrição humanizada da ação
  - Receitas e despesas são prefixadas com `[Receita]` e `[Despesa]`
- `changes` (any): Objeto JSON com as mudanças (before/after)
- `metadata` (any): Metadados adicionais da ação
  - Para receitas/despesas, inclui `receivableDescription` / `payableDescription`
- `createdBy` (string): ID do usuário que executou a ação
- `createdByName` (string | null): Nome do usuário (cache para performance)
- `createdAt` (Date): Data/hora da ação
- `user` (UserDto | null): Objeto com dados completos do usuário

### UserDto
- `id` (string): ID do usuário
- `name` (string): Nome do usuário
- `email` (string): Email do usuário
- `avatar` (string | null): URL do avatar do usuário

## Tipos de Ações por Entidade

### Orçamento (quotation)
- `CREATED`: Orçamento criado
- `FINISHED`: Orçamento concluído
- `REOPENED`: Orçamento reaberto
- `REJECTED`: Orçamento rejeitado
- `APPROVED`: Orçamento aprovado (criação da ordem)

### Ordem de Serviço (order)
- `CREATED`: Ordem criada (aprovação do orçamento)
- `CANCELED`: Ordem cancelada

### Receitas (receivable)
- `CREATE`: Título criado
- `UPDATE_TITLE`: Título atualizado
- `UPDATE_INSTALLMENTS`: Parcelas alteradas
- `PAY_INSTALLMENT`: Parcela paga
- `UNDO_PAYMENT`: Pagamento desfeito
- `CANCEL`: Título cancelado
- `UNDO_CANCEL`: Cancelamento desfeito

### Despesas (payable)
Mesmas ações das receitas (CREATE, UPDATE_TITLE, etc.)

## Lógica de Busca

### Por Orçamento (getSaleHistory)
1. Valida se o orçamento existe
2. Busca em paralelo:
   - Histórico do orçamento (`QuotationHistory`)
   - Histórico da ordem relacionada (`OrderHistory`)
   - Histórico de receitas vinculadas (`ReceivableHistory` onde `receivable.quotationId = quotationId`)
   - Histórico de despesas vinculadas (`PayableHistory` onde `payable.quotationId = quotationId`)
3. Unifica todos os históricos em um único array
4. Adiciona prefixos `[Receita]` e `[Despesa]` nas descrições
5. Ordena por data decrescente (mais recente primeiro)
6. Retorna resposta estruturada

### Por Ordem (getSaleHistoryByOrderId)
1. Busca a ordem e obtém o `quotationId`
2. Chama `getSaleHistory(quotationId)`

## Uso no Frontend

Este endpoint pode ser usado tanto na **lista de orçamentos** quanto na **lista de ordens de serviço**, permitindo visualizar o histórico completo da venda de forma unificada.

### Exemplo: Listar histórico na tela de orçamento
```typescript
const response = await fetch(`/sales/history/quotation/${quotationId}`, {
  headers: { Authorization: `Bearer ${token}` }
});
const data = await response.json();

// Renderizar histórico unificado
data.history.forEach(item => {
  console.log(`${item.createdAt} - ${item.description} por ${item.createdByName}`);
});
```

### Exemplo: Listar histórico na tela de ordem de serviço
```typescript
const response = await fetch(`/sales/history/order/${orderId}`, {
  headers: { Authorization: `Bearer ${token}` }
});
const data = await response.json();

// Mesmo formato de resposta
```

## Vantagens da Solução

1. **Visão Completa**: Uma única chamada retorna todo o histórico da venda
2. **Consistência**: Todos os históricos seguem o mesmo formato
3. **Performance**: Busca em paralelo otimiza o tempo de resposta
4. **Ordenação**: Histórico ordenado cronologicamente facilita visualização
5. **Contexto**: Prefixos indicam claramente se a ação é de receita ou despesa
6. **Reutilização**: Mesma API serve para orçamentos e ordens de serviço
7. **Rastreabilidade**: Informações completas do usuário que executou cada ação

## Observações Técnicas

- **Guards**: Rotas protegidas com `JwtAuthGuard`
- **Validação**: Retorna 404 se orçamento ou ordem não existir
- **Includes**: Busca dados do usuário relacionado a cada ação
- **Denormalização**: Campo `createdByName` armazenado para performance (fallback para `user.name` se não existir)
- **Cascade**: Históricos são deletados automaticamente quando entidade pai é removida (onDelete: Cascade)
- **Índices**: Queries otimizadas com índices nas tabelas de histórico

## Próximos Passos (Opcionais)

1. **Filtros**: Adicionar query params para filtrar por tipo (`?type=quotation,order`)
2. **Paginação**: Implementar paginação para vendas com muito histórico
3. **Período**: Adicionar filtro por data (`?startDate=2024-01-01&endDate=2024-12-31`)
4. **Usuário**: Filtrar ações por usuário (`?userId=uuid`)
5. **Export**: Permitir exportação do histórico em PDF ou CSV
6. **Websocket**: Notificações em tempo real de novas ações
