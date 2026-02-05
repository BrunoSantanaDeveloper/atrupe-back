#!/bin/bash

echo "🚀 Iniciando deploy no ambiente DEV..."

# Cores para output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Função para log colorido
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

# Controle de versão
VERSION_FILE="./deploy-v-dev.txt"
if [ ! -f "$VERSION_FILE" ]; then
    echo "0" > "$VERSION_FILE"
fi

CURRENT_VERSION=$(cat "$VERSION_FILE")
NEXT_VERSION=$((CURRENT_VERSION + 1))
echo "$NEXT_VERSION" > "$VERSION_FILE"

log "Versão do Deploy: v$NEXT_VERSION"

# Executar comandos no servidor AWS (ambiente dev)
log "Conectando ao servidor AWS (ambiente dev)..."
ssh atrupe-aws VERSION=$NEXT_VERSION << 'EOF'
    echo "📁 Entrando na pasta do projeto..."
    cd atrupe-back || { echo "❌ Erro: pasta atrupe-back não encontrada"; exit 1; }

    echo "🔀 Mudando para branch dev..."
    git checkout dev || { echo "❌ Erro ao fazer checkout da branch dev"; exit 1; }

    echo "📥 Fazendo git pull..."
    git pull || { echo "❌ Erro no git pull"; exit 1; }

    echo "📋 Copiando arquivo .env de desenvolvimento..."
    cp .env.dev .env || { echo "❌ Erro: arquivo .env.dev não encontrado"; exit 1; }

    echo "🐳 Construindo imagem Docker (v$VERSION)..."
    docker build . -t atrupe-image-dev:latest -t atrupe-image-dev:v$VERSION || { echo "❌ Erro ao construir imagem"; exit 1; }

    echo "✅ Deploy da versão v$VERSION concluído! Agora atualize a stack no Portainer."
EOF

if [ $? -eq 0 ]; then
    success "Deploy DEV executado com sucesso!"
    echo ""
    echo "🔗 Próximo passo: Acesse o Portainer e atualize a stack de DEV"
    echo "   https://portainer.atrupe.com.br"
else
    error "Falha no deploy"
fi
