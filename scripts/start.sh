#!/bin/sh

# Função para logs com cores
log() {
    echo "🔵 $1"
}

error() {
    echo "🔴 ERRO: $1"
    exit 1
}

warn() {
    echo "⚠️  AVISO: $1"
}

success() {
    echo "✅ $1"
}

log "Iniciando aplicação..."

# Verificar se DATABASE_URL existe
if [ -z "$DATABASE_URL" ]; then
    error "DATABASE_URL não está definida no ambiente"
fi

# Aguardar banco de dados ficar pronto antes de rodar migrations.
# Evita crash loop quando o container do postgres ainda está subindo.
log "Aguardando banco de dados ficar disponível..."
MAX_RETRIES=10
RETRY_COUNT=0
RETRY_DELAY=5

until npx prisma migrate deploy; do
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ "$RETRY_COUNT" -ge "$MAX_RETRIES" ]; then
        error "Banco de dados não ficou disponível após $MAX_RETRIES tentativas. Verifique conexão e migrations."
    fi
    warn "Banco não disponível ou migrations falharam. Tentativa $RETRY_COUNT/$MAX_RETRIES. Aguardando ${RETRY_DELAY}s..."
    sleep "$RETRY_DELAY"
done
success "Migrations executadas com sucesso"

log "Executando seed do banco..."
if ! npm run seed; then
    warn "Seed falhou (pode já ter sido executado ou dados já existirem). Continuando..."
else
    success "Seed executado com sucesso"
fi

log "Iniciando servidor..."
exec npm run start:prod