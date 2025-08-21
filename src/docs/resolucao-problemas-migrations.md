# Resolução de Problemas com Migrations

Este documento descreve como resolver problemas comuns com migrations do Prisma, especialmente cenários perigosos que podem causar perda de dados.

## ⚠️ CENÁRIOS PERIGOSOS

### 1. Reset de Migrations em Produção

**NUNCA faça isso sem backup:**
```bash
# ❌ PERIGOSO - NÃO FAÇA
rm -rf prisma/migrations/
npx prisma migrate dev --name "init"
# Deploy para produção = PERDA DE DADOS
```

---

## 🛡️ ABORDAGENS SEGURAS

### Cenário: Quer reiniciar migrations mas preservar dados

#### Opção 1: Baseline (Recomendado)

**1. Identifique a última migration aplicada em produção:**
```bash
# No servidor/container de produção
npx prisma migrate status
```

**2. Marque todas as migrations antigas como aplicadas:**
```bash
# Para cada migration que JÁ está aplicada em produção
npx prisma migrate resolve --applied <migration-name>

# Exemplo:
npx prisma migrate resolve --applied 20250821163134_init
npx prisma migrate resolve --applied 20250822120000_add_users
```

**3. Agora pode limpar migrations locais:**
```bash
# Local - agora é seguro
rm -rf prisma/migrations/

# Criar nova baseline
npx prisma migrate dev --name "baseline"
```

**4. Deploy será seguro:**
```bash
npm run deploy:aws
# Não haverá conflitos pois produção já está "atualizada"
```

#### Opção 2: Schema Introspection

**1. Puxe o schema atual do banco de produção:**
```bash
# Conecte no banco prod e puxe o schema
npx prisma db pull
```

**2. Compare com seu schema.prisma atual:**
```bash
# Verifique diferenças
git diff prisma/schema.prisma
```

**3. Gere migration apenas para as diferenças:**
```bash
npx prisma migrate dev --name "sync-with-production"
```

#### Opção 3: Backup + Reset (Última Opção)

**⚠️ Use apenas se as outras opções não funcionarem**

**1. BACKUP OBRIGATÓRIO:**
```bash
# PostgreSQL
pg_dump -h host -U user -d database > backup_$(date +%Y%m%d_%H%M%S).sql

# Ou via Docker
docker exec postgres-container pg_dump -U user database > backup.sql
```

**2. Reset apenas após confirmar backup:**
```bash
# Verificar se backup foi criado
ls -la backup_*.sql

# Reset do banco (PERIGOSO)
npx prisma migrate reset --force
```

**3. Restaurar dados se necessário:**
```bash
# Se algo der errado, restaurar
psql -h host -U user -d database < backup_YYYYMMDD_HHMMSS.sql
```

---

## 🔍 DIAGNÓSTICO DE PROBLEMAS

### Verificar Status das Migrations

```bash
# Ver quais migrations foram aplicadas
npx prisma migrate status

# Ver diferenças entre schema e banco
npx prisma migrate diff

# Puxar schema atual do banco
npx prisma db pull
```

### Mensagens de Erro Comuns

#### "Database schema is not in sync with migration history"
```
Error: P3005
The database schema is not empty and prisma migrate deploy cannot run.
```
**Solução:** Use Baseline (Opção 1 acima)

#### "Migration failed to apply"
```
Migration `20250821_example` failed to apply cleanly
```
**Possíveis causas:**
- Migration SQL inválida
- Dados incompatíveis
- Constraints violadas

**Soluções:**
1. Corrigir a migration manualmente
2. Usar `prisma migrate resolve --rolled-back <migration>`
3. Aplicar manualmente e marcar como resolvida

#### "Cannot find migration file"
```
Error: Cannot find migration file for migration 20250821_example
```
**Causa:** Migration foi aplicada no banco mas arquivo foi deletado

**Solução:**
```bash
# Marcar como aplicada para sincronizar
npx prisma migrate resolve --applied 20250821_example
```

---

## 🚀 PROCESS DE RECUPERAÇÃO

### Se Deploy Falhou

