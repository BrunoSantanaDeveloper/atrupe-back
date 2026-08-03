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

# Duas etapas SEPARADAS de propósito.
#
# Antes, um único `until npx prisma migrate deploy` tratava "banco ainda
# subindo" e "migration com erro de SQL" como a mesma falha. Só o primeiro caso
# justifica retry: uma migration inválida falha igual nas 10 tentativas, atrasa
# o crash em ~50s e ainda esconde a causa no meio de avisos repetidos de
# "banco não disponível".

# 1) Conectividade — falha transitória, retry faz sentido.
log "Aguardando banco de dados ficar disponível..."
MAX_RETRIES=10
RETRY_COUNT=0
RETRY_DELAY=5

until echo 'SELECT 1;' | npx prisma db execute --url "$DATABASE_URL" --stdin >/dev/null 2>&1; do
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ "$RETRY_COUNT" -ge "$MAX_RETRIES" ]; then
        error "Banco não aceitou conexão após $MAX_RETRIES tentativas. Verifique DATABASE_URL e o container do postgres."
    fi
    warn "Banco ainda não disponível. Tentativa $RETRY_COUNT/$MAX_RETRIES. Aguardando ${RETRY_DELAY}s..."
    sleep "$RETRY_DELAY"
done
success "Banco de dados disponível"

# 2) Migrations — erro aqui é determinístico; falha na hora, com o erro visível.
log "Aplicando migrations..."
if ! npx prisma migrate deploy; then
    error "Falha ao aplicar migrations (veja o erro do Prisma acima). Retry não resolve: corrija a migration ou use 'prisma migrate resolve' se alguma ficou marcada como FAILED."
fi
success "Migrations executadas com sucesso"

log "Executando seed do banco..."
if ! npm run seed; then
    warn "Seed falhou (pode já ter sido executado ou dados já existirem). Continuando..."
else
    success "Seed executado com sucesso"
fi

log "Iniciando servidor..."
exec npm run start:prod