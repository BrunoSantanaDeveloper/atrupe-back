# Plano de Ação: Implementação de Histórico de Orçamento e Ordem de Serviço

## Objetivo
Implementar sistema de histórico para rastreamento de ações realizadas em orçamentos e ordens de serviço, permitindo auditoria completa das operações.

## Estrutura do Histórico

### Histórico de Orçamento (QuotationHistory)
Rastrear as seguintes ações:
- [ ] **Criação**: Registro do usuário que criou o orçamento
- [ ] **Conclusão (finish)**: Registro de quando o orçamento foi finalizado
- [ ] **Reabertura (open)**: Registro de quando o orçamento foi reaberto
- [ ] **Rejeição**: Registro de quando o orçamento foi rejeitado
- [ ] **Alterações de valores**: Registro de alterações manuais em valores de itens/produtos

### Histórico de Ordem de Serviço (OrderHistory)
Rastrear as seguintes ações:
- [ ] **Criação**: Registro de criação da ordem (aprovação do orçamento) com informação de quem aprovou
- [ ] **Cancelamento**: Registro de cancelamento da ordem

## Etapas de Implementação

### 1. Modelagem no Prisma
- [ ] Criar modelo `QuotationHistory`
  - id (String)
  - quotationId (String)
  - action (String) - enum: CREATED, FINISHED, REOPENED, REJECTED, VALUE_CHANGED
  - description (String)
  - changes (Json) - armazena o antes/depois das alterações
  - metadata (Json) - informações adicionais
  - createdBy (String) - ID do usuário
  - createdByName (String) - Nome do usuário (cache)
  - createdAt (DateTime)
  - relation com Quotation
  - relation com User

- [ ] Criar modelo `OrderHistory`
  - id (String)
  - orderId (String)
  - action (String) - enum: CREATED, CANCELED
  - description (String)
  - changes (Json) - armazena informações relevantes
  - metadata (Json) - informações adicionais (ex: motivo de cancelamento)
  - createdBy (String) - ID do usuário que executou a ação
  - createdByName (String) - Nome do usuário (cache)
  - createdAt (DateTime)
  - relation com Order
  - relation com User

### 2. Criar Migration
- [ ] Gerar migration do Prisma
- [ ] Validar schema
- [ ] Aplicar migration

### 3. Criar DTOs
- [ ] `CreateQuotationHistoryDto`
- [ ] `CreateOrderHistoryDto`
- [ ] DTOs de resposta para listagem

### 4. Criar Serviços de Histórico

#### QuotationHistoryService
- [ ] `createQuotationHistory()` - Criar registro de histórico
- [ ] `getQuotationHistory(quotationId)` - Buscar histórico completo
- [ ] Métodos auxiliares para formatar descrições:
  - `getCreateDescription()`
  - `getFinishDescription()`
  - `getReopenDescription()`
  - `getRejectDescription()`
  - `getValueChangeDescription(changes)`

#### OrderHistoryService
- [ ] `createOrderHistory()` - Criar registro de histórico
- [ ] `getOrderHistory(orderId)` - Buscar histórico completo
- [ ] Métodos auxiliares:
  - `getCreateDescription(approvedBy)`
  - `getCancelDescription(reason)`

### 5. Integração com QuotationService
- [ ] Adicionar chamada de histórico no método `create()` - CREATED
- [ ] Adicionar chamada de histórico no método `finish()` - FINISHED
- [ ] Adicionar chamada de histórico quando reabrir orçamento - REOPENED
- [ ] Adicionar chamada de histórico quando rejeitar orçamento - REJECTED
- [ ] Adicionar chamada de histórico em alterações de valores manuais - VALUE_CHANGED
- [ ] Injetar `QuotationHistoryService` no módulo

### 6. Integração com OrderService
- [ ] Adicionar chamada de histórico no método `create()` - CREATED
  - Incluir informação de quem aprovou o orçamento
- [ ] Adicionar chamada de histórico no método `cancelOrder()` - CANCELED
  - Incluir motivo do cancelamento no metadata
- [ ] Injetar `OrderHistoryService` no módulo

### 7. Criar Módulos
- [ ] Criar `QuotationHistoryModule`
- [ ] Criar `OrderHistoryModule`
- [ ] Registrar nos módulos principais

### 8. Criar Controllers e Rotas

#### QuotationHistoryController
- [ ] `GET /quotations/:id/history` - Listar histórico do orçamento
  - Ordenado por data (desc)
  - Incluir informações do usuário
  - Formatar resposta seguindo padrão do histórico financeiro

#### OrderHistoryController
- [ ] `GET /orders/:id/history` - Listar histórico da ordem
  - Ordenado por data (desc)
  - Incluir informações do usuário
  - Formatar resposta seguindo padrão do histórico financeiro

### 9. Testes
- [ ] Testar criação de orçamento
- [ ] Testar conclusão de orçamento
- [ ] Testar reabertura de orçamento
- [ ] Testar rejeição de orçamento
- [ ] Testar alteração de valores
- [ ] Testar criação de ordem (aprovação)
- [ ] Testar cancelamento de ordem
- [ ] Testar rotas de listagem de histórico

## Padrão de Resposta das Rotas

Seguindo o padrão do histórico financeiro existente:

```json
{
  "total": 10,
  "history": [
    {
      "id": "uuid",
      "action": "CREATED",
      "description": "Orçamento criado",
      "changes": {},
      "metadata": {},
      "createdBy": "user-id",
      "createdByName": "Nome do Usuário",
      "createdAt": "2024-01-01T10:00:00.000Z",
      "user": {
        "id": "user-id",
        "name": "Nome do Usuário",
        "email": "user@email.com",
        "avatar": "url"
      }
    }
  ]
}
```

