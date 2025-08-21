#!/bin/sh

# Função para logs com cores
log() {
    echo "🔵 $1"
}

error() {
    echo "🔴 ERRO: $1"
    exit 1
}

success() {
    echo "✅ $1"
}

log "Iniciando aplicação..."

# Verificar se DATABASE_URL existe
if [ -z "$DATABASE_URL" ]; then
    error "DATABASE_URL não está definida no ambiente"
fi

log "Executando migrations do banco..."
if ! npx prisma migrate deploy; then
    error "Falha ao executar migrations. Verifique conexão com banco e migrations."
fi
success "Migrations executadas com sucesso"

log "Gerando Prisma Client..."
if ! npx prisma generate; then
    error "Falha ao gerar Prisma Client. Verifique o schema.prisma."
fi
success "Prisma Client gerado com sucesso"

log "Executando seed do banco..."
if ! npm run seed; then
    error "Falha ao executar seed. Verifique os dados padrão."
fi
success "Seed executado com sucesso"

log "Iniciando servidor..."
exec npm run start:prod