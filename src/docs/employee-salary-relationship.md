# Análise de Relacionamento: Employee Service e Salaries Service

## Visão Geral

Este documento analisa o relacionamento e fluxos entre os serviços `EmployeeService` e `SalariesService`, identificando suas interdependências e padrões de uso.

## Estrutura dos Serviços

### EmployeeService (`src/core/employee/employee.service.ts`)
- **Responsabilidade**: Gerenciamento de colaboradores
- **Operações principais**: CRUD de employees, filtros por setor, status ativo/inativo
- **Relacionamentos**: Company, Sector, Role, User, Address

### SalariesService (`src/core/financial/salaries/salaries.service.ts`)
- **Responsabilidade**: Controle de salários e custos
- **Operações principais**: CRUD de salary controls, associação com employees
- **Relacionamentos**: Employee, Company

## Relacionamentos Identificados

### 1. Dependência Direta
```typescript
// SalariesService depende do Employee
employeeId: employee.id  // Linha 188
```

### 2. Contexto Compartilhado
```typescript
// Ambos operam no contexto de companyId
companyId: filters.companyId  // Employee: Linha 23, 81, 155
companyId: createSalaryControlDto.companyId  // Salaries: Linha 160, 186
```

### 3. Filtros Relacionais
```typescript
// SalariesService filtra por propriedades do Employee
where: {
  name: { contains: filters.search },     // Linha 30-34
  sector: { id: filters.sectorId },       // Linha 46-49
  isActive: true                          // Linha 24
}
```

## Fluxos de Dados

### 1. Criação em Massa de Salary Controls
**Fluxo**: `SalariesService.create()` → `EmployeeService` (busca employees)

```typescript
// Linha 158-167: Busca todos employees ativos da empresa
const employees = await this.prisma.employee.findMany({
  where: {
    companyId: createSalaryControlDto.companyId,
    isActive: true,
  }
});

// Linha 179-207: Cria salary control para cada employee
employees.map(async (employee) => {
  return await this.prisma.salaryControl.create({
    data: {
      employeeId: employee.id,
      // ... outros campos
    }
  });
});
```

### 2. Consultas com Dados Relacionais
**Fluxo**: `SalariesService.findAll()` → Join com Employee data

```typescript
// Linha 71-111: Query com joins relacionais
this.prisma.employee.findMany({
  select: {
    id: true,
    name: true,
    sector: { select: { id: true, name: true } },
    role: { select: { id: true, name: true } },
    SalaryControl: {
      select: { /* campos do salary control */ },
      where: whereSalaryControl,
      orderBy: { date: 'desc' }
    }
  }
});
```

### 3. Sincronização de Status
**Fluxo**: `EmployeeService.update()/remove()` → Impacto em Salary Controls

```typescript
// Employee.update() - Linha 275-287
if (isActive !== undefined) {
  // Desativa employee, mas salary controls permanecem
  if (!isActive && employee?.userId) {
    await tx.user.update({
      where: { id: employee.userId },
      data: { isActive: false }
    });
  }
}

// Employee.remove() - Linha 335-340
return await tx.employee.update({
  data: { isActive: false }  // Soft delete
});
```

## Padrões Identificados

### 1. Filtros Compartilhados
- **companyId**: Isolamento de dados por empresa
- **isActive**: Apenas employees ativos são considerados
- **search**: Busca por nome do employee
- **sectorId**: Filtro por setor do employee

### 2. Ordenação e Priorização
```typescript
// Linha 116-129: Priorização de "Salário base"
const sortedItems = [...employee.SalaryControl].sort((a, b) => {
  const baseSalaryReferences = [
    'Salário base', 'Salario base', 'Salário', 'Salario'
  ];
  const aIsBase = baseSalaryReferences.includes(a.reference);
  const bIsBase = baseSalaryReferences.includes(b.reference);
  
  if (aIsBase && !bIsBase) return -1;
  if (!aIsBase && bIsBase) return 1;
  return 0;
});
```

### 3. Transações e Consistência
- **Employee**: Usa transações para operações que afetam User relacionado
- **Salaries**: Operações individuais, mas criação em massa para todos employees

## Considerações Arquiteturais

### Pontos Fortes
1. **Isolamento por empresa**: Ambos serviços respeitam o contexto de companyId
2. **Soft delete**: Employee usa isActive=false, preservando histórico
3. **Consultas eficientes**: Uso de Promise.all para operações paralelas

### Pontos de Atenção
1. **Inconsistência potencial**: Employee inativo ainda pode ter salary controls ativos
2. **Criação em massa**: SalariesService.create() pode ser custoso para empresas grandes
3. **Dependência forte**: SalariesService fortemente acoplado ao modelo Employee

### Recomendações
1. Considerar cascade de desativação de salary controls quando employee é desativado
2. Implementar paginação na criação em massa de salary controls
3. Adicionar validações de integridade referencial
4. Considerar eventos/notifications para sincronização entre serviços

## Diagramas de Relacionamento

```
Employee (1) ←→ (N) SalaryControl
    ↓
  Company
    ↓
  Sector, Role, User, Address
```

## Análise de Conformidade com Fluxo Esperado

### ❌ **Problemas Identificados**

#### 1. Novos Funcionários Não Herdam Itens de Custo
**Fluxo Esperado:**
```
POST /employee → Novo funcionário deve receber automaticamente 
                 todos os salary items já criados na empresa
```

**Fluxo Atual:**
```typescript
// employee.service.ts:12-42
async create(createEmployeeDto: CreateEmployeeDto) {
  const employee = await this.prisma.employee.create({
    // ❌ Apenas cria employee, sem salary controls
  });
  return employee;
}
```

#### 2. Arquitetura de Templates Ausente
**Necessário:** Sistema de templates/padrões de salary items que novos employees herdam automaticamente.

**Atual:** Criação manual para todos employees existentes, sem herança para novos.

### ✅ **Funcionalidades Corretas**

#### 1. Edição Individual por Funcionário
```typescript
// salaries.service.ts:233-305
PATCH /financial/salaries/:id
// ✅ Permite valores diferentes por funcionário do mesmo item
```

#### 2. Habilitar/Desabilitar Items por Funcionário  
```typescript
// salaries.service.ts:254-257
updateData.isSet = updateSalaryControlDto.isSet;
// ✅ Controla se item está ativo para cada funcionário
```

#### 3. Listagem com Itens Personalizados
```typescript
// salaries.service.ts:114-141
GET /financial/salaries
// ✅ Mostra cada funcionário com seus valores específicos
```

### 🔧 **Correções Necessárias**

1. **Modificar EmployeeService.create():**
   - Buscar todos salary items existentes da empresa
   - Criar salary controls automáticos para o novo employee

2. **Implementar Sistema de Templates:**
   - Identificar quais são os "itens padrão" da empresa
   - Aplicar automáticamente a novos funcionários

3. **Validação de Consistência:**
   - Garantir que todos employees tenham os mesmos tipos de itens
   - Permitir valores diferentes, mas mesma estrutura base

## Conclusão

A implementação atual está **parcialmente alinhada** com o fluxo esperado. As funcionalidades de edição individual e habilitação/desabilitação funcionam corretamente, mas **falta a herança automática de itens de custo para novos funcionários**, que é um requisito crítico do fluxo descrito.