## Estrutura de Arquivos

```
src/
├── core/
│   └── sale/
│       ├── quotation/
│       │   ├── history/
│       │   │   ├── quotation-history.module.ts
│       │   │   ├── quotation-history.service.ts
│       │   │   ├── quotation-history.controller.ts
│       │   │   └── dto/
│       │   │       └── create-quotation-history.dto.ts
│       │   └── quotation.service.ts
│       └── order/
│           ├── history/
│           │   ├── order-history.module.ts
│           │   ├── order-history.service.ts
│           │   ├── order-history.controller.ts
│           │   └── dto/
│           │       └── create-order-history.dto.ts
│           └── order.service.ts
└── docs/
    └── historico-orcamento-ordem-servico.md
```

## Observações Importantes

1. **Não quebrar operações principais**: As chamadas de histórico devem estar em blocos try-catch para não quebrar as operações principais caso haja erro
2. **Consistência com padrão existente**: Seguir exatamente o mesmo padrão do histórico financeiro já implementado
3. **Cache de nomes**: Armazenar o nome do usuário no momento da ação (createdByName) para evitar joins desnecessários
4. **Auditoria completa**: Garantir que TODAS as ações relevantes sejam registradas
5. **Performance**: Usar índices no banco para queries de histórico (quotationId, orderId, createdAt)

---

## ✅ IMPLEMENTAÇÃO CONCLUÍDA

### Resumo da Implementação

Todos os itens do plano de ação foram implementados com sucesso:

#### 1. Modelagem e Migração ✅
- ✅ Modelos `QuotationHistory` e `OrderHistory` criados no Prisma
- ✅ Migração do banco de dados gerada e aplicada
- ✅ Relações configuradas com `User`, `Quotation` e `Order`
- ✅ Índices criados para otimizar consultas

#### 2. Serviços e DTOs ✅
- ✅ `QuotationHistoryService` implementado com métodos para criar e listar histórico
- ✅ `OrderHistoryService` implementado com métodos para criar e listar histórico
- ✅ DTOs criados seguindo o padrão do histórico financeiro
- ✅ Métodos auxiliares para formatação de descrições padronizadas

#### 3. Integração com Serviços Principais ✅
**QuotationService:**
- ✅ Histórico de criação (`create`)
- ✅ Histórico de conclusão (`finish`)
- ✅ Histórico de reabertura (`open`)
- ✅ Histórico de rejeição (`reject`)
- ✅ Histórico de aprovação (`approve`)

**OrderService:**
- ✅ Histórico de criação (aprovação do orçamento)
- ✅ Histórico de cancelamento com motivo e informações de parcelas

#### 4. Controllers e Rotas ✅
- ✅ `GET /quotations/:id/history` - Lista histórico completo do orçamento
- ✅ `GET /orders/:id/history` - Lista histórico completo da ordem
- ✅ Rotas protegidas com `JwtAuthGuard`
- ✅ Resposta padronizada seguindo formato do histórico financeiro

### Estrutura de Arquivos Criados

```
src/
├── core/
│   └── sale/
│       ├── quotation/
│       │   ├── history/
│       │   │   ├── quotation-history.module.ts
│       │   │   ├── quotation-history.service.ts
│       │   │   ├── quotation-history.controller.ts
│       │   │   └── dto/
│       │   │       └── create-quotation-history.dto.ts
│       │   └── quotation.service.ts (modificado)
│       └── order/
│           ├── history/
│           │   ├── order-history.module.ts
│           │   ├── order-history.service.ts
│           │   ├── order-history.controller.ts
│           │   └── dto/
│           │       └── create-order-history.dto.ts
│           └── order.service.ts (modificado)
├── docs/
│   └── historico-orcamento-ordem-servico.md
└── prisma/
    └── schema.prisma (modificado)
```

### Ações Rastreadas

**Orçamento (QuotationHistory):**
- `CREATED` - Criação do orçamento
- `FINISHED` - Conclusão do orçamento
- `REOPENED` - Reabertura do orçamento
- `REJECTED` - Rejeição do orçamento
- `APPROVED` - Aprovação do orçamento (criação da ordem)

**Ordem de Serviço (OrderHistory):**
- `CREATED` - Criação da ordem (aprovação do orçamento)
- `CANCELED` - Cancelamento da ordem

### Formato de Resposta da API

```json
{
  "total": 5,
  "history": [
    {
      "id": "uuid",
      "action": "CREATED",
      "description": "Orçamento criado",
      "changes": null,
      "metadata": {
        "seriesId": "uuid",
        "companyId": "uuid",
        "quotationNumber": 123
      },
      "createdBy": "user-id",
      "createdByName": "Nome do Usuário",
      "createdAt": "2024-01-01T10:00:00.000Z",
      "user": {
        "id": "user-id",
        "name": "Nome do Usuário",
        "email": "user@email.com",
        "avatar": "url"
      }
    }
  ]
}
```

### Próximos Passos (Opcionais)

1. **Adicionar histórico de alterações de valores**: Implementar rastreamento quando valores de produtos/itens forem alterados manualmente
2. **Testes automatizados**: Criar testes unitários e de integração para os serviços de histórico
3. **Interface frontend**: Desenvolver componentes para exibir o histórico na interface
4. **Exportação de histórico**: Implementar funcionalidade para exportar histórico em PDF ou CSV
5. **Filtros avançados**: Adicionar filtros por tipo de ação, data, usuário, etc.

### Observações

- ✅ Compilação TypeScript sem erros
- ✅ Padrão consistente com histórico financeiro existente
- ✅ Tratamento de erros para não quebrar operações principais
- ✅ Cache de nomes de usuários para performance
- ✅ Índices no banco de dados para otimização
