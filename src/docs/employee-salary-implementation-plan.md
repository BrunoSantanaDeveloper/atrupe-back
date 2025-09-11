# Plano de Ação: Implementação do Fluxo Employee-Salary com Templates

## Visão Geral
Este documento detalha o plano de implementação para corrigir o fluxo entre Employee e Salary Services, utilizando uma abordagem baseada em templates para garantir que novos funcionários herdem automaticamente os tipos de itens de custo da empresa, permitindo personalização individual.

## Fluxo Correto Esperado

### Estado Inicial
- Item "Salário" já existe como template por padrão no sistema

### Criação de Novos Tipos de Custo (Templates)
1. `POST /financial/salaries` → Cria templates "Vale transporte" + "Plano de saúde"
2. Aplica automaticamente a **todos employees existentes** baseado nos templates

### Criação de Novo Employee  
1. `POST /employee` → Herda automaticamente **todos os templates** da empresa:
   - "Salário" (template existente)
   - "Vale transporte" (template criado anteriormente)
   - "Plano de saúde" (template criado anteriormente)
2. Valores iniciais: `amount: 0, isSet: false`

### Personalização Individual
- `PATCH /financial/salaries/:id` → Edita apenas o salary control específico do funcionário
- Pode alterar nome, valor, habilitar/desabilitar sem afetar outros funcionários
- Novos funcionários sempre herdam do template original, não das personalizações

### Exemplo Prático
1. **Admin** criado → tem "Salário" (do template)
2. **Criar template "Vale transporte"** → Admin recebe "Vale transporte" 
3. **Editar "Vale transporte" do Admin para "Vale alimentação"** → Apenas Admin fica com "Vale alimentação"
4. **Criar funcionário João** → Herda "Salário" + "Vale transporte" (templates originais)
5. **João** nunca recebe "Vale alimentação" porque é personalização individual do Admin

## Problema Identificado
**Falta de separação entre templates e instâncias**: Atual implementação mistura "tipos padrão" com "valores individuais", causando inconsistências na herança de novos funcionários.

## Objetivo
✅ Separar templates da empresa de salary controls individuais, garantindo herança correta e personalização independente

## Implementação com Tabela de Templates

### Fase 1: Adicionar apenas SalaryTemplate (Abordagem Incremental)
**Duração estimada: 15 minutos**

```prisma
// 1. Adicionar novo model SalaryTemplate
model SalaryTemplate {
  id        String    @id @default(uuid())
  name      String    
  type      ItemType  @default(INCREASE)
  companyId String
  createdAt DateTime  @default(now())
  updatedAt DateTime? @updatedAt
  
  company   Company   @relation(fields: [companyId], references: [id])
  
  @@unique([name, type, companyId])
  @@map("salary_templates")
}

// 2. Atualizar model Company para incluir SalaryTemplate
model Company {
  // ... campos existentes
  salaryTemplates   SalaryTemplate[]
  SalaryControl     SalaryControl[]
  // ... outros campos
}

// 3. SalaryControl mantém estado atual (mudanças na Fase 4)
model SalaryControl {
  id         String    @id @default(uuid())
  reference  String    // Mantém por enquanto
  amount     Float     @default(0)
  type       ItemType  @default(INCREASE)
  date       DateTime  @default(now()) // Mantém por enquanto  
  companyId  String
  employeeId String
  createdAt  DateTime  @default(now())
  updatedAt  DateTime? @updatedAt
  isSet      Boolean   @default(false)
  
  company    Company   @relation(fields: [companyId], references: [id])
  employee   Employee  @relation(fields: [employeeId], references: [id])
  
  @@map("salary_controls")
  // Mudanças (reference→name, remover date) serão feitas na Fase 4
}
```

#### 1.1 Gerar Migration apenas para SalaryTemplate
```bash
# Gerar migration apenas para nova tabela (sem tocar em SalaryControl)
npx prisma migrate dev --name "add-salary-template-table"

# Prisma irá gerar automaticamente o SQL apenas para:
# - Criar tabela salary_templates
# - Criar índices e foreign keys da nova tabela
```

#### 1.2 Regenerar Prisma Client
```bash
# Regenerar Prisma Client com novos types
npx prisma generate
```

**Status:** ✅ Fase 1 Completada - SalaryTemplate adicionado sem problemas
- Database sync: OK
- Prisma Client generated: OK  
- Dados preservados: 154 registros SalaryControl intactos

