#!/bin/bash

echo "🚀 Iniciando deploy no AWS..."

# Cores para output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Função para log colorido
log() {
    echo -e "${BLUE}[DEPLOY]${NC} $1"
}

success() {
    echo -e "${GREEN}✅ $1${NC}"
}

error() {
    echo -e "${RED}❌ $1${NC}"
    exit 1
}

# Executar comandos no servidor AWS
log "Conectando ao servidor AWS..."
ssh atrupe-aws << 'EOF'
    echo "📁 Entrando na pasta do projeto..."
    cd atrupe-back || { echo "❌ Erro: pasta atrupe-back não encontrada"; exit 1; }

    echo "🔀 Mudando para branch main..."
    git checkout main || { echo "❌ Erro ao fazer checkout da branch main"; exit 1; }

    echo "📥 Fazendo git pull..."
    git pull || { echo "❌ Erro no git pull"; exit 1; }

    echo "📋 Copiando arquivo .env de produção..."
    cp .env.prod .env || { echo "❌ Erro: arquivo .env.prod não encontrado"; exit 1; }

    echo "🐳 Construindo imagem Docker..."
    docker build --cpu-quota=50000 --memory=512m . -t atrupe-image:latest || { echo "❌ Erro ao construir imagem"; exit 1; }
    
    echo "✅ Deploy concluído! Agora atualize a stack no Portainer."
EOF

if [ $? -eq 0 ]; then
    success "Deploy executado com sucesso!"
    echo ""
    echo "🔗 Próximo passo: Acesse o Portainer e atualize a stack"
    echo "   https://portainer.atrupe.com.br"
else
    error "Falha no deploy"
fi