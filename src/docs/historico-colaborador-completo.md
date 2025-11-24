# Histórico Completo de Colaborador

## Objetivo
Fornecer uma visão completa de todas as atividades realizadas por um colaborador (usuário), incluindo:
- Histórico do próprio colaborador (criação, atualizações, ativação/desativação)
- Histórico de orçamentos criados pelo usuário
- Histórico de ordens de serviço criadas pelo usuário
- Histórico de receitas criadas/gerenciadas pelo usuário
- Histórico de despesas criadas/gerenciadas pelo usuário
- Histórico de acessos ao sistema (sessões)

## Endpoint Existente

```http
GET /employees/:employeeId/history
```

**Autenticação**: Requer JWT

## Estrutura da Resposta

```json
{
  "total": 150,
  "history": [
    {
      "id": "uuid",
      "type": "EMPLOYEE | QUOTATION | ORDER | RECEIVABLE | PAYABLE | ACCESS",
      "action": "string",
      "description": "string",
      "changes": {...},
      "metadata": {...},
      "createdBy": "user-id",
      "createdByName": "Nome do Usuário",
      "createdAt": "2024-01-15T10:00:00.000Z",
      "user": {
        "id": "user-id",
        "name": "Nome",
        "email": "email@example.com",
        "avatar": "url"
      }
    }
  ]
}
```

## Tipos de Histórico

### 1. EMPLOYEE (Histórico do Colaborador)
Ações sobre o próprio cadastro do colaborador:
- `CREATE`: Colaborador criado
- `UPDATE`: Campos do colaborador atualizados
- `DEACTIVATE`: Colaborador desativado
- `REACTIVATE`: Colaborador reativado
- `CREATE_USER`: Usuário criado para o colaborador
- `UPDATE_USER`: Dados do usuário atualizados

**Exemplo de metadata:**
```json
{
  "changedFields": ["name", "email", "phone"]
}
```

---

### 2. QUOTATION (Histórico de Orçamentos)
Todas as ações que o usuário executou em orçamentos:
- `CREATED`: Orçamento criado
- `FINISHED`: Orçamento concluído
- `REOPENED`: Orçamento reaberto
- `REJECTED`: Orçamento rejeitado
- `APPROVED`: Orçamento aprovado (criação da ordem)

**Exemplo de metadata:**
```json
{
  "quotationId": "uuid",
  "quotationNumber": 123,
  "quotationDescription": "Descrição do orçamento",
  "clientName": "Nome do Cliente"
}
```

---

### 3. ORDER (Histórico de Ordens de Serviço)
Todas as ações que o usuário executou em ordens:
- `CREATED`: Ordem criada (aprovação de orçamento)
- `CANCELED`: Ordem cancelada

**Exemplo de metadata:**
```json
{
  "orderId": "uuid",
  "quotationId": "uuid",
  "quotationNumber": 123,
  "quotationDescription": "Descrição do orçamento",
  "clientName": "Nome do Cliente"
}
```

---

### 4. RECEIVABLE (Histórico de Receitas)
Todas as ações que o usuário executou em receitas:
- `CREATE`: Receita criada
- `UPDATE_TITLE`: Título da receita atualizado
- `UPDATE_INSTALLMENTS`: Parcelas alteradas
- `PAY_INSTALLMENT`: Parcela paga
- `UNDO_PAYMENT`: Pagamento desfeito
- `CANCEL`: Receita cancelada
- `UNDO_CANCEL`: Cancelamento desfeito

**Description prefixada com:** `[Receita]`

**Exemplo de metadata:**
```json
{
  "receivableId": "uuid",
  "receivableDescription": "Descrição da receita",
  "totalValue": 1500.00,
  "quotationId": "uuid",
  "quotationNumber": 123,
  "clientName": "Nome do Cliente",
  "installmentNumber": 1
}
```

---

