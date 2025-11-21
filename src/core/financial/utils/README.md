# Utilitários Financeiros

## FinancialNotesUtil

Utilitário para gerenciar notas automáticas em movimentações financeiras (receivables e payables).

### Funcionalidade

Quando alterações são feitas em movimentações financeiras, o sistema adiciona automaticamente um texto no campo `notes`, mantendo o conteúdo atual e incluindo em uma nova linha o que foi feito nessa movimentação.

### Alterações Monitoradas

#### 1. Alteração de Valor Total

Quando o valor total de uma movimentação é alterado:

```
[21/11/2025 às 14:30] Valor total alterado de R$ 1000.00 para R$ 1200.00 (acréscimo de R$ 200.00)
```

#### 2. Alteração de Data de Referência

Quando a data de referência é alterada:

```
[21/11/2025 às 14:30] Data de referência alterada de 15/10/2025 para 20/10/2025
```

#### 3. Alterações em Parcelas Individuais

**Alteração de valor de parcela:**

```
[21/11/2025 às 14:30] Parcela 1: valor alterado de R$ 500.00 para R$ 600.00 (acréscimo de R$ 100.00)
```

**Alteração de data de vencimento:**

```
[21/11/2025 às 14:30] Parcela 2: vencimento alterado de 15/11/2025 para 20/11/2025
```

#### 4. Adição ou Remoção de Parcelas

Quando parcelas são adicionadas ou removidas (não quando apenas modificadas):

```
[21/11/2025 às 14:30] Parcelas alteradas: 2 parcela(s) adicionada(s), 1 parcela(s) removida(s)
```

**Nota:** Modificações em valores ou datas de parcelas existentes são registradas individualmente (itens 3.1 e 3.2), não gerando linha de resumo adicional.

### Múltiplas Alterações

Quando várias alterações são feitas simultaneamente, o sistema agrupa todas em uma única entrada com timestamp.

**Exemplo 1 - Apenas modificação de vencimento:**

```
[21/11/2025 às 14:30] Parcela 1: vencimento alterado de 21/11/2025 para 24/11/2025
```

**Exemplo 2 - Várias alterações incluindo valor total e data:**

```
[21/11/2025 às 14:30] Múltiplas alterações realizadas:
  - Valor total alterado de R$ 1000.00 para R$ 1200.00 (acréscimo de R$ 200.00)
  - Data de referência alterada de 15/10/2025 para 20/10/2025
  - Parcela 1: valor alterado de R$ 500.00 para R$ 600.00 (acréscimo de R$ 100.00)
```

**Exemplo 3 - Adição de novas parcelas e modificação de existentes:**

```
[21/11/2025 às 14:30] Múltiplas alterações realizadas:
  - Parcela 3: valor alterado de R$ 300.00 para R$ 350.00 (acréscimo de R$ 50.00)
  - Parcelas alteradas: 2 parcela(s) adicionada(s)
```

**Exemplo 4 - Apenas remoção de parcelas:**

```
[21/11/2025 às 14:30] Parcelas alteradas: 1 parcela(s) removida(s)
```

### Onde é Aplicado

A funcionalidade é aplicada automaticamente nos seguintes métodos:

1. **ReceivableService**

   - `updateTitle()` - Alterações no título (valor total, data de referência)
   - `updateInstallments()` - Alterações nas parcelas

2. **PayableService**
   - `updateTitle()` - Alterações no título (valor total, data de referência)
   - `updateInstallments()` - Alterações nas parcelas

### Formato das Notas

Todas as notas seguem o padrão:

```
[DD/MM/YYYY às HH:mm] Descrição da alteração
```

As notas são sempre **adicionadas** ao campo existente, nunca substituídas. Cada nova alteração é adicionada em uma nova linha.

### Exemplo Completo

Conteúdo do campo `notes` após várias alterações ao longo do tempo:

```
[15/11/2025 às 10:15] Valor total alterado de R$ 1000.00 para R$ 1100.00 (acréscimo de R$ 100.00)
[16/11/2025 às 11:20] Parcela 1: vencimento alterado de 15/12/2025 para 20/12/2025
[18/11/2025 às 09:45] Parcela 2: valor alterado de R$ 500.00 para R$ 550.00 (acréscimo de R$ 50.00)
[21/11/2025 às 14:30] Múltiplas alterações realizadas:
  - Data de referência alterada de 15/10/2025 para 20/10/2025
  - Parcelas alteradas: 2 parcela(s) adicionada(s)
```
