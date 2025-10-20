# Histórico de Alterações em Movimentações Financeiras

## 📋 Objetivo

Implementar um sistema completo de rastreamento de alterações em contas a receber e contas a pagar, permitindo auditoria e visualização de todas as modificações realizadas nos títulos financeiros.

---

## 🎯 Requisitos Funcionais

### RF01 - Rastreamento Automático
- [x] Todas as alterações em receivables devem ser registradas automaticamente
- [x] Todas as alterações em payables devem ser registradas automaticamente
- [x] Registrar usuário responsável pela alteração
- [x] Registrar data/hora da alteração
- [x] Registrar tipo de ação realizada

### RF02 - Informações Rastreadas
- [x] Criação de título
- [x] Atualização de dados do título (descrição, valor, datas, etc.)
- [x] Atualização de parcelas (valores, datas de vencimento)
- [x] Pagamento de parcelas
- [x] Desfazer pagamento de parcelas
- [x] Cancelamento de título
- [x] Desfazer cancelamento de título
- [x] Alterações em campos específicos (before/after)

### RF03 - Consulta de Histórico
- [x] Endpoint para listar histórico de um receivable
- [x] Endpoint para listar histórico de um payable
- [x] Ordenação cronológica (mais recente primeiro)
- [x] Incluir informações do usuário que fez a alteração

---

## 🗄️ Estrutura de Dados

### Modelo Atual (Schema)
```prisma
model ReceivableHistory {
  id           String     @id @default(uuid())
  receivableId String
  action       String
  description  String
  createdBy    String
  createdAt    DateTime   @default(now())
  receivable   Receivable @relation(fields: [receivableId], references: [id])
}

model PayableHistory {
  id        String   @id @default(uuid())
  payableId String
  action    String
  description String
  createdBy String
  createdAt DateTime @default(now())
  payable   Payable  @relation(fields: [payableId], references: [id])
}
```

### Modelo Melhorado (Proposto)
```prisma
model ReceivableHistory {
  id             String     @id @default(uuid())
  receivableId   String
  action         String     // CREATE, UPDATE_TITLE, UPDATE_INSTALLMENTS, PAY, UNDO_PAYMENT, CANCEL, UNDO_CANCEL
  description    String     // Descrição legível da ação
  changes        Json?      // { before: {...}, after: {...} }
  metadata       Json?      // Dados adicionais (installmentNumber, bankAccount, etc.)
  createdBy      String     // ID do usuário
  createdByName  String?    // Nome do usuário (desnormalizado)
  createdAt      DateTime   @default(now())
  receivable     Receivable @relation(fields: [receivableId], references: [id], onDelete: Cascade)

  @@index([receivableId])
  @@index([createdAt])
  @@map("receivable_history")
}

model PayableHistory {
  id            String   @id @default(uuid())
  payableId     String
  action        String
  description   String
  changes       Json?
  metadata      Json?
  createdBy     String
  createdByName String?
  createdAt     DateTime @default(now())
  payable       Payable  @relation(fields: [payableId], references: [id], onDelete: Cascade)

  @@index([payableId])
  @@index([createdAt])
  @@map("payable_history")
}
```

---

## 🏗️ Arquitetura da Solução

### 1. Database Layer
- [x] Atualizar schema.prisma com novos campos
- [x] Criar migration para alterar tabelas existentes
- [x] Adicionar índices para performance

### 2. Service Layer
- [x] Criar `FinancialHistoryService` centralizado
  - [x] Método: `createReceivableHistory()`
  - [x] Método: `createPayableHistory()`
  - [x] Método: `getReceivableHistory()`
  - [x] Método: `getPayableHistory()`
  - [x] Método auxiliar: `extractUserInfo()` (do contexto da requisição)

### 3. Integration Layer
- [x] Integrar em `ReceivableService`:
  - [x] `create()` - registrar criação
  - [x] `updateTitle()` - registrar alteração de título
  - [x] `updateInstallments()` - registrar alteração de parcelas
  - [x] `payInstallment()` - registrar pagamento
  - [x] `undoPaymentInstallment()` - registrar desfazer pagamento
  - [x] `cancel()` - registrar cancelamento
  - [x] `undoCancel()` - registrar desfazer cancelamento

