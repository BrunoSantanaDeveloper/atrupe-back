#!/bin/bash

echo "🚀 Iniciando deploy no ambiente DEV..."

# Cores para output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
    echo -e "${BLUE}[DEPLOY DEV]${NC} $1"
}

success() {
    echo -e "${GREEN}✅ $1${NC}"
}

error() {
    echo -e "${RED}❌ $1${NC}"
    exit 1
}

warn() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

# ============================================================
# ETAPA 1: Atualizar código no servidor
# ============================================================
log "Conectando ao servidor para atualizar código..."
ssh atrupe-aws << 'EOF'
    cd atrupe-back || { echo "❌ pasta atrupe-back não encontrada"; exit 1; }
    git checkout dev || { echo "❌ Erro ao checkout dev"; exit 1; }
    git pull || { echo "❌ Erro no git pull"; exit 1; }
    cp .env.dev .env || { echo "❌ .env.dev não encontrado"; exit 1; }
    echo "✅ Código atualizado no servidor!"
EOF

if [ $? -ne 0 ]; then
    error "Falha ao atualizar código no servidor"
fi
success "Código atualizado no servidor"

# ============================================================
# ETAPA 2: Build LOCAL (cross-compile ARM64)
# ============================================================
log "Construindo imagem Docker LOCALMENTE (cross-compile linux/arm64)..."
warn "O build roda na sua máquina. Zero impacto no servidor."

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.." || error "Erro ao navegar para pasta do projeto"

# Copiar .env do servidor se não existir localmente
if [ ! -f .env ]; then
    warn ".env não encontrado localmente. Copiando do servidor..."
    scp atrupe-aws:~/atrupe-back/.env .env || {
        warn "Não foi possível copiar .env. Criando placeholder..."
        echo "DATABASE_URL=placeholder" > .env
    }
    CLEANUP_ENV=true
fi

# Build cross-platform com buildx
docker buildx build \
    --platform linux/arm64 \
    --builder arm-builder \
    --load \
    -t atrupe-image-dev:latest \
    . || {
    [ "$CLEANUP_ENV" = true ] && rm -f .env
    error "Erro ao construir imagem"
}

[ "$CLEANUP_ENV" = true ] && rm -f .env
success "Imagem ARM64 construída localmente!"

# ============================================================
# ETAPA 3: Transferir imagem para o servidor
# ============================================================
log "Transferindo imagem para o servidor AWS..."
warn "Pode levar alguns minutos dependendo da conexão."

docker save atrupe-image-dev:latest | gzip | ssh atrupe-aws "gunzip | docker load" || {
    error "Erro ao transferir imagem"
}

success "Deploy DEV executado com sucesso!"
echo ""
echo "🔗 Próximo passo: Acesse o Portainer e atualize a stack de DEV"
echo "   https://portainer.atrupe.com.br"
