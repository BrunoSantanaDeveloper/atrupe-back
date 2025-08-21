# Processo de Migrations no Prisma

Este documento descreve o processo completo para gerenciar migrations no projeto, desde alterações locais até deploy em produção.

## Fluxo Geral

1. **Desenvolvimento Local** → 2. **Commit/Push** → 3. **Deploy Produção**

---

## 1. Alterações Locais (Desenvolvimento)

### Quando alterar o schema.prisma

Sempre que você modificar o arquivo `prisma/schema.prisma`:

```bash
# Gerar nova migration e aplicar localmente
npx prisma migrate dev --name <nome-da-migration>
```

**O que esse comando faz:**

- Detecta mudanças no schema
- Cria uma nova migration em `prisma/migrations/`
- Aplica a migration no banco local
- Gera automaticamente o Prisma Client (como o "npx prisma generate" em prod)
- Executa o seed (se configurado)

### Exemplo de uso:

```bash
npx prisma migrate dev --name "add-user-avatar-field"
npx prisma migrate dev --name "create-notifications-table"
npx prisma migrate dev --name "update-payment-status-enum"
```

### Reset completo do banco (quando necessário)

```bash
# Apagar todas as migrations
rm -rf prisma/migrations/

# Criar migration inicial
npx prisma migrate dev --name "init"
```

---

## 2. Versionamento

Após criar/aplicar a migration localmente:

```bash
# Adicionar arquivos ao git
git add .

# Commit das mudanças
git commit -m "feat: add migration for user avatar field"

# Push para o repositório
git push origin main
```

**Arquivos importantes para commitar:**

- `prisma/schema.prisma` (alterações no schema)
- `prisma/migrations/` (novas migrations)

---

## 3. Deploy em Produção

### Com Docker (Portainer) - Método Atual

O projeto está configurado para executar migrations automaticamente no startup do container:

1. **Commit e push das alterações:**
   ```bash
   git add .
   git commit -m "feat: add new migration"
   git push origin main
   ```

2. **No Portainer:**
   - Gerar nova imagem Docker
   - Atualizar a stack na interface do Portainer
   - O container executará automaticamente:
     - `prisma migrate deploy`
     - `prisma generate`
     - Startup da aplicação

### Deploy Automatizado (AWS)

```bash
# Deploy completo: SSH + git pull + docker build
npm run deploy:aws

# Depois atualizar stack no Portainer
```

---

## Diferenças entre Comandos

| Comando          | Ambiente        | Interativo | Gera Client   | Executa Seed  |
| ---------------- | --------------- | ---------- | ------------- | ------------- |
| `migrate dev`    | Desenvolvimento | ✅ Sim     | ✅ Automático | ✅ Automático |
| `migrate deploy` | Produção        | ❌ Não     | ❌ Manual     | ❌ Manual     |

---

## Verificações Importantes

### Antes de fazer deploy:

1. **Testar localmente:**

   ```bash
   # Verificar se a migration funciona
   npm run test
   npm run build
   ```

2. **Verificar estado do banco:**

   ```bash
   npx prisma migrate status
   ```

3. **Backup em produção** (recomendado para mudanças críticas)

### Quando o `prisma generate` é necessário:

- ✅ Após `prisma migrate deploy`
- ✅ Quando o schema.prisma foi alterado
- ✅ Em builds/deploys automatizados
- ❌ Após `prisma migrate dev` (já gera automaticamente)

---

## Resolução de Problemas

### Migration falhou no servidor:

```bash
# Verificar status
npx prisma migrate status

# Resolver manualmente se necessário
npx prisma migrate resolve --applied <migration-name>
```

### Schema fora de sincronia:

```bash
# Verificar diferenças
npx prisma db pull

# Reset completo (⚠️ CUIDADO: apaga dados)
npx prisma migrate reset
```

---

## Scripts Úteis

Adicione no `package.json`:

```json
{
  "scripts": {
    "db:migrate": "prisma migrate dev",
    "db:deploy": "prisma migrate deploy",
    "db:generate": "prisma generate",
    "db:seed": "prisma db seed",
    "db:reset": "prisma migrate reset",
    "db:status": "prisma migrate status"
  }
}
```

---

## Checklist de Deploy

- [ ] Migration criada e testada localmente
- [ ] Código commitado e pushed
- [ ] Backup do banco produção (se necessário)
- [ ] `git pull` no servidor
- [ ] `npm install` (se necessário)
- [ ] `npx prisma migrate deploy`
- [ ] `npx prisma generate`
- [ ] `npx prisma db seed` (se necessário)
- [ ] Reiniciar aplicação
- [ ] Verificar logs e funcionalidade