**1. Verificar logs do container:**
```bash
# No Portainer, verificar logs da aplicação
# Ou via Docker:
docker logs <container-name>
```

**2. Conectar no container para debug:**
```bash
docker exec -it <container-name> sh

# Dentro do container:
npx prisma migrate status
npx prisma db pull
```

**3. Resolver migrations manualmente:**
```bash
# Se migration está aplicada mas marcada como pendente:
npx prisma migrate resolve --applied <migration-name>

# Se migration falhou mas mudanças foram feitas:
npx prisma migrate resolve --rolled-back <migration-name>
```

### Se Dados Foram Perdidos

**1. Parar aplicação imediatamente**
**2. Restaurar do backup mais recente**
**3. Aplicar migrations corretas**
**4. Testar antes de religar aplicação**

---

## ✅ BOAS PRÁTICAS

### Antes de Mudanças Grandes

1. **Sempre fazer backup:**
   ```bash
   # Automatizar backup antes de deploy
   pg_dump database > backup_before_deploy.sql
   ```

2. **Testar em ambiente similar:**
   - Copiar dados de produção para staging
   - Testar migrations completas
   - Verificar se aplicação funciona

3. **Usar migrations reversíveis:**
   ```sql
   -- ✅ Bom: Adicionar coluna com default
   ALTER TABLE users ADD COLUMN status VARCHAR(50) DEFAULT 'active';
   
   -- ❌ Perigoso: Remover coluna sem backup
   ALTER TABLE users DROP COLUMN old_column;
   ```

### Durante o Deploy

1. **Monitorar logs em tempo real**
2. **Ter plano de rollback pronto**
3. **Validar aplicação após deploy**

### Checklist de Segurança

- [ ] Backup do banco criado
- [ ] Migrations testadas localmente
- [ ] Schema validado
- [ ] Plano de rollback definido
- [ ] Monitoramento ativo durante deploy
- [ ] Validação pós-deploy executada

---

## 🆘 CONTATOS DE EMERGÊNCIA

Em caso de problemas graves em produção:

1. **Parar aplicação** (evitar mais danos)
2. **Avaliar extensão do problema**
3. **Decidir entre correção ou restore**
4. **Executar plano de recuperação**
5. **Documentar o incidente**

**Lembre-se: É melhor ser conservador e fazer backup desnecessário do que perder dados!**

---

## 🔥 RESET INTENCIONAL EM PRODUÇÃO

### Cenário: Quer limpar banco produção propositalmente

**Para quando você REALMENTE quer apagar tudo e recomeçar:**

#### Sequência com Container Separado

**Opção 1 - Reset antes do deploy:**
```bash
# 1. Local: limpar e recriar migrations
rm -rf prisma/migrations/
npx prisma migrate dev --name "init"

# 2. Git: commit + push
git add . && git commit -m "feat: reset migrations" && git push

# 3. Host: atualizar código
git pull

# 4. Container atual: reset do banco
docker exec -it <container-app-atual> npx prisma migrate reset --force

# 5. Host: build nova imagem
npm run deploy:aws

# 6. Portainer: atualizar stack (vai funcionar sem erros)
```

**Opção 2 - Reset após deploy (mais prática):**
```bash
# 1-2. Local + Git (mesmo que acima)

# 3. Host: deploy direto
npm run deploy:aws

# 4. Portainer: atualizar stack (vai falhar no startup)

# 5. Container novo: reset do banco
docker exec -it <container-app-novo> npx prisma migrate reset --force

# 6. Reiniciar container (agora vai funcionar)
```

#### ⚠️ Importante para Reset Intencional

- Container da aplicação precisa ter acesso ao banco
- `prisma migrate reset --force` apaga TODOS os dados
- Seed será executado automaticamente após reset
- Sempre confirme que é o ambiente correto antes do reset

**Comando típico de reset:**
```bash
# Verificar se está no container certo
docker exec -it <container-name> env | grep DATABASE_URL

# Reset forçado (apaga tudo)
docker exec -it <container-name> npx prisma migrate reset --force
```