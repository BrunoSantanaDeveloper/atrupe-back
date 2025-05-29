# 🚀 Atrupe API - Desenvolvimento Local

Este guia explica como rodar a API Atrupe localmente usando Docker Desktop.

## 📋 Pré-requisitos

- Docker Desktop instalado
- Node.js 18+ (opcional, para rodar fora do Docker)
- npm ou yarn

## 🛠️ Setup Rápido

### Opção 1: Script Automático (Recomendado)
```bash
# Executar script de setup
./scripts/setup-local.sh
```

### Opção 2: Setup Manual

1. **Instalar dependências:**
```bash
npm install
```

2. **Subir banco e serviços:**
```bash
docker-compose -f docker-compose.dev.yml up -d postgres minio
```

3. **Configurar banco de dados:**
```bash
npx prisma migrate dev --name init
npx prisma generate
```

4. **Iniciar aplicação:**
```bash
npm run start:dev
```

## 🐳 Usando Docker Completo

Para rodar tudo no Docker (incluindo a API):

```bash
# Buildar e subir todos os containers
docker-compose -f docker-compose.dev.yml up --build

# Para rodar em background
docker-compose -f docker-compose.dev.yml up -d --build

# Ver logs
docker-compose -f docker-compose.dev.yml logs -f

# Parar containers
docker-compose -f docker-compose.dev.yml down
```

## 🔧 Configuração

### Variáveis de Ambiente

O arquivo `.env` será criado automaticamente com configurações para desenvolvimento local:

- **PostgreSQL:** `localhost:5432` (user: `atrupedev`, password: `dev123`)
- **MinIO:** `localhost:9000` (admin: `minioadmin/minioadmin123`)
- **API:** `localhost:5000`

### Banco de Dados

- **Host:** localhost:5432
- **Database:** atrupeDevDb
- **User:** atrupedev
- **Password:** dev123

### MinIO (Storage)

- **Console:** http://localhost:9001
- **API:** http://localhost:9000
- **Credentials:** minioadmin / minioadmin123

## 📡 Endpoints da API

Após iniciar, a API estará disponível em:
- **Base URL:** http://localhost:5000
- **Swagger:** http://localhost:5000/api (se configurado)
- **Health Check:** http://localhost:5000/health (se disponível)

## 🧪 Testando a Rota de Subscription

Para testar a rota que foi corrigida:

```bash
curl -X POST http://localhost:5000/plan/subscription/start/8b834105-6e99-41e3-8aef-3ee59b4ad4a8 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "planId": "start",
    "companyId": "8b834105-6e99-41e3-8aef-3ee59b4ad4a8",
    "extraUsers": 0,
    "planPrice": 115,
    "totalAmount": 115,
    "billingType": "CREDIT_CARD",
    "isContractAccepted": true,
    "cycle": "MONTHLY",
    "name": "Cliente Teste",
    "email": "cliente@teste.com",
    "phone": "(62) 99999-0999",
    "mobilePhone": "629999999",
    "address": "sdfasf",
    "addressNumber": "5151",
    "province": "AC",
    "postalCode": "74474021",
    "complement": "",
    "city": "Assis Brasil",
    "neighborhood": "asdfs",
    "cpf": "012.345.678-90",
    "cnpj": "36.455.529/0001-47",
    "companyName": "Empresa"
  }'
```

## 🔄 Comandos Úteis

```bash
# Ver logs da API
docker-compose -f docker-compose.dev.yml logs -f api

# Reiniciar apenas a API
docker-compose -f docker-compose.dev.yml restart api

# Acessar container da API
docker-compose -f docker-compose.dev.yml exec api sh

# Rodar migrações
npx prisma migrate dev

# Resetar banco de dados
npx prisma migrate reset

# Ver banco no Prisma Studio
npx prisma studio
```

## 🐛 Troubleshooting

### Porta 5432 já em uso
Se já tiver PostgreSQL rodando localmente:
```bash
# Parar PostgreSQL local
sudo service postgresql stop

# Ou alterar porta no docker-compose.dev.yml
```

### Problemas de permissão Docker
```bash
# Linux: adicionar usuário ao grupo docker
sudo usermod -aG docker $USER
# Depois fazer logout/login
```

### Limpar containers e volumes
```bash
docker-compose -f docker-compose.dev.yml down -v
docker system prune -a
```

## 📚 Estrutura do Projeto

```
.
├── src/                   # Código fonte da API
├── prisma/               # Schema e migrações do banco
├── docker-compose.dev.yml # Docker para desenvolvimento
├── Dockerfile.dev        # Dockerfile para desenvolvimento
├── scripts/              # Scripts utilitários
└── README.dev.md         # Este arquivo
``` 