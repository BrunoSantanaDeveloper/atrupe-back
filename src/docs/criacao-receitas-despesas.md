# Análise da Criação de Receitas e Despesas

**Sistema:** Atrupe API
**Data:** 2025-10-13
**Módulo:** Financial (src/core/financial)

---

## 📋 Índice

1. [Visão Geral](#visão-geral)
2. [Receitas (Receivables)](#receitas-receivables)
3. [Despesas (Payables)](#despesas-payables)
4. [Criação via Orçamentos/Vendas](#criação-via-orçamentosvendas)
5. [Criação via Folha de Pagamento](#criação-via-folha-de-pagamento)
6. [Despesas Programadas](#despesas-programadas)
7. [Diferenças em Pagamentos](#diferenças-em-pagamentos)
8. [Fluxo de Dados](#fluxo-de-dados)
9. [Considerações Importantes](#considerações-importantes)

---

## 🎯 Visão Geral

O sistema possui múltiplos pontos de criação de receitas (receivables) e despesas (payables), cada um com suas regras e características específicas. Este documento mapeia todos os locais e processos envolvidos.

### Estrutura do Módulo Financeiro

```
financial.module.ts
├── ReceivableModule (Contas a Receber)
├── PayableModule (Contas a Pagar)
├── FlowModule (Fluxo Financeiro)
├── CashControlModule (Controle de Caixa)
├── ScheduledExpenseModule (Despesas Programadas)
├── InvoiceModule (Notas Fiscais)
├── SalarySheetsModule (Folhas de Pagamento)
├── NatureModule (Naturezas Financeiras)
├── CreditLimitModule (Limite de Crédito)
└── SalariesModule (Configuração de Salários)
```

---

## 💰 Receitas (Receivables)

### 1. Criação Direta

**Arquivo:** `src/core/financial/receivable/receivable.service.ts`
**Método:** `create(dto: CreateReceivableDto)`
**Linha:** 43-84

#### Processo:
1. Valida que há pelo menos uma parcela
2. Calcula o valor total somando parcelas e taxas adicionais
3. Cria o título (receivable) em transação
4. Cria múltiplas parcelas (receivableInstallment) vinculadas ao título
5. Todas as parcelas iniciam com status 'PENDING'

#### Campos Principais:
```typescript
{
  referenceDate: Date,        // Data de competência
  description: string,         // Descrição da receita
  totalAmount: number,         // Valor total calculado
  installmentQty: number,      // Quantidade de parcelas
  companyId: string,
  clientId?: string,
  natureId?: string,           // Categoria da receita
  subCategoryId?: string,
  quotationId?: string,        // Se vinculada a uma venda
  financialType?: string,      // MAIN, DOWN_PAYMENT, etc.
}
```

### 2. Criação via Diferença de Pagamento

**Arquivo:** `src/core/financial/receivable/receivable.service.ts`
**Método:** `payInstallment()`
**Linha:** 648-729

#### Quando ocorre:
Quando o valor pago em uma conta a receber é **maior** que o esperado (diferença positiva), o sistema cria automaticamente uma **nova receita** para registrar o valor excedente.

#### Processo:
1. Detecta diferença positiva no pagamento
2. Valida natureza e categoria da diferença
3. Cria novo receivable com descrição: `"Diferença no pagamento da parcela X - [descrição original]"`
4. Herda clientId, supplierId e referenceDate da transação original
5. Cria parcela única já paga (status PAID ou PROVISIONED)
6. Impacta o caixa se não for provisionamento

### 3. Criação via Vendas/Orçamentos

**Arquivo:** `src/core/sale/quotation/payment/payment.service.ts`
**Método:** `updatePayment()`
**Linha:** 59-219

#### Quando ocorre:
Durante a configuração do pagamento de uma venda, o sistema pode criar:
- **Receita Principal:** Valor da venda parcelado
- **Receita de Entrada:** Se houver entrada (downPayment)

#### Características:
- Vinculada à quotation via `quotationId`
- Pode ter `financialType`: 'MAIN' ou 'DOWN_PAYMENT'
- As parcelas seguem a condição de pagamento escolhida
- Taxas adicionais aplicadas conforme configuração

### 4. Reativação de Receitas

**Arquivo:** `src/core/financial/receivable/receivable.service.ts`
**Método:** `undoCancel()`
**Linha:** 361-407

#### Processo:
1. Verifica se a receita está cancelada
2. Atualiza todas as parcelas CANCELED para PENDING
3. Reativa receitas relacionadas se for venda (MAIN)
4. Limpa campos de cancelamento

---

## 💸 Despesas (Payables)

### 1. Criação Direta

**Arquivo:** `src/core/financial/payable/payable.service.ts`
**Método:** `create(dto: CreatePayableDto)`
**Linha:** 43-92

#### Processo:
1. Valida que há pelo menos uma parcela
2. Calcula o valor total somando parcelas e taxas adicionais
3. Sanitiza campos vazios (supplierId, employeeId)
4. Cria o título (payable) em transação
5. Cria múltiplas parcelas (payableInstallment) vinculadas ao título
6. Todas as parcelas iniciam com status 'PENDING'

#### Campos Principais:
```typescript
{
  referenceDate: Date,        // Data de competência
  description: string,         // Descrição da despesa
  totalAmount: number,         // Valor total calculado
  installmentQty: number,      // Quantidade de parcelas
  companyId: string,
  supplierId?: string,         // Fornecedor
  employeeId?: string,         // Colaborador
  natureId?: string,           // Categoria da despesa
  subCategoryId?: string,
  expenseSource?: string,      // EMPLOYEE, SUPPLIER, etc.
  financialType?: string,      // MAIN, DELIVERY, ADVANCE
  quotationId?: string,        // Se vinculada a uma venda
  scheduledExpenseId?: string, // Se vinculada a despesa programada
}
```

### 2. Criação via Diferença de Pagamento

**Arquivo:** `src/core/financial/payable/payable.service.ts`
**Método:** `payInstallment()`
**Linha:** 583-662

#### Quando ocorre:
Quando o valor pago em uma conta a pagar é **maior** que o esperado (diferença positiva), o sistema cria automaticamente uma **nova despesa** para registrar o valor excedente.

#### Processo:
1. Detecta diferença positiva no pagamento
2. Valida natureza e categoria da diferença
3. Cria novo payable com descrição: `"Diferença no pagamento da parcela X - [descrição original]"`
4. Herda clientId, supplierId e referenceDate da transação original
5. Cria parcela única já paga (status PAID ou PROVISIONED)
6. Impacta o caixa se não for provisionamento

### 3. Criação via Folha de Pagamento

**Arquivo:** `src/core/financial/salary-sheets/salary-sheets.service.ts`

#### 3.1. Despesa de Salário Principal

**Método:** `createSalaryExpense()`
**Linha:** 821-883

##### Quando ocorre:
- Na geração inicial da folha de pagamento
- Quando há alterações em itens da folha (acréscimos/descontos)

##### Processo:
1. Calcula salário líquido: `Acréscimos - Descontos - Adiantamentos`
2. Se valor negativo, **não cria** a despesa
3. Cria payable com:
   - `description`: `"Folha MM/YYYY - Salário"`
   - `referenceDate`: Primeiro dia do mês da folha
   - `dueDate`: Dia 5 do mês da folha
   - `expenseSource`: 'EMPLOYEE'
   - `financialType`: 'MAIN' (implícito)
   - Busca natureza "Colaboradores / RH" e subcategoria "Salários"
4. Cria parcela única com vencimento no dia 5

##### Atualização Automática:
**Método:** `updateSalaryExpense()`
**Linha:** 1004-1119

- Atualiza o valor da despesa quando há mudanças na folha
- Remove a despesa se o valor ficar negativo
- Cria nova despesa se não existir e o valor for positivo

#### 3.2. Despesa de Adiantamento

**Método:** `createAdvanceExpense()`
**Linha:** 885-944

##### Quando ocorre:
Ao adicionar um item do tipo 'ADVANCE' à folha de pagamento.

##### Processo:
1. Cria payable com:
   - `description`: `"Folha MM/YYYY - [descrição do adiantamento]"`
   - `referenceDate`: Primeiro dia do mês da folha
   - `dueDate`: Data atual (vencimento imediato)
   - `expenseSource`: 'EMPLOYEE'
   - `financialType`: 'ADVANCE'
   - Mesma natureza e subcategoria do salário
2. Cria parcela única com vencimento imediato
3. Atualiza a despesa de salário principal (reduz o valor)

##### Atualização de Adiantamento:
**Método:** `updateAdvanceExpense()`
**Linha:** 1121-1180

- Atualiza valor da despesa quando o item ADVANCE é modificado
- Sempre atualiza também a despesa principal

### 4. Criação via Comissões (Vendas)

**Arquivo:** `src/core/sale/quotation/payment/payment.service.ts`
**Método:** `updateCommission()`
**Linha:** 221-288

#### Quando ocorre:
Quando uma venda possui comissão configurada para um fornecedor (representante).

#### Processo:
1. Busca ou cria registro de comissão
2. Vincula ao fornecedor (representante)
3. Define tipo, método de transferência e valor
4. A despesa real é criada quando o título principal da venda é processado

### 5. Criação via Despesas Programadas

**Arquivo:** `src/core/financial/scheduled-expense/scheduled-expense.service.ts`
**Método:** `launchScheduledExpenses()`
**Linha:** 657-736

#### Quando ocorre:
Através do lançamento manual de despesas programadas (recorrentes).

#### Processo:
1. Itera sobre as despesas programadas selecionadas
2. Para cada uma, cria payable com:
   - `referenceDate`: Data de competência fornecida
   - `description`: Da despesa programada ou "Despesa agendada - [fornecedor]"
   - `dueDate`: Data de vencimento fornecida
   - `scheduledExpenseId`: Vincula à despesa programada
   - Herda fornecedor, natureza e subcategoria
3. Cria parcela única com status PENDING
4. Retorna resumo de sucessos e erros

#### Características das Despesas Programadas:
```typescript
{
  amount: number,              // Valor base
  description: string,
  dueDay: number,              // Dia do vencimento (1-31)
  recurringType: string,       // MONTHLY, ANNUAL, etc.
  supplierId: string,
  categoryId: string,          // natureId
  subCategoryId: string,
  isActive: boolean,
  companyId: string,
}
```

### 6. Criação via Entregas (Vendas)

**Arquivo:** `src/core/sale/quotation/delivery/delivery.service.ts`

#### Quando ocorre:
Durante a configuração da entrega de uma venda, se o tipo for 'CARRIER' (transportadora).

#### Processo:
1. Vincula fornecedor (transportadora) à informação de entrega
2. O sistema cria despesa vinculada à venda com `financialType`: 'DELIVERY'
3. A despesa é gerenciada junto com o ciclo da venda

### 7. Reativação de Despesas

**Arquivo:** `src/core/financial/payable/payable.service.ts`
**Método:** `undoCancel()`
**Linha:** 385-424

#### Processo:
1. Verifica se a despesa está cancelada
2. Atualiza todas as parcelas CANCELED para PENDING
3. Reativa despesas relacionadas se for venda (MAIN)
4. Limpa campos de cancelamento

---

## 📊 Criação via Orçamentos/Vendas

### Fluxo Completo de uma Venda

#### 1. Configuração do Pagamento
**Arquivo:** `src/core/sale/quotation/payment/payment.service.ts`

```
VENDA
├── Pagamento Principal
│   ├── receivable (financialType: MAIN)
│   └── installments (parcelas)
│
├── Entrada (se configurada)
│   ├── receivable (financialType: DOWN_PAYMENT)
│   └── 1 installment
│
├── Comissão (se configurada)
│   └── payable (criado indiretamente)
│
└── Entrega (se tipo CARRIER)
    └── payable (financialType: DELIVERY)
```

#### 2. Relacionamentos com Vendas

##### Receitas vinculadas:
- **Título Principal:** `financialType = 'MAIN'`
- **Entrada:** `financialType = 'DOWN_PAYMENT'`

##### Despesas vinculadas:
- **Comissão:** Via relacionamento `Commission -> Payable`
- **Entrega:** `financialType = 'DELIVERY'`

#### 3. Cancelamento em Cascata

**Arquivo:** `src/core/financial/receivable/receivable.service.ts`
**Método:** `cancelRelatedFinancials()`
**Linha:** 1171-1249

Quando o título principal (MAIN) de uma venda é cancelado:
1. Cancela todas as comissões relacionadas
2. Cancela todas as entradas (DOWN_PAYMENT)
3. Cancela todas as entregas (DELIVERY)

#### 4. Reativação em Cascata

**Método:** `reactivateRelatedFinancials()`
**Linha:** 1251-1334

Quando o título principal (MAIN) é reativado:
1. Reativa comissões canceladas automaticamente
2. Reativa entradas canceladas automaticamente
3. Reativa entregas canceladas automaticamente

---

## 💼 Criação via Folha de Pagamento

### Visão Geral

A folha de pagamento gera automaticamente despesas no financeiro, mantendo sincronização constante.

### 1. Estrutura da Folha

```
PAYROLL (Folha de Pagamento)
├── employee (Colaborador)
├── month, year (Competência)
├── status (OPEN, CLOSED)
└── items (Itens da folha)
    ├── INCREASE (Acréscimos)
    │   └── Ex: Salário base, horas extras, bonificações
    ├── DISCOUNT (Descontos)
    │   └── Ex: INSS, vale transporte, faltas
    └── ADVANCE (Adiantamentos)
        └── Ex: Vale, adiantamento salarial
```

### 2. Cálculo do Salário Líquido

```
Salário Líquido = Σ INCREASE - Σ DISCOUNT - Σ ADVANCE
```

### 3. Geração Automática de Despesas

#### 3.1. Geração da Folha

**Método:** `generateSalarySheetForEmployees()`
**Linha:** 23-191

```
QUANDO: Ao gerar folha para o mês
↓
CALCULA: Salário líquido
↓
SE valor >= 0:
  ├── CRIA: Despesa de Salário Principal
  │   ├── Competência: Primeiro dia do mês
  │   ├── Vencimento: Dia 5 do mês
  │   └── Valor: Salário líquido calculado
  └── Status: PENDING
SENÃO:
  └── NÃO CRIA despesa (salário negativo)
```

#### 3.2. Adição de Itens

**Método:** `addSalaryItem()`
**Linha:** 577-660

```
AO ADICIONAR ITEM:
│
├── SE tipo = INCREASE ou DISCOUNT:
│   └── ATUALIZA: Despesa de Salário Principal
│       └── Recalcula valor líquido
│
└── SE tipo = ADVANCE:
    ├── CRIA: Nova despesa de Adiantamento
    │   ├── Vencimento: Imediato
    │   └── financialType: ADVANCE
    └── ATUALIZA: Despesa de Salário Principal
        └── Reduz o valor líquido a pagar
```

#### 3.3. Atualização de Itens

**Método:** `updateSalaryItem()`
**Linha:** 662-747

```
AO ATUALIZAR ITEM:
│
├── SE era ou virou ADVANCE:
│   └── ATUALIZA: Despesa de Adiantamento correspondente
│
└── SEMPRE:
    └── ATUALIZA: Despesa de Salário Principal
        └── Recalcula valor líquido
```

#### 3.4. Fechamento da Folha

**Arquivo:** `src/core/financial/payable/payable.service.ts`
**Método:** `payInstallment()`
**Linha:** 770-809

```
QUANDO: Parcela do salário é PAGA ou PROVISIONADA
│
└── SE expenseSource = EMPLOYEE E financialType = MAIN:
    └── ATUALIZA: Status da folha para CLOSED
```

### 4. Vinculação Financeiro ↔ Folha

#### Busca por Competência:
```typescript
// Primeiro dia do mês da folha
referenceDate >= new Date(year, month, 1)
referenceDate <= new Date(year, month + 1, 0) // Último dia
```

#### Identificadores nas Despesas:
```typescript
{
  employeeId: string,          // Colaborador
  expenseSource: 'EMPLOYEE',   // Origem
  financialType: 'MAIN' | 'ADVANCE',
  referenceDate: Date,         // Competência (mês/ano)
  description: string          // "Folha MM/YYYY - Salário" ou "...Adiantamento"
}
```

### 5. Regras de Negócio Importantes

#### ❌ Não é possível:
- Reabrir folha se salário já foi pago
- Criar salário com valor líquido negativo
- Adicionar item que torne saldo negativo

#### ✅ Comportamentos:
- Adiantamento **sempre** cria despesa separada
- Salário principal **sempre** reflete o valor líquido atual
- Pagamento do salário **fecha** a folha automaticamente
- Múltiplos adiantamentos = múltiplas despesas

---

## 📅 Despesas Programadas

### Conceito

Despesas programadas (ScheduledExpense) são **templates** de despesas recorrentes que podem ser lançadas manualmente no financeiro.

### Características

```typescript
{
  amount: number,              // Valor base
  description: string,
  dueDay: number,              // Dia do vencimento (1-31)
  recurringType: string,       // MONTHLY, ANNUAL, etc.
  supplierId: string,
  categoryId: string,          // natureId
  subCategoryId: string,
  isActive: boolean,
}
```

### Ciclo de Vida

```
1. CADASTRO
   └── Despesa programada criada (ScheduledExpense)
       └── Não afeta financeiro

2. LANÇAMENTO
   └── Usuário seleciona despesas e datas
       └── Sistema cria Payable + Installment
           ├── scheduledExpenseId: vincula à programada
           └── status: PENDING

3. ACOMPANHAMENTO
   └── Despesa programada mostra:
       ├── Total de lançamentos
       ├── Lançamentos pendentes
       └── Lançamentos pagos
```

### Agrupamento por Fornecedor

**Método:** `findAllGroupedBySupplier()`
**Linha:** 462-655

Permite visualizar todas as despesas programadas agrupadas por fornecedor, com:
- Total de despesas programadas
- Total de lançamentos no mês
- Status dos lançamentos (pagos/pendentes)

---

## ⚖️ Diferenças em Pagamentos

### Conceito

Quando o valor pago difere do valor esperado, o sistema cria automaticamente novas transações para registrar a diferença.

### Regras para Receivables (Contas a Receber)

```
Diferença = Valor Pago - Valor Esperado

SE Diferença > 0:  (recebi MAIS)
├── CRIA: Nova Receita (receivable)
└── Tipo: Receita adicional (acréscimo)

SE Diferença < 0:  (recebi MENOS)
├── CRIA: Nova Despesa (payable)
└── Tipo: Desconto concedido
```

### Regras para Payables (Contas a Pagar)

```
Diferença = Valor Pago - Valor Esperado

SE Diferença > 0:  (paguei MAIS)
├── CRIA: Nova Despesa (payable)
└── Tipo: Despesa adicional

SE Diferença < 0:  (paguei MENOS)
├── CRIA: Nova Receita (receivable)
└── Tipo: Economia/desconto obtido
```

### Validações Obrigatórias

```typescript
{
  differenceNatureId: string,      // Natureza deve estar ativa
  differenceCategoryId: string,    // Subcategoria deve estar ativa

  // A natureza deve ser do tipo correto:
  // - Diferença positiva em receivable = natureza receivable (level1 = '01')
  // - Diferença negativa em receivable = natureza payable (level1 = '02')
  // - Diferença positiva em payable = natureza payable (level1 = '02')
  // - Diferença negativa em payable = natureza receivable (level1 = '01')

  // Subcategoria deve pertencer à natureza
  // Natureza e subcategoria devem ser da mesma empresa
}
```

### Características das Transações de Diferença

```typescript
{
  description: `Diferença no pagamento da parcela X - [descrição original]`,
  referenceDate: Date,         // Herda da transação original
  clientId: string,            // Herda da transação original
  supplierId: string,          // Herda da transação original
  natureId: string,            // Fornecida pelo usuário
  subCategoryId: string,       // Fornecida pelo usuário
  totalAmount: Math.abs(difference),
  installmentQty: 1,
  status: 'PAID' | 'PROVISIONED',  // Mesmo da transação original
}
```

### Impacto no Caixa

```
SE tipo de pagamento ≠ PROVISION:
├── CRIA: Transação no caixa (Transaction)
└── ATUALIZA: Totais do caixa
    ├── totalIncomes (se receita)
    └── totalOutcomes (se despesa)

SENÃO:
└── NÃO impacta o caixa (apenas provisiona)
```

### Cancelamento de Diferenças

**Arquivo:** `receivable.service.ts` e `payable.service.ts`
**Método:** `undoPaymentInstallment()`

Quando o pagamento de uma parcela é desfeito:
1. Busca descrição padrão da diferença
2. Cancela todas as transações de diferença relacionadas
3. Remove transações do caixa (se aplicável)

---

## 🔄 Fluxo de Dados

### 1. Criação Completa de Receita

```
ENTRADA (CreateReceivableDto)
├── Dados principais
├── Array de parcelas
└── IDs de relacionamentos

↓ VALIDAÇÃO
├── Pelo menos 1 parcela
└── Dados obrigatórios

↓ CÁLCULO
└── totalAmount = Σ (parcelas + taxas)

↓ TRANSAÇÃO
├── CREATE Receivable
└── CREATE MANY ReceivableInstallment[]
    └── status: PENDING

↓ RESULTADO
└── Receivable com ID gerado
```

### 2. Criação Completa de Despesa

```
ENTRADA (CreatePayableDto)
├── Dados principais
├── Array de parcelas
└── IDs de relacionamentos

↓ VALIDAÇÃO
├── Pelo menos 1 parcela
└── Dados obrigatórios

↓ SANITIZAÇÃO
├── supplierId vazio → null
└── employeeId vazio → null

↓ CÁLCULO
└── totalAmount = Σ (parcelas + taxas)

↓ TRANSAÇÃO
├── CREATE Payable
└── CREATE MANY PayableInstallment[]
    └── status: PENDING

↓ RESULTADO
└── Payable com ID gerado
```

### 3. Pagamento de Parcela

```
ENTRADA (PayInstallmentDto)
├── paymentConditionId
├── bankAccountId
├── amount
├── paidDate
└── dados de diferença (opcional)

↓ VALIDAÇÕES
├── Conta bancária configurada?
├── Parcela existe e está PENDING?
└── Dados de diferença válidos?

↓ BUSCA CONFIGURAÇÃO
└── BankAccountCashControl
    ├── incomeType/paymentType
    └── INCOME ou PROVISION

↓ TRANSAÇÃO
├── UPDATE Installment
│   ├── status: PAID ou PROVISIONED
│   ├── paidAmount
│   ├── paidDate ou provisionDate
│   └── IDs de conta/condição
│
├── SE diferença ≠ 0:
│   ├── CREATE novo Receivable/Payable
│   ├── CREATE nova Installment
│   └── SE não PROVISION:
│       └── IMPACTA Caixa
│
└── SE não PROVISION:
    └── compensateInstallment()
        ├── CREATE Transaction (caixa)
        └── UPDATE CashRegister totals

↓ PÓS-PROCESSAMENTO
├── updateReceivableStatus() ou updatePayableStatus()
│
└── SE despesa de salário:
    └── FECHA folha de pagamento
```

### 4. Geração de Folha de Pagamento

```
ENTRADA
├── month, year
└── employeeIds[]

↓ BUSCA COLABORADORES
└── Com PayrollSetup.isSet = true

↓ PARA CADA COLABORADOR
│
├── CALCULA
│   ├── Σ INCREASE
│   ├── Σ DISCOUNT
│   └── Salário líquido = increases - discounts
│
├── TRANSAÇÃO
│   ├── CREATE Payroll
│   ├── CREATE MANY PayrollItem[]
│   └── SE salário líquido > 0:
│       └── createSalaryExpense()
│           ├── CREATE Payable
│           │   ├── financialType: implícito MAIN
│           │   ├── expenseSource: EMPLOYEE
│           │   └── referenceDate: primeiro dia mês
│           └── CREATE PayableInstallment
│               └── dueDate: dia 5 do mês
│
└── RESULTADO
    ├── success, skipped, errors
    └── Array de detalhes
```

### 5. Lançamento de Despesa Programada

```
ENTRADA
├── scheduledExpenseIds[]
├── competenceDate
├── dueDate
├── amount
└── notes

↓ PARA CADA scheduledExpenseId
│
├── BUSCA ScheduledExpense
│
└── TRANSAÇÃO
    ├── CREATE Payable
    │   ├── scheduledExpenseId: vincula
    │   ├── referenceDate: competenceDate
    │   ├── Herda: supplier, natureza, subcategoria
    │   └── description: da programada
    │
    └── CREATE PayableInstallment
        ├── dueDate: fornecido
        ├── amount: fornecido
        └── status: PENDING

↓ RESULTADO
├── Total de sucessos
├── Total de erros
└── Detalhes por item
```

---

## 🔍 Considerações Importantes

### 1. Transações e Atomicidade

Todas as operações críticas usam `prisma.$transaction()` para garantir:
- Consistência dos dados
- Rollback automático em caso de erro
- Integridade referencial

### 2. Status de Parcelas

```
PENDING      → Aguardando pagamento
PROVISIONED  → Provisionado (valor reservado, mas não movimentado)
PAID         → Pago (impactou o caixa)
CANCELED     → Cancelado
OVERDUE      → Calculado dinamicamente (PENDING + vencido)
```

### 3. Status de Títulos

```
PENDING   → Tem parcelas pendentes
PAID      → Todas as parcelas pagas
CANCELED  → Cancelado (cancela parcelas pendentes)
```

### 4. Campos de Auditoria

Todas as entidades possuem:
```typescript
{
  cancelReason?: string,
  cancelNotes?: string,
  changeReason?: string,
  changeNotes?: string,
  createdAt: Date,
  updatedAt: Date,
}
```

### 5. Relacionamentos Importantes

```
Receivable
├── n ReceivableInstallment
├── 1 Client (opcional)
├── 1 Supplier (opcional)
├── 1 Nature
├── 1 SubCategory
└── 1 Quotation (opcional)

Payable
├── n PayableInstallment
├── 1 Supplier (opcional)
├── 1 Employee (opcional)
├── 1 Nature
├── 1 SubCategory
├── 1 Quotation (opcional)
└── 1 ScheduledExpense (opcional)

Payroll
├── n PayrollItem (INCREASE, DISCOUNT, ADVANCE)
├── 1 Employee
├── n Payable (via employeeId + referenceDate + expenseSource)
└── 1 Company
```

### 6. Tipos Financeiros (financialType)

```
MAIN          → Título principal (venda ou salário)
DOWN_PAYMENT  → Entrada de venda
DELIVERY      → Despesa de entrega (transportadora)
ADVANCE       → Adiantamento salarial
```

### 7. Fontes de Despesa (expenseSource)

```
EMPLOYEE  → Despesa relacionada a colaborador (salários, adiantamentos)
SUPPLIER  → Despesa relacionada a fornecedor
(outros tipos podem existir)
```

### 8. Conta Bancária - Quando é Gravada?

**✅ NOVA FUNCIONALIDADE:** A conta bancária **PODE** ser gravada na criação de receitas e despesas.

#### ✅ Agora existe na criação (OPCIONAL):
```typescript
// CreateReceivableDto e CreatePayableDto
{
  referenceDate: Date,
  description: string,
  companyId: string,
  clientId: string,
  natureId: string,
  bankAccountId?: string,  // ✅ OPCIONAL - Conta padrão para todas as parcelas
}

// CreateReceivableInstallmentDto e CreatePayableInstallmentDto
{
  dueDate: string,
  amount: number,
  paymentConditionId: string,
  bankAccountId?: string,  // ✅ OPCIONAL - Conta específica desta parcela
}
```

#### 🔄 Lógica de Prioridade da Conta Bancária:

```
PRIORIDADE NA CRIAÇÃO:
│
├─ 1º) Parcela tem bankAccountId próprio?
│      └─ SIM → Usa a conta da parcela ✅
│
├─ 2º) DTO principal tem bankAccountId?
│      └─ SIM → Usa a conta informada no DTO ✅
│
├─ 3º) Nenhuma conta foi informada?
│      └─ Busca primeira conta ATIVA da empresa
│         (ordenada por createdAt ASC) ✅
│
└─ 4º) Empresa não tem conta ativa?
       └─ Grava NULL (parcela sem conta padrão)
```

#### Exemplos de Uso:

**Exemplo 1: Conta padrão para todas as parcelas**
```json
POST /receivable
{
  "description": "Venda Produto X",
  "companyId": "uuid-empresa",
  "clientId": "uuid-cliente",
  "bankAccountId": "uuid-conta-principal",  // ← Todas as parcelas usarão esta
  "installments": [
    { "dueDate": "2025-11-01", "amount": 1000, "paymentConditionId": "..." },
    { "dueDate": "2025-12-01", "amount": 1000, "paymentConditionId": "..." }
  ]
}
// Resultado: Ambas parcelas criadas com bankAccountId = "uuid-conta-principal"
```

**Exemplo 2: Contas diferentes por parcela**
```json
POST /receivable
{
  "description": "Venda Produto Y",
  "companyId": "uuid-empresa",
  "clientId": "uuid-cliente",
  "bankAccountId": "uuid-conta-padrao",     // ← Padrão
  "installments": [
    {
      "dueDate": "2025-11-01",
      "amount": 1000,
      "paymentConditionId": "...",
      "bankAccountId": "uuid-conta-especial" // ← Esta usa conta diferente
    },
    {
      "dueDate": "2025-12-01",
      "amount": 1000,
      "paymentConditionId": "..."
      // Esta herda a conta padrão do DTO
    }
  ]
}
// Resultado:
// Parcela 1: bankAccountId = "uuid-conta-especial"
// Parcela 2: bankAccountId = "uuid-conta-padrao"
```

**Exemplo 3: Sem informar conta (busca automática)**
```json
POST /receivable
{
  "description": "Venda Produto Z",
  "companyId": "uuid-empresa",
  "clientId": "uuid-cliente",
  // Sem bankAccountId → Sistema busca primeira conta ativa
  "installments": [
    { "dueDate": "2025-11-01", "amount": 1000, "paymentConditionId": "..." },
    { "dueDate": "2025-12-01", "amount": 1000, "paymentConditionId": "..." }
  ]
}
// Resultado: Sistema busca BankAccount ativo da empresa (createdAt ASC)
// Parcelas criadas com a primeira conta encontrada
```

#### ✅ Também pode ser alterada no PAGAMENTO:

```typescript
// PayInstallmentDto (ao pagar uma parcela)
{
  paymentConditionId: string,
  bankAccountId: string,      // ✅ Substitui a conta padrão
  amount: number,
  paidDate: string,
}

// IMPORTANTE: No pagamento, a conta informada SUBSTITUI a conta padrão
```

#### Fluxo Completo Atualizado:

```
1. CRIAÇÃO (receivable.create / payable.create)
   ├── Cria título principal
   └── Cria parcelas com:
       ├── amount
       ├── dueDate
       ├── status: PENDING
       └── bankAccountId: (seguindo lógica de prioridade) ✅
           ├── Da parcela (se informado)
           ├── Do DTO (se informado)
           ├── Primeira conta ativa da empresa
           └── NULL (se empresa não tem conta)

2. PAGAMENTO (receivable.payInstallment / payable.payInstallment)
   ├── Usuário informa:
   │   ├── bankAccountId ✅ (substitui a conta padrão)
   │   ├── paymentConditionId ✅
   │   ├── amount (valor pago)
   │   └── paidDate
   │
   └── Sistema atualiza parcela:
       ├── bankAccountId = informado (SUBSTITUI) ✅
       ├── paymentConditionId = informado ✅
       ├── paidAmount = informado
       ├── paidDate = informado
       └── status = PAID ou PROVISIONED
```

#### Por que essa mudança?

1. **Conveniência:** Não precisa ficar sem conta até o pagamento
2. **Planejamento:** Permite definir antecipadamente qual conta usar
3. **Flexibilidade mantida:** Ainda pode mudar no pagamento
4. **Automação:** Busca automática da primeira conta se não informar
5. **Compatibilidade:** Sistema continua funcionando sem informar conta (NULL)

#### 🎯 Aplicado em TODOS os Fluxos Automáticos:

A lógica de buscar conta bancária padrão foi implementada em **TODOS** os pontos de criação automática:

✅ **Vendas/Orçamentos** ([quotation.service.ts:3126-3210](src/core/sale/quotation/quotation.service.ts#L3126-L3210))
- Receita principal (MAIN)
- Receita de entrada (DOWN_PAYMENT)

✅ **Folha de Pagamento** ([salary-sheets.service.ts:821-960](src/core/financial/salary-sheets/salary-sheets.service.ts#L821-L960))
- Despesa de salário (MAIN)
- Despesa de adiantamento (ADVANCE)

✅ **Despesas Programadas** ([scheduled-expense.service.ts:657-724](src/core/financial/scheduled-expense/scheduled-expense.service.ts#L657-L724))
- Lançamento de despesas recorrentes

**Resultado:** Ao aprovar venda, abrir folha de pagamento ou lançar despesa programada, **todas as parcelas já vêm com conta bancária padrão gravada!** 🎉

### 9. Controle de Caixa - Quando é Afetado?

**✅ IMPORTANTE:** O controle de caixa (CashRegister/Transaction) é impactado quando uma parcela é **EFETIVAMENTE PAGA/RECEBIDA**.

#### ✅ SITUAÇÕES QUE AFETAM O CAIXA:

**1. Pagamento Manual de Parcela Existente**
- Método: `receivable.payInstallment()` / `payable.payInstallment()`
- Fluxo:
  ```
  1. Atualiza parcela (status = PAID, paidAmount, paidDate)
  2. Chama compensateInstallment()
  3. Cria Transaction (INCOME ou OUTCOME) vinculada à parcela
  4. Incrementa totalIncomes/totalOutcomes do CashRegister
  ```
- **Resultado:** ✅ Afeta o caixa

**2. Criação de Parcela Já Paga (status: "PAID")**
- **✅ NOVA FUNCIONALIDADE:** Agora cria Transaction automaticamente!
- Método: `receivable.create()` / `payable.create()`
- Fluxo:
  ```typescript
  // Ao criar receita/despesa com parcela PAID
  {
    "installments": [
      {
        "status": "PAID",
        "paidDate": "2025-10-13",
        "amount": 50000
      }
    ]
  }

  // Sistema automaticamente:
  1. Cria a parcela com status PAID
  2. Preenche paidAmount = amount (valor efetivamente pago)
  3. Busca CashRegister OPEN para aquela conta e data
  4. Cria Transaction (INCOME/OUTCOME) vinculada
  5. Incrementa totalIncomes/totalOutcomes do CashRegister
  ```
- **Resultado:** ✅ Afeta o caixa automaticamente
- **Campos preenchidos na parcela:**
  - `status: "PAID"`
  - `paidDate: Date` (data informada)
  - `paidAmount: number` (✅ igual ao `amount`)
  - `bankAccountId: string` (próprio, do DTO, ou automático)
- **Requisitos para afetar o caixa:**
  - `status: "PAID"` informado
  - `paidDate` informado
  - `bankAccountId` definido (próprio, do DTO, ou automático)
  - Existe CashRegister OPEN para aquela conta

**3. Diferenças em Pagamentos**
- Quando valor pago ≠ valor esperado
- Cria nova receita/despesa automaticamente
- Se a diferença for com status PAID (não PROVISIONED)
- **Resultado:** ✅ Afeta o caixa

#### ❌ SITUAÇÕES QUE NÃO AFETAM O CAIXA:

**1. Criação Normal de Receita/Despesa (status: PENDING)**
```typescript
POST /receivable
{
  "installments": [
    {
      "status": "PENDING",  // ou não informado
      "dueDate": "2025-11-01",
      "amount": 50000
    }
  ]
}
```
- **Resultado:** ❌ NÃO afeta o caixa (apenas cria título/parcela)

**2. Criação via Fluxos Automáticos (Venda, Folha, etc.)**
```typescript
// Ao aprovar venda, abrir folha, lançar despesa programada
// Todas as parcelas são criadas com status PENDING
```
- **Resultado:** ❌ NÃO afeta o caixa na criação
- **Motivo:** Parcelas iniciam como PENDING
- **Solução:** Posteriormente usar `payInstallment()` para pagar e afetar o caixa

**3. Provisionamento (status: PROVISIONED)**
```typescript
// Se bankAccountCashControl.incomeType === 'PROVISION'
// Parcela fica como PROVISIONED (não PAID)
```
- **Resultado:** ❌ NÃO afeta o caixa
- **Motivo:** Provisão é reserva, não movimentação efetiva

#### 🔄 Resumo do Fluxo Completo:

```
┌─────────────────────────────────────────────────────────────────┐
│ CRIAÇÃO DE RECEITA/DESPESA                                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Parcela com status = "PENDING"?                               │
│  └─ ❌ NÃO afeta caixa (aguarda pagamento posterior)          │
│                                                                 │
│  Parcela com status = "PAID" + paidDate + bankAccountId?       │
│  └─ ✅ AFETA CAIXA AUTOMATICAMENTE                            │
│      ├─ Busca CashRegister OPEN                               │
│      ├─ Cria Transaction (INCOME/OUTCOME)                     │
│      └─ Incrementa total do caixa                             │
│                                                                 │
│  Parcela com status = "PROVISIONED"?                           │
│  └─ ❌ NÃO afeta caixa (apenas provisão)                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ PAGAMENTO POSTERIOR DE PARCELA                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  PATCH /receivable/pay-installment/:id                         │
│  PATCH /payable/pay-installment/:id                            │
│                                                                 │
│  └─ ✅ SEMPRE afeta caixa (se não for PROVISION)              │
│      ├─ Atualiza parcela (status = PAID)                      │
│      ├─ Chama compensateInstallment()                         │
│      ├─ Cria Transaction vinculada                            │
│      └─ Incrementa total do caixa                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### 📝 Exemplo Prático:

**Cenário 1: Criar receita pendente e pagar depois**
```typescript
// 1. Criar receita (NÃO afeta caixa)
POST /receivable
{
  "installments": [{ "status": "PENDING", "amount": 1000 }]
}

// 2. Pagar depois (AFETA caixa)
PATCH /receivable/pay-installment/:id
{
  "amount": 1000,
  "paidDate": "2025-10-13",
  "bankAccountId": "...",
  "paymentConditionId": "..."
}
```

**Cenário 2: Criar receita já paga (novo!)**
```typescript
// Criar receita JÁ PAGA (AFETA caixa automaticamente)
POST /receivable
{
  "installments": [{
    "status": "PAID",
    "paidDate": "2025-10-13",
    "amount": 1000,
    "paymentConditionId": "..."
  }],
  "bankAccountId": "..."
}

// ✅ Sistema cria:
// - Receivable + ReceivableInstallment com:
//   ├─ status: "PAID"
//   ├─ amount: 1000
//   ├─ paidAmount: 1000 (✅ preenchido automaticamente)
//   ├─ paidDate: "2025-10-13"
//   └─ bankAccountId: "..."
// - Transaction (INCOME) de 1000 no CashRegister
// - Incrementa totalIncomes do caixa em 1000
//
// 📊 Frontend recebe paidAmount = 1000 (não null ou 0)
```

### 10. Cálculo de Status Dinâmico

O status OVERDUE **não** é salvo no banco:
```typescript
getActualStatus(installment) {
  if (status === 'PENDING' && dueDate < hoje) {
    return 'OVERDUE';
  }
  return status;
}
```

### 10. Sincronização Folha ↔ Financeiro

#### Eventos que Atualizam o Financeiro:
- Geração da folha
- Adição de item (INCREASE, DISCOUNT, ADVANCE)
- Atualização de item
- Atualização de valor em itens

#### Eventos que Atualizam a Folha:
- Pagamento do salário principal (fecha a folha)

#### Atenção:
- A sincronização é **unidirecional**: Folha → Financeiro
- **Nunca** edite manualmente despesas de salário no financeiro
- Sempre faça alterações na folha de pagamento

### 11. Naturezas e Categorias

```
Nature (Natureza)
├── level1: '01' (Receita) | '02' (Despesa)
├── level2: Subcategoria de nível 2
├── code: Código único
└── description: Descrição

SubCategory
├── natureId: Vinculada a uma natureza
├── code: Código único
└── description: Descrição
```

**Validação:** Ao criar receita/despesa, a categoria deve pertencer à natureza correta (level1).

### 12. Condições de Pagamento

```
PaymentCondition
├── name: Nome da condição
├── costType: 'VALUE' | 'PERCENTAGE'
├── cost: Valor ou percentual da taxa
└── BankAccountCashControl[]
    ├── bankAccountId
    ├── incomeType: 'INCOME' | 'PROVISION'
    └── paymentType: 'OUTCOME' | 'PROVISION'
```

### 13. Impacto no Caixa

```
PROVISION:
└── NÃO movimenta o caixa imediatamente
    └── Apenas reserva o valor

INCOME/OUTCOME:
└── Movimenta o caixa imediatamente
    ├── CREATE Transaction
    └── UPDATE CashRegister totals
```

### 14. Cancelamento vs Exclusão

#### Cancelamento:
- Mantém o registro histórico
- Status muda para CANCELED
- Pode ser desfeito (undoCancel)
- Parcelas pendentes são canceladas

#### Exclusão (remove):
- Apaga definitivamente do banco
- Remove parcelas e histórico
- **Não pode** ser desfeito
- Use com cautela

### 15. Diferenças no Pagamento - Boas Práticas

#### Sempre:
- Selecionar natureza e categoria corretas
- Verificar o tipo esperado (receita ou despesa)
- Documentar o motivo da diferença

#### Nunca:
- Usar mesma natureza da transação original
- Deixar diferença sem categoria
- Processar diferença sem validação

### 16. Folha de Pagamento - Limitações

#### Não é possível:
- Editar folha fechada (status CLOSED)
- Adicionar item que deixe saldo negativo
- Reabrir folha com salário já pago

#### É possível:
- Adicionar múltiplos adiantamentos
- Ter salário líquido zero
- Ter múltiplos itens de acréscimo/desconto

---

## 📝 Resumo Executivo

### Pontos de Criação de Receitas:
1. ✅ Criação direta via API (receivable.service.ts)
2. ✅ Diferença positiva em pagamento de receivable
3. ✅ Diferença negativa em pagamento de payable
4. ✅ Vendas/Orçamentos (título principal e entrada)
5. ✅ Reativação de receitas canceladas

### Pontos de Criação de Despesas:
1. ✅ Criação direta via API (payable.service.ts)
2. ✅ Diferença positiva em pagamento de payable
3. ✅ Diferença negativa em pagamento de receivable
4. ✅ Folha de pagamento (salário principal)
5. ✅ Folha de pagamento (adiantamentos)
6. ✅ Lançamento de despesas programadas
7. ✅ Comissões de vendas
8. ✅ Despesas de entrega (transportadora)
9. ✅ Reativação de despesas canceladas

### Principais Características:
- ✅ Sistema transacional robusto
- ✅ Auditoria completa com histórico
- ✅ Sincronização automática (folha ↔ financeiro)
- ✅ Tratamento de diferenças em pagamentos
- ✅ Vinculação com vendas e orçamentos
- ✅ Despesas programadas recorrentes
- ✅ Gestão de caixa integrada

---

**Documento gerado automaticamente em:** 2025-10-13
**Baseado no código-fonte do sistema Atrupe API**