### 5. PAYABLE (Histórico de Despesas)
Todas as ações que o usuário executou em despesas:
- `CREATE`: Despesa criada
- `UPDATE_TITLE`: Título da despesa atualizado
- `UPDATE_INSTALLMENTS`: Parcelas alteradas
- `PAY_INSTALLMENT`: Parcela paga
- `UNDO_PAYMENT`: Pagamento desfeito
- `CANCEL`: Despesa cancelada
- `UNDO_CANCEL`: Cancelamento desfeito

**Description prefixada com:** `[Despesa]`

**Exemplo de metadata:**
```json
{
  "payableId": "uuid",
  "payableDescription": "Descrição da despesa",
  "totalAmount": 500.00,
  "quotationId": "uuid",
  "quotationNumber": 123,
  "clientName": "Nome do Cliente",
  "installmentNumber": 1
}
```

---

### 6. ACCESS (Histórico de Acessos)
Sessões de acesso do usuário ao sistema:
- `SESSION_ACTIVE`: Sessão ativa
- `LOGOUT`: Logout realizado
- `SESSION_EXPIRED`: Sessão expirou por inatividade

**Exemplo de descrição:**
- "Acesso ao sistema (ativo agora)"
- "Acesso ao sistema (última atividade há 15m)"
- "Sessão encerrada (duração: 2h 30m)"
- "Sessão expirou após 1h 15m de inatividade"

**Exemplo de metadata:**
```json
{
  "sessionId": "uuid",
  "ipAddress": "192.168.1.100",
  "userAgent": "Mozilla/5.0...",
  "endpoint": "/api/quotations",
  "method": "GET",
  "lastActive": "2024-01-15T12:30:00.000Z",
  "logoutAt": "2024-01-15T14:00:00.000Z",
  "isActive": false,
  "durationText": "2h 30m",
  "durationMinutes": 150
}
```

---

## Lógica de Busca

O método `getEmployeeHistory(employeeId)` executa as seguintes etapas:

1. **Busca o colaborador** e seu `userId` associado
2. **Busca histórico do colaborador** (EmployeeHistory)
3. Se houver `userId` associado, busca em paralelo:
   - Histórico de orçamentos onde `createdBy = userId`
   - Histórico de ordens onde `createdBy = userId`
   - **Histórico de receitas onde `createdBy = userId`** ✅
   - **Histórico de despesas onde `createdBy = userId`** ✅
   - Atividades/sessões do usuário (UserActivity)
4. **Mapeia e enriquece** cada tipo de histórico com informações contextuais
5. **Unifica todos em um único array**
6. **Ordena por data** (mais recente primeiro)
7. Retorna resposta estruturada

## Informações Contextuais Incluídas

### Para Orçamentos e Ordens
- ID e número do orçamento
- Descrição do orçamento
- Nome do cliente

### Para Receitas e Despesas
- ID e descrição da receita/despesa
- Valor total
- Orçamento relacionado (se houver)
- Número do orçamento
- Nome do cliente

### Para Acessos
- Duração da sessão
- IP e User Agent
- Status da sessão (ativo, logout, expirado)
- Última atividade

## Uso no Frontend

### Exemplo: Histórico completo de um colaborador
```typescript
const response = await fetch(`/employees/${employeeId}/history`, {
  headers: { Authorization: `Bearer ${token}` }
});
const data = await response.json();

console.log(`Total de atividades: ${data.total}`);

// Agrupar por tipo
const porTipo = {
  orcamentos: data.history.filter(h => h.type === 'QUOTATION').length,
  ordens: data.history.filter(h => h.type === 'ORDER').length,
  receitas: data.history.filter(h => h.type === 'RECEIVABLE').length,
  despesas: data.history.filter(h => h.type === 'PAYABLE').length,
  acessos: data.history.filter(h => h.type === 'ACCESS').length,
  colaborador: data.history.filter(h => h.type === 'EMPLOYEE').length,
};
```