### Fase 4: Cleanup SalaryControl (Posterior)
**Será feita após services funcionarem**
- Renomear `reference` → `name`
- Remover campo redundante `date`

### Fase 2: Modificação dos Services  
**Duração estimada: 3-4 horas**

#### 2.1 ✅ SalaryTemplatesService Criado
**Arquivo: `src/core/financial/salaries/salary-templates.service.ts`**
- createTemplate(): Criar templates da empresa
- getCompanyTemplates(): Buscar templates por empresa  
- applyTemplateToAllEmployees(): Aplicar template a todos employees
- applyTemplateToEmployee(): Aplicar templates a employee específico

#### 2.2 ✅ SalariesService.create() Modificado
**Arquivo: `src/core/financial/salaries/salaries.service.ts`**
- Cria/busca template automaticamente ao criar novo tipo
- Aplica template a todos employees existentes via transação
- Retorna informações do template criado

#### 2.3 ✅ EmployeeService.create() Modificado  
**Arquivo: `src/core/employee/employee.service.ts`**
- Busca templates da empresa após criar employee
- Cria salary controls baseados nos templates existentes
- Usa transação para garantir consistência

#### 2.4 ✅ Módulos Configurados
- SalaryTemplatesService adicionado ao SalariesModule
- SalariesModule exporta SalaryTemplatesService
- EmployeeModule importa SalariesModule

**Status:** ✅ Fase 2 Completada - Services modificados com sistema de templates

### Fase 3: Testes do Sistema de Templates
**Duração estimada: 30 minutos**

#### 3.1 ✅ Compilação TypeScript
- `npm run build` executado com sucesso
- Sem erros de tipos ou imports

#### 3.2 ✅ Relacionamento SalaryControl ↔ SalaryTemplate
- Campo `templateId` adicionado ao SalaryControl
- Relacionamento bidirecional configurado no schema
- Services atualizados para usar `templateId`
- Database sincronizado via `prisma db push`

#### 3.3 ✅ Correção: Aplicar a TODOS employees
- **Problema identificado:** Sistema aplicava apenas a employees ativos
- **Correção:** Removido filtro `isActive: true` 
- **Agora:** Novos itens de custo são aplicados a TODOS employees (ativos + inativos)

#### 3.4 ✅ Valor Padrão em Templates
- **Campo adicionado:** `defaultAmount` no SalaryTemplate
- **Comportamento:** Template armazena valor padrão do item de custo
- **Herança:** Novos employees recebem `defaultAmount` do template
- **Ativação automática:** `isSet = defaultAmount > 0`

#### 3.3 Teste do Fluxo Básico
**Cenário:** Criar template "Vale transporte" e verificar herança em novo employee

### Fase 4: Migration de Dados Existentes (Opcional)
**Duração estimada: 1-2 horas**

```typescript
// Script de migração para converter SalaryControls existentes em templates
async function migrateExistingSalaryControlsToTemplates() {
  const companies = await prisma.company.findMany();

  for (const company of companies) {
    // Buscar tipos únicos de salary controls da empresa
    const uniqueTypes = await prisma.salaryControl.findMany({
      where: { companyId: company.id },
      select: { name: true, type: true }, // Mudança de reference para name
      distinct: ['name', 'type']
    });

    // Criar templates para cada tipo único
    for (const uniqueType of uniqueTypes) {
      await prisma.salaryTemplate.upsert({
        where: {
          name_type_companyId: {
            name: uniqueType.name,
            type: uniqueType.type,
            companyId: company.id
          }
        },
        update: {},
        create: {
          name: uniqueType.name,
          type: uniqueType.type,
          companyId: company.id
        }
      });
    }
  }
}
```

### Tarefas de Implementação:
- [ ] **Schema Prisma**: Adicionar SalaryTemplate model e atualizar SalaryControl
- [ ] **Migration**: Executar `npx prisma migrate dev` para gerar migration automática
- [ ] **Prisma Client**: Executar `npx prisma generate` para novos types
- [ ] **SalaryTemplatesService**: Criar service para gerenciar templates
- [ ] **SalariesService**: Modificar create() para usar templates
- [ ] **EmployeeService**: Modificar create() para herdar de templates
- [ ] **DTOs**: Atualizar CreateSalaryControlDto e UpdateSalaryControlDto (reference → name, remover date)
- [ ] **Services**: Ajustar ordenação para usar createdAt ao invés de date
- [ ] **Migration Script**: Criar script para migrar dados existentes para templates
- [ ] **API Docs**: Atualizar documentação Swagger