- [x] Integrar em `PayableService`:
  - [x] `create()` - registrar criação
  - [x] `updateTitle()` - registrar alteração de título
  - [x] `updateInstallments()` - registrar alteração de parcelas
  - [x] `payInstallment()` - registrar pagamento
  - [x] `undoPaymentInstallment()` - registrar desfazer pagamento
  - [x] `cancel()` - registrar cancelamento
  - [x] `undoCancel()` - registrar desfazer cancelamento

### 4. API Layer
- [x] Criar endpoints em `ReceivableController`:
  - [x] `GET /receivables/:id/history` - listar histórico

- [x] Criar endpoints em `PayableController`:
  - [x] `GET /payables/:id/history` - listar histórico

### 5. Authentication Context
- [x] Extrair informações do usuário logado em cada requisição
- [x] Passar userId e userName para os métodos de histórico

---

## 📝 Tipos de Ações (Action Types)

### Receivables & Payables
| Action | Descrição | Quando Ocorre |
|--------|-----------|---------------|
| `CREATE` | Título criado | Ao criar novo receivable/payable |
| `UPDATE_TITLE` | Dados do título alterados | Ao alterar descrição, valores, datas do título principal |
| `UPDATE_INSTALLMENTS` | Parcelas alteradas | Ao modificar, adicionar ou remover parcelas |
| `PAY_INSTALLMENT` | Parcela paga | Ao realizar pagamento de uma parcela |
| `UNDO_PAYMENT` | Pagamento desfeito | Ao desfazer um pagamento |
| `CANCEL` | Título cancelado | Ao cancelar o título |
| `UNDO_CANCEL` | Cancelamento desfeito | Ao desfazer o cancelamento |
| `STATUS_CHANGE` | Status alterado | Quando o status muda automaticamente |

---

## 🔄 Fluxo de Implementação

### Fase 1: Preparação do Banco de Dados
- [x] **Etapa 1.1**: Atualizar `schema.prisma` com novos campos
  - [x] Adicionar `changes: Json?`
  - [x] Adicionar `metadata: Json?`
  - [x] Adicionar `createdByName: String?`
  - [x] Adicionar índices para performance
  - [x] Adicionar `onDelete: Cascade`

- [x] **Etapa 1.2**: Criar migration
  ```bash
  npx prisma migrate dev --name add_history_fields
  ```

- [x] **Etapa 1.3**: Aplicar migration
  ```bash
  npx prisma migrate deploy
  ```

### Fase 2: Criação do Service de Histórico
- [x] **Etapa 2.1**: Criar arquivo `src/core/financial/history/history.service.ts`

- [x] **Etapa 2.2**: Implementar métodos principais:
  ```typescript
  - createReceivableHistory()
  - createPayableHistory()
  - getReceivableHistory()
  - getPayableHistory()
  ```

- [x] **Etapa 2.3**: Criar DTOs:
  - [x] `CreateHistoryDto`
  - [x] `HistoryResponseDto`

- [x] **Etapa 2.4**: Criar arquivo `src/core/financial/history/history.module.ts`

- [x] **Etapa 2.5**: Registrar no `FinancialModule`

### Fase 3: Integração com ReceivableService
- [x] **Etapa 3.1**: Injetar `FinancialHistoryService` no construtor

- [x] **Etapa 3.2**: Adicionar histórico em `create()`:
  ```typescript
  await this.historyService.createReceivableHistory({
    receivableId: receivable.id,
    action: 'CREATE',
    description: 'Conta a receber criada',
    createdBy: userId,
    createdByName: userName,
  });
  ```

- [x] **Etapa 3.3**: Adicionar histórico em `updateTitle()`:
  - [x] Capturar estado anterior
  - [x] Registrar alterações com before/after

- [x] **Etapa 3.4**: Adicionar histórico em `updateInstallments()`:
  - [x] Capturar parcelas antes
  - [x] Registrar diferenças

- [x] **Etapa 3.5**: Adicionar histórico em `payInstallment()`:
  - [x] Registrar pagamento com metadata

