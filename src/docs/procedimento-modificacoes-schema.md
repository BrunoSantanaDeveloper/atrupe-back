# Procedimento para Modificações no Schema

## Processo Normal (Recomendado)

Para a maioria das modificações no schema, siga este processo:

### 1. Desenvolvimento Local

```bash
npx prisma migrate dev --name "descricao-da-mudanca"
```

**Exemplos:**

```bash
npx prisma migrate dev --name "add-user-avatar-field"
npx prisma migrate dev --name "create-notifications-table"
npx prisma migrate dev --name "update-payment-status-enum"
```

### 2. Verificação Antes do Deploy

**⚠️ SEMPRE verificar antes do deploy:**

```bash
# Verificar se migrations foram criadas
git status
# Deve mostrar: new file: prisma/migrations/XXXXX_nome/migration.sql

# Verificar se migration está funcionando
npx prisma migrate status
# Deve mostrar: Database schema is up to date!
```

### 3. Deploy

```bash
npm run deploy:prod
```

### 4. Atualização no Portainer

- Acesse o Portainer
- Vá em **Stacks**
- Encontre sua stack
- Clique em **Update the stack**
- Container reiniciará automaticamente

### 5. Verificação

O `start.sh` executará automaticamente:

- `npx prisma migrate deploy` (aplica novas migrations)
- `npx prisma generate` (atualiza Prisma Client)
- `npm run seed` (dados padrão, se necessário)

## Quando Usar Reset Manual

⚠️ **Use reset apenas quando necessário:**

### Situações que Exigem Reset

1. **Modificações Severas:**

   - Renomeação de tabelas/campos críticos
   - Mudanças em tipos de dados incompatíveis
   - Reestruturação completa do schema

2. **Problemas de Migration:**
   - Migration falhou e deixou banco em estado inconsistente
   - Conflitos de migration irrecuperáveis

### Procedimento para Reset

1. **Deploy primeiro** (para atualizar imagem):

```bash
npm run deploy:prod
```

2. **No Portainer:**

   - Update da stack
   - Acesse console do container

3. **No console do container:**

```bash
npx prisma migrate reset --force
```

## Tipos de Modificação vs Abordagem

| Tipo de Modificação       | Processo | Preserva Dados |
| ------------------------- | -------- | -------------- |
| Adicionar campos          | Normal   | ✅ Sim         |
| Novos relacionamentos     | Normal   | ✅ Sim         |
| Alterações compatíveis    | Normal   | ✅ Sim         |
| Renomear tabelas          | Reset    | ❌ Não         |
| Mudar tipos incompatíveis | Reset    | ❌ Não         |
| Reestruturação severa     | Reset    | ❌ Não         |

## Troubleshooting

### Migration Falhou

```bash
# Ver status das migrations
npx prisma migrate status

# Marcar migration como aplicada (se já foi aplicada manualmente)
npx prisma migrate resolve --applied <migration-name>

# Reset completo (última opção)
npx prisma migrate reset --force
```

### Container Não Inicia

1. **Via Portainer:** Update da stack
2. **Via Console:** `docker logs <container-name>` para ver erro
3. **Se migration falhou:** Acesse console e execute reset

## Boas Práticas

### ✅ Faça Sempre

- Teste localmente antes do deploy
- Use nomes descritivos para migrations
- Commit das migrations junto com código
- Verifique logs após deploy

### ❌ Evite

- Reset desnecessário (perde dados)
- Modificar migrations já aplicadas
- Deploy sem testar localmente
- Ignorar erros de migration

### ⚠️ COMANDOS QUE QUEBRAM O DEPLOY

**❌ 1. `prisma generate` após falha de migration:**

```bash
# ERRADO - mascara o problema
npx prisma generate  # após falha de migrate dev
```

**❌ 2. `prisma db push` em desenvolvimento:**

```bash
# ERRADO - ignora sistema de migrations
npx prisma db push
```

**❌ 3. `prisma db pull` sem cuidado:**

```bash
# PERIGOSO - pode sobrescrever schema local
npx prisma db pull
```

**❌ 4. `prisma migrate deploy` localmente:**

```bash
# ERRADO - comando para produção apenas
npx prisma migrate deploy
```

**❌ 5. Modificar migrations já aplicadas:**

```bash
# NUNCA edite migrations em prisma/migrations/
# que já foram aplicadas em produção
```

**✅ Soluções corretas:**

**Para erro de migration:**

```bash
npx prisma migrate dev --name "sua-mudanca"
# Se falhar:
npx prisma migrate reset  # ⚠️ APENAS LOCAL - apaga dados locais
npx prisma migrate dev --name "sua-mudanca"
```

**⚠️ IMPORTANTE sobre `prisma migrate reset`:**

- **Local:** Apaga APENAS dados do seu banco local
- **Produção:** NÃO afeta produção automaticamente
- **Deploy:** Produção usará `migrate deploy`, que preserva dados

**Fluxo seguro:**

1. `migrate reset` local → seus dados locais são perdidos ✅
2. `migrate dev` local → novas migrations criadas ✅
3. Deploy → produção aplica apenas as novas migrations ✅
4. Dados de produção permanecem seguros ✅

**Para sincronizar com banco externo:**

```bash
# Use apenas se souber o que está fazendo
npx prisma db pull
# Depois SEMPRE:
npx prisma migrate dev --name "sync-with-external-db"
```

**Por que esses comandos quebram:**

