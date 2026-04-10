#!/bin/bash

echo "🚀 Iniciando deploy no AWS (PRODUÇÃO)..."

# Cores para output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
    echo -e "${BLUE}[DEPLOY PROD]${NC} $1"
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
    git checkout main || { echo "❌ Erro ao checkout main"; exit 1; }
    git pull || { echo "❌ Erro no git pull"; exit 1; }
    cp .env.prod .env || { echo "❌ .env.prod não encontrado"; exit 1; }
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

# Backup do .env local (se existir) e copiar .env.prod do servidor
if [ -f .env ]; then
    cp .env .env.local.bak
fi
log "Copiando .env de PROD do servidor..."
scp atrupe-aws:~/atrupe-back/.env .env || error "Não foi possível copiar .env do servidor"

# Build cross-platform com buildx
docker buildx build \
    --platform linux/arm64 \
    --builder arm-builder \
    --load \
    -t atrupe-image:latest \
    . || {
    error "Erro ao construir imagem"
}

# Restaurar .env local original
if [ -f .env.local.bak ]; then
    mv .env.local.bak .env
fi
success "Imagem ARM64 construída localmente!"

# ============================================================
# ETAPA 3: Transferir imagem para o servidor
# ============================================================
log "Transferindo imagem para o servidor AWS..."
warn "Pode levar alguns minutos dependendo da conexão."

docker save atrupe-image:latest | gzip | ssh atrupe-aws "gunzip | docker load" || {
    error "Erro ao transferir imagem"
}

# ============================================================
# ETAPA 4: Limpeza local (liberar espaço em disco)
# ============================================================
log "Limpando imagem e cache de build local..."

docker rmi atrupe-image:latest 2>/dev/null && \
    success "Imagem local removida" || \
    warn "Imagem local não encontrada (já removida?)"

docker buildx prune --builder arm-builder --force 2>/dev/null && \
    success "Cache do builder limpo" || \
    warn "Não foi possível limpar cache do builder"

success "Deploy PROD executado com sucesso!"
echo ""
echo "🔗 Próximo passo: Acesse o Portainer e atualize a stack de PRODUÇÃO"
echo "   https://portainer.atrupe.com.br"