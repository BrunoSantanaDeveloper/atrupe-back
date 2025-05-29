#!/bin/bash

echo "🚀 Configurando ambiente de desenvolvimento local para Atrupe API"

# Criar arquivo .env para desenvolvimento local se não existir
if [ ! -f .env ]; then
    echo "📝 Criando arquivo .env para desenvolvimento local..."
    cat > .env << 'EOF'
# Configuração para desenvolvimento local
APP_ENV=development

# Banco de dados local (PostgreSQL no Docker)
DB_USER=atrupedev
DB_PASSWORD=dev123
DB_PORT=5432
DB_NAME=atrupeDevDb
DB_HOST=localhost

PORT=5000
SECRET=dev-secret-key
JWT_SECRET=dev-jwt-secret-key

# URL do banco local
DATABASE_URL="postgresql://atrupedev:dev123@localhost:5432/atrupeDevDb?schema=public"

# MinIO local (opcional)
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin123
MINIO_USE_SSL=false
MINIO_BUCKET_NAME=atrupe-dev

# Configuração de email para desenvolvimento
MAIL_HOST=smtp.mailtrap.io
MAIL_PORT=2525
MAIL_SECURE=false
MAIL_IGNORE_TLS=false
MAIL_USER=your_mailtrap_user
MAIL_PASSWORD=your_mailtrap_password
MAIL_FROM=dev@atrupe.local

# Frontend URL local
FRONTEND_URL=http://localhost:3000

# Token ASAAS para desenvolvimento/sandbox
ASAAS_TOKEN=your_asaas_sandbox_token_here
EOF
    echo "✅ Arquivo .env criado!"
else
    echo "ℹ️  Arquivo .env já existe, pulando..."
fi

# Instalar dependências
echo "📦 Instalando dependências..."
npm install

# Subir containers Docker
echo "🐳 Subindo containers Docker..."
docker-compose -f docker-compose.dev.yml up -d postgres minio

# Aguardar banco subir
echo "⏳ Aguardando banco de dados estar pronto..."
sleep 10

# Rodar migrações
echo "🗄️  Executando migrações do banco..."
npx prisma migrate dev --name init

# Gerar cliente Prisma
echo "🔧 Gerando cliente Prisma..."
npx prisma generate

echo ""
echo "🎉 Setup concluído!"
echo ""
echo "Para iniciar a aplicação:"
echo "  npm run start:dev"
echo ""
echo "Ou para rodar tudo no Docker:"
echo "  docker-compose -f docker-compose.dev.yml up --build"
echo ""
echo "URLs disponíveis:"
echo "  API: http://localhost:5000"
echo "  MinIO Console: http://localhost:9001 (admin: minioadmin/minioadmin123)"
echo "  PostgreSQL: localhost:5432 (user: atrupedev/dev123)"