- [x] **Etapa 3.6**: Adicionar histórico em `undoPaymentInstallment()`:
  - [x] Registrar desfazer pagamento

- [x] **Etapa 3.7**: Adicionar histórico em `cancel()`:
  - [x] Registrar cancelamento com motivo

- [x] **Etapa 3.8**: Adicionar histórico em `undoCancel()`:
  - [x] Registrar reativação

### Fase 4: Integração com PayableService
- [x] **Etapa 4.1**: Injetar `FinancialHistoryService` no construtor

- [x] **Etapa 4.2**: Replicar todas as integrações da Fase 3 para payables:
  - [x] `create()`
  - [x] `updateTitle()`
  - [x] `updateInstallments()`
  - [x] `payInstallment()`
  - [x] `undoPaymentInstallment()`
  - [x] `cancel()`
  - [x] `undoCancel()`

### Fase 5: Criação dos Endpoints
- [x] **Etapa 5.1**: Adicionar método no `ReceivableService`:
  ```typescript
  async getHistory(id: string) {
    return this.historyService.getReceivableHistory(id);
  }
  ```

- [x] **Etapa 5.2**: Adicionar rota no `ReceivableController`:
  ```typescript
  @Get(':id/history')
  async getHistory(@Param('id') id: string) {
    return this.receivableService.getHistory(id);
  }
  ```

- [x] **Etapa 5.3**: Replicar para `PayableService` e `PayableController`

### Fase 6: Extração de Contexto de Usuário
- [x] **Etapa 6.1**: Criar decorator `@CurrentUser()` (se não existir)

- [x] **Etapa 6.2**: Atualizar assinaturas dos métodos para receber userId e userName:
  ```typescript
  async updateTitle(id: string, dto: UpdateReceivableDto, userId: string, userName: string)
  ```

- [x] **Etapa 6.3**: Atualizar controllers para passar informações do usuário:
  ```typescript
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateReceivableDto,
    @CurrentUser() user: any
  ) {
    return this.receivableService.updateTitle(id, dto, user.id, user.name);
  }
  ```

### Fase 7: Testes
- [ ] **Etapa 7.1**: Testar criação de receivable
  - [x] Verificar registro no histórico
  - [x] Validar campos salvos

- [ ] **Etapa 7.2**: Testar atualização de título
  - [x] Verificar before/after
  - [x] Validar descrição

- [ ] **Etapa 7.3**: Testar pagamento de parcela
  - [x] Verificar registro de pagamento
  - [x] Validar metadata

- [ ] **Etapa 7.4**: Testar cancelamento e reativação
  - [x] Verificar histórico de ambas ações

- [ ] **Etapa 7.5**: Testar endpoints de consulta
  - [x] GET /receivables/:id/history
  - [x] GET /payables/:id/history

- [ ] **Etapa 7.6**: Testar performance com grandes volumes
  - [x] Verificar índices funcionando
  - [x] Testar paginação (se implementada)

### Fase 8: Documentação e Melhorias
- [x] **Etapa 8.1**: Documentar endpoints no Swagger/OpenAPI

- [ ] **Etapa 8.2**: Adicionar exemplos de uso

- [ ] **Etapa 8.3**: Criar guia de consulta de histórico para frontend

- [ ] **Etapa 8.4**: (Opcional) Implementar paginação nos endpoints de histórico

---

## 🎨 Formato de Resposta da API