## Cronograma com Templates

| Fase | Tarefa Principal | Duração Estimada |
|------|-----------------|-----------------|
| **Fase 1** | Schema Prisma + Migration | 30 min |
| **Fase 2** | Modificação dos Services | 3-4 horas |
| **Fase 3** | Migration de Dados | 1-2 horas |
| **Fase 4** | Atualização de DTOs e Referencias | 2-3 horas |
| **Fase 5** | Testes e Validação | 1-2 horas |
| **Total** | | **7.5-11.5 horas** |

## Riscos e Mitigações

### Riscos Identificados
1. **Breaking Changes**: Mudança de "reference" para "name" afeta frontend
2. **Migration de Dados**: Risco de inconsistência nos dados existentes
3. **Performance**: Queries adicionais na tabela de templates

### Mitigações
1. **Versionamento da API**: Manter compatibilidade temporária com "reference"
2. **Scripts de Validação**: Verificar integridade após migration
3. **Índices Otimizados**: Criar índices adequados na tabela de templates

## Entregáveis

### Banco de Dados  
- [ ] Schema Prisma atualizado com SalaryTemplate e SalaryControl modificado
- [ ] Migration gerada automaticamente via `npx prisma migrate dev`
- [ ] Prisma Client regenerado com novos types
- [ ] Script de migração de dados existentes para templates

### Código
- [ ] SalaryTemplatesService implementado
- [ ] SalariesService.create() modificado para usar templates
- [ ] EmployeeService.create() modificado para herdar de templates
- [ ] Todas referências "reference" alteradas para "name"
- [ ] Campo "date" removido de DTOs e services
- [ ] Ordenação ajustada para usar createdAt

### Validação Completa
- [ ] Template "Salário" existe por padrão
- [ ] Criar template "Vale transporte" → aplicado a todos employees existentes
- [ ] Editar "Vale transporte" do Admin para "Vale alimentação" → só Admin alterado
- [ ] Criar employee João → herda "Salário" + "Vale transporte" (templates originais)
- [ ] Criar template "Plano de saúde" → aplicado a Admin e João
- [ ] Verificar listagem: cada employee com valores personalizados

## Validação de Sucesso

### Critérios de Aceitação
✅ Novos employees herdam automaticamente todos os templates da empresa  
✅ Templates e instâncias são separados corretamente  
✅ Edição individual não afeta templates nem outros employees  
✅ Novos templates são aplicados a todos employees existentes  
✅ Funcionalidades existentes continuam funcionando  
✅ Mudança de "reference" para "name" não quebra sistema

### Cenário de Teste Completo com Templates
1. **Estado inicial**: Template "Salário" existe por padrão
2. **Admin criado**: Herda template "Salário" 
3. **Criar template "Vale transporte"**: Aplica ao Admin automaticamente
4. **Editar "Vale transporte" do Admin para "Vale alimentação"**: 
   - Admin agora tem "Salário" + "Vale alimentação"
   - Template "Vale transporte" permanece inalterado
5. **Criar employee João**: 
   - Herda dos templates: "Salário" + "Vale transporte" (original)
   - **NÃO** herda "Vale alimentação" (personalização do Admin)
6. **Criar template "Plano de saúde"**:
   - Aplica ao Admin: "Salário" + "Vale alimentação" + "Plano de saúde"
   - Aplica ao João: "Salário" + "Vale transporte" + "Plano de saúde"
7. **Criar employee Maria**:
   - Herda dos templates: "Salário" + "Vale transporte" + "Plano de saúde"
   - Valores iniciais: amount=0, isSet=false

### Estado Final Esperado
- **Templates da empresa**: `["Salário", "Vale transporte", "Plano de saúde"]`
- **Admin (personalizado)**: `["Salário", "Vale alimentação", "Plano de saúde"]`
- **João**: `["Salário", "Vale transporte", "Plano de saúde"]`
- **Maria**: `["Salário", "Vale transporte", "Plano de saúde"]`

### Implementação com Arquitetura de Templates
A solução requer **nova tabela SalaryTemplate** para separar templates da empresa de salary controls individuais, garantindo herança correta e personalização independente.