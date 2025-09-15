# Análise das Naturezas Base (BASE_NATURES)

## Comparação entre BASE_NATURES e Dados Fornecidos

### Estrutura Atual no BASE_NATURES
O arquivo `src/seeds/natures-base.ts` contém naturezas organizadas de forma plana, sem a hierarquia completa de level1/level2.

### Estrutura dos Dados Fornecidos
Os dados fornecidos têm uma estrutura hierárquica completa:
- **Level 1**: Receitas (01) / Despesas (02)
- **Level 2**: Administrativo (01) / Operacional (02) / Não operacional (03)
- **Natures**: Cada natureza com code, level1, level2
- **SubCategories**: Subcategorias vinculadas às naturezas

## Itens Ausentes no BASE_NATURES

### 1. RECEITAS - Operacional - Vendas (01.02.01)

**Subcategorias Ausentes:**
- **Descontos Recebidos** (code: 05) ❌ FALTANDO
- **Juros Recebidos** (code: 06) ❌ FALTANDO

**Subcategorias Presentes:**
- Prestação de Serviços (01) ✅
- Venda de Mercadorias (02) ✅ 
- Receita de Aluguéis (03) ✅
- Receita Diversas (04) ✅

### 2. DESPESAS - Operacional - Operacional (02.02.01)

**Subcategorias Ausentes:**
- **Descontos Concedidos** (code: 11) ❌ FALTANDO

**Subcategorias Presentes:**
- Matéria Prima (01) ✅
- Produtos para Revenda (02) ✅
- Terceirizados de O.S. (03) ✅
- Aluguel de Máquinas e Equipamentos (04) ✅
- Despesas de Viagem (05) ✅
- Comissão de Venda (06) ✅
- Frete de Compra (07) ✅
- Frete de Venda (08) ✅
- DAS - Simples Nacional (09) ✅
- Dare - Documento de Arrecadação Receitas Estaduais (10) ✅

### 3. DESPESAS - Operacional - Despesas Financeiras (02.02.04)

**Subcategorias com Nomenclatura Diferente:**
- BASE_NATURES: "Juros" (code: 03)
- Dados Fornecidos: "Juros Pagos" (code: 03)
- **Recomendação**: Padronizar para "Juros Pagos"

## Subcategorias Completamente Ausentes

### RECEITAS - Não Operacional
Todas as subcategorias estão presentes no BASE_NATURES.

### DESPESAS - Administrativo
Todas as subcategorias estão presentes no BASE_NATURES.

### DESPESAS - Não Operacional  
Todas as subcategorias estão presentes no BASE_NATURES.

## Resumo das Ações Necessárias

### Adições Obrigatórias:
1. **Adicionar à natureza "Vendas" (01.02.01)**:
   - Descontos Recebidos (code: 05)
   - Juros Recebidos (code: 06)

2. **Adicionar à natureza "Operacional" (02.02.01)**:
   - Descontos Concedidos (code: 11)

### Correções de Nomenclatura:
1. **Na natureza "Despesas Financeiras" (02.02.04)**:
   - Alterar "Juros" para "Juros Pagos" (code: 03)

## Estrutura Atualizada Recomendada

```typescript
// Adicionar às subcategorias da natureza "Vendas"
{
  description: 'Descontos Recebidos',
  code: '05',
},
{
  description: 'Juros Recebidos',
  code: '06',
}

// Adicionar às subcategorias da natureza "Operacional" 
{
  description: 'Descontos Concedidos',
  code: '11',
}

// Corrigir nomenclatura em "Despesas Financeiras"
{
  description: 'Juros Pagos', // era "Juros"
  code: '03',
}
```