- Criam inconsistência entre schema local e migrations
- Produção não consegue reproduzir o estado local
- Migrations ficam fora de sincronia

## Diferença Entre Comandos Local vs Produção

| Comando          | Local              | Produção         | Apaga Dados     |
| ---------------- | ------------------ | ---------------- | --------------- |
| `migrate dev`    | ✅ Desenvolvimento | ❌ Nunca         | ⚠️ Pode apagar  |
| `migrate deploy` | ❌ Nunca           | ✅ Produção      | ❌ Preserva     |
| `migrate reset`  | ✅ Desenvolvimento | ❌ Manual apenas | ✅ Apaga tudo   |
| `db push`        | ❌ Evitar          | ❌ Nunca         | ⚠️ Imprevisível |

**Resumo de segurança:**

- ✅ `migrate reset` local é seguro (não afeta produção)
- ✅ Deploy normal sempre preserva dados de produção
- ❌ Reset em produção deve ser manual e consciente

## ⚠️ ATENÇÃO: Aviso de Perda de Dados no `migrate dev`

**Cenário comum:**

```bash
npx prisma migrate dev --name "minha-mudanca"
# Prisma avisa: "We need to reset the database, this will result in data loss"
# Você aceita: y
```

### 🔴 CUIDADO: Isso PODE afetar produção!

**Por que isso acontece:**

- Você fez uma mudança incompatível (ex: renomear coluna, mudar tipo)
- Prisma detecta que não consegue migrar incrementalmente
- Localmente: apaga seus dados e recria tudo

**O que acontece no deploy:**

```bash
# Em produção, o Prisma executará:
npx prisma migrate deploy

# E aplicará a MESMA migration que apaga dados!
# Resultado: DADOS DE PRODUÇÃO PERDIDOS ❌
```

### ✅ Solução SEGURA:

**Quando Prisma avisar sobre perda de dados:**

1. **PARE** - não aceite imediatamente
2. **Analise** - que tipo de mudança você fez?
3. **Escolha a estratégia:**

**Para mudanças compatíveis:**

```bash
# Cancele e refaça de forma incremental
# Ex: ao invés de renomear, adicione + remova depois
```

**Para mudanças que realmente precisam resetar:**

```bash
# Aceite localmente (seus dados locais são perdidos)
# MAS: faça reset manual em produção quando deployar
```

### 📋 Checklist quando Prisma avisar sobre perda de dados:

- [ ] Posso fazer essa mudança de forma incremental?
- [ ] Os dados de produção podem ser perdidos?
- [ ] Preciso fazer backup dos dados importantes?
- [ ] Vou fazer reset manual em produção?

**Regra de ouro:** Se aceitar perda de dados no `migrate dev`, planeje o reset em produção também.

## 🔄 Estratégia Segura para Renomear Campos

**Problema:** Como renomear um campo sem perder dados?

**❌ Solução perigosa:** Renomear diretamente (Prisma avisa sobre perda de dados)

**✅ Solução segura:** 3 etapas com migrations incrementais

### Etapa 1: Adicionar campo novo

```prisma
model User {
  id       Int    @id @default(autoincrement())
  name     String  // campo antigo
  fullName String? // campo novo
}
```

```bash
npx prisma migrate dev --name "add-fullName-field"
# Deploy + atualizar produção
```

### Etapa 2: Migrar dados (SEM editar migration)

**❌ ERRADO - Editar migration gerada:**

```bash
# Nunca faça isso!
npx prisma migrate dev --create-only --name "copy-data"
# → editar migration.sql (quebra boas práticas)
```

**✅ CORRETO - Script separado:**

```bash
# Opção A: Script TypeScript
# Criar: src/scripts/migrate-name-to-fullname.ts
npx ts-node src/scripts/migrate-name-to-fullname.ts

# Opção B: SQL direto no container (produção)
# No console do container:
# psql $DATABASE_URL -c "UPDATE \"User\" SET \"fullName\" = \"name\" WHERE \"fullName\" IS NULL;"
```

**Script de exemplo:**

```typescript
// src/scripts/migrate-name-to-fullname.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function migrateData() {
  const result = await prisma.user.updateMany({
    where: { fullName: null },
    data: { fullName: { set: prisma.user.fields.name } },
  });
  console.log(`Migrados ${result.count} registros`);
}

migrateData().finally(() => prisma.$disconnect());
```

### Etapa 3: Remover campo antigo

```prisma
model User {
  id       Int    @id @default(autoincrement())
  fullName String // só o novo campo
}
```

```bash
npx prisma migrate dev --name "remove-old-name-field"
# Deploy + atualizar produção
```

### Resultado Final

✅ Dados preservados
✅ Campo renomeado
✅ Zero downtime
✅ Boas práticas mantidas
✅ Migrations não editadas

**Processo:** 3 deploys separados + 1 script de migração de dados entre eles.

## Scripts Úteis

```bash
# Status das migrations
npx prisma migrate status

# Validar schema
npx prisma validate

# Visualizar banco
npx prisma studio

# Reset local (desenvolvimento)
npx prisma migrate reset

# Deploy migrations (produção)
npx prisma migrate deploy
```

## Resumo

**90% dos casos:** `migrate dev` → `deploy:prod` → atualizar stack
**10% dos casos:** Reset manual quando há incompatibilidade

O Prisma é inteligente e cria migrations incrementais na maioria dos casos, preservando dados existentes.