### GET /receivables/:id/history
```json
{
  "total": 5,
  "history": [
    {
      "id": "uuid",
      "action": "PAY_INSTALLMENT",
      "description": "Parcela 1/3 paga",
      "changes": null,
      "metadata": {
        "installmentNumber": 1,
        "amount": 500.00,
        "paidAmount": 500.00,
        "bankAccountId": "uuid",
        "bankAccountName": "Banco do Brasil"
      },
      "createdBy": "user-uuid",
      "createdByName": "João Silva",
      "createdAt": "2025-10-20T14:30:00.000Z"
    },
    {
      "id": "uuid",
      "action": "UPDATE_INSTALLMENTS",
      "description": "Parcelas alteradas: 2 parcelas modificadas",
      "changes": {
        "before": [
          { "installmentNumber": 1, "amount": 600, "dueDate": "2025-11-01" },
          { "installmentNumber": 2, "amount": 600, "dueDate": "2025-12-01" }
        ],
        "after": [
          { "installmentNumber": 1, "amount": 500, "dueDate": "2025-11-01" },
          { "installmentNumber": 2, "amount": 500, "dueDate": "2025-12-01" },
          { "installmentNumber": 3, "amount": 500, "dueDate": "2026-01-01" }
        ]
      },
      "metadata": null,
      "createdBy": "user-uuid",
      "createdByName": "Maria Santos",
      "createdAt": "2025-10-19T09:15:00.000Z"
    },
    {
      "id": "uuid",
      "action": "CREATE",
      "description": "Conta a receber criada",
      "changes": null,
      "metadata": {
        "totalAmount": 1500.00,
        "installmentQty": 2,
        "clientName": "Cliente XYZ"
      },
      "createdBy": "user-uuid",
      "createdByName": "Carlos Oliveira",
      "createdAt": "2025-10-18T16:45:00.000Z"
    }
  ]
}
```

---

## 🎨 Formato Visual para Frontend (Sugestão)

### Timeline de Alterações
```
┌────────────────────────────────────────────────────────────┐
│  📅 20/10/2025 às 14:30                                    │
│  👤 João Silva                                             │
│                                                            │
│  💰 Parcela 1/3 paga                                       │
│  • Valor pago: R$ 500,00                                   │
│  • Conta: Banco do Brasil                                  │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│  📅 19/10/2025 às 09:15                                    │
│  👤 Maria Santos                                           │
│                                                            │
│  🔄 Parcelas renegociadas                                  │
│  • Quantidade: 2 → 3 parcelas                              │
│  • Valor parcela 1: R$ 600,00 → R$ 500,00                 │
│  • Valor parcela 2: R$ 600,00 → R$ 500,00                 │
│  • Nova parcela 3: R$ 500,00                               │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│  📅 18/10/2025 às 16:45                                    │
│  👤 Carlos Oliveira                                        │
│                                                            │
│  ✨ Conta a receber criada                                 │
│  • Valor total: R$ 1.500,00                                │
│  • Parcelas: 2x                                            │
│  • Cliente: Cliente XYZ                                    │
└────────────────────────────────────────────────────────────┘
```

---

## 🔒 Segurança e Considerações

### Permissões
- [x] Apenas usuários autenticados podem gerar histórico
- [x] Histórico é read-only (não pode ser editado ou deletado)
- [ ] Considerar permissão específica para visualizar histórico

### Performance
- [x] Índices em `receivableId` e `payableId`
- [x] Índice em `createdAt` para ordenação rápida
- [ ] Considerar paginação para títulos com muito histórico
- [x] Usar `onDelete: Cascade` para limpeza automática

### Auditoria
- [x] Registrar sempre o usuário responsável
- [x] Timestamp automático
- [x] Imutabilidade dos registros

---

## 📊 Métricas de Sucesso

- [x] 100% das operações gerando histórico
- [ ] Resposta do histórico em < 200ms
- [ ] Zero perda de dados de auditoria
- [ ] Consultas eficientes mesmo com grandes volumes

---

## 🚀 Melhorias Futuras (Backlog)

- [ ] Filtros avançados no histórico (por tipo de ação, por usuário, por período)
- [ ] Exportação de histórico (PDF, Excel)
- [ ] Notificações de alterações importantes
- [ ] Comparação visual de alterações (diff)
- [ ] Reversão de alterações (rollback)
- [ ] Histórico de alterações em massa
- [ ] Dashboard de auditoria
- [ ] Paginação nos endpoints de histórico

---

## 📚 Referências

- [Prisma Schema](../../../prisma/schema.prisma)
- [ReceivableService](../receivable/receivable.service.ts)
- [PayableService](../payable/payable.service.ts)
- [ReceivableController](../receivable/receivable.controller.ts)
- [PayableController](../payable/payable.controller.ts)

---

**Documento criado em:** 20/10/2025
**Última atualização:** 20/10/2025
**Status:** ✅ Em Implementação