### Exemplo: Timeline de atividades
```typescript
data.history.forEach(item => {
  const date = new Date(item.createdAt).toLocaleString('pt-BR');
  console.log(`${date} - [${item.type}] ${item.description}`);
});

// Saída:
// 15/01/2024 14:30 - [QUOTATION] Orçamento criado
// 15/01/2024 14:25 - [RECEIVABLE] [Receita] Título criado
// 15/01/2024 14:00 - [ACCESS] Acesso ao sistema (ativo agora)
// 15/01/2024 10:15 - [ORDER] Ordem de serviço criada - Orçamento aprovado
// 14/01/2024 16:45 - [PAYABLE] [Despesa] Parcela 1 paga
```

## Vantagens da Implementação

1. **Visão 360°**: Todo o histórico do colaborador em uma única chamada
2. **Performance**: Todas as buscas em paralelo
3. **Contexto Rico**: Informações relevantes de orçamentos, clientes, valores
4. **Identificação Clara**: Prefixos `[Receita]` e `[Despesa]` facilitam visualização
5. **Ordenação Cronológica**: Fácil visualizar linha do tempo
6. **Tipos Explícitos**: Campo `type` permite filtragens e agrupamentos
7. **Auditoria Completa**: Rastreamento de todas as ações do usuário

## Diferença entre Históricos

### Histórico de Vendas (SaleHistory)
**Endpoint**: `/sales/history/quotation/:quotationId`

**Objetivo**: Ver tudo que aconteceu com **uma venda específica**

**Retorna**: Histórico de orçamento + ordem + receitas + despesas **daquela venda**

**Uso**: Tela de detalhes do orçamento/ordem

---

### Histórico de Colaborador (EmployeeHistory)
**Endpoint**: `/employees/:employeeId/history`

**Objetivo**: Ver tudo que **um colaborador fez** no sistema

**Retorna**: Histórico de **todas** as vendas, receitas, despesas que o colaborador criou/gerenciou + acessos + mudanças no próprio cadastro

**Uso**: Tela de perfil do colaborador, relatórios de produtividade

---

## Relação entre os Históricos

```
┌─────────────────────────────────────────────────────────┐
│                   COLABORADOR (João)                    │
│                                                         │
│  Histórico do Colaborador                              │
│  ├─ Criação, atualizações, ativação                   │
│  └─ Acessos ao sistema                                │
│                                                         │
│  Vendas Criadas:                                       │
│  ├─ Orçamento #123 ────────────────────┐              │
│  │   ├─ Criado                         │              │
│  │   ├─ Aprovado                       │              │
│  │   └─ Ordem #45 criada               │              │
│  │       └─ Receita #78 criada         │              │
│  │                                      │              │
│  ├─ Orçamento #124 ────────────────────┤              │
│  │   ├─ Criado                         │              │
│  │   └─ Despesa #79 criada             │              │
│  │                                      │              │
│  └─ [Outros orçamentos...]             │              │
│                                         │              │
│  Todas essas ações aparecem no         │              │
│  histórico do colaborador              │              │
└─────────────────────────────────────────┴──────────────┘
                                          │
                                          ▼
                          ┌───────────────────────────────┐
                          │  HISTÓRICO DE VENDA           │
                          │  (Orçamento #123)             │
                          │                               │
                          │  - Criado por João            │
                          │  - Aprovado por João          │
                          │  - Ordem #45 criada           │
                          │  - Receita #78 criada         │
                          │  - Receita #78 parcela paga   │
                          └───────────────────────────────┘
```

## Resumo

✅ **Implementação Completa**

O `EmployeeHistoryService` agora retorna:
- ✅ Histórico do colaborador
- ✅ Histórico de orçamentos criados
- ✅ Histórico de ordens criadas
- ✅ **Histórico de receitas criadas/gerenciadas** (NOVO)
- ✅ **Histórico de despesas criadas/gerenciadas** (NOVO)
- ✅ Histórico de acessos ao sistema

**Endpoint único**: `GET /employees/:employeeId/history`

**Resultado**: Timeline completa de todas as atividades do colaborador no sistema, ordenada cronologicamente.
