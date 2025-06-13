# Projeto Atrupe API

Este é um projeto NestJS que fornece uma API para o sistema Atrupe. O projeto está configurado para ser executado com Docker e inclui documentação (Swagger).

## Dependências

Certifique-se de ter as seguintes dependências instaladas em seu sistema:

- Node.js (versão 14 ou superior)
- npm (versão 6 ou superior)
- Docker
- Docker Compose

## Configuração

1. Clone o repositório:

   ```bash
   git clone git@github.com:Atrupe/backend.git
   cd backend
   ```

2. Instale as dependências do projeto:

   ```bash
   npm install
   ```

3. Configure as variáveis de ambiente:

   Crie um arquivo `.env` na raiz do projeto e defina as variáveis de ambiente necessárias. Um exemplo de arquivo `.env` pode ser encontrado em `.env.example`.

## Inicialização usando Docker

1. Certifique-se de que o Docker e o Docker Compose estão instalados e em execução.

2. Construa e inicie os contêineres Docker (certifique-se que as variáveis de ambiente estão exportadas em seu bash):

   ```bash
   docker compose -f docker-compose.yml up -d --build --remove-orphans
   ```

3. A API estará disponível em `http://localhost:5000` ou na porta configurada no `.env`.

## Documentação

A documentação da API é gerada automaticamente usando Swagger. Depois de iniciar a aplicação, você pode acessar a documentação em:

```
http://localhost:{SUA PORTA}/doc
```

## Formas de Deploy

### Deploy no AWS (Amazon Web Services)

_TEMPORÁRIO, deve ser implantado uma forma sustentável e automatizada_

1. Acesse a instância EC2 via SSH usando a chave privada associada à instância:

```bash
ssh -i /path/to/private-key.pem ubuntu@18.214.154.178
```

2. Navegue até o diretório do projeto e atualize o código:

   ```bash
   cd atrupe-api/
   git pull origin main
   ```

3. Se necessário, instale as dependências do projeto:

   ```bash
   npm install
   ```

4. Faça deploy do código para o AWS:

   ```bash
   sudo docker stop atrupe_api_dev
   sudo docker rm atrupe_api_dev
   sudo docker compose -f docker-compose.yml up -d --build --remove-orphans
   ```

## Migrações do banco de dados

O projeto utiliza o PrismaORM e toda sua estrutura é escrita no schema
localizado em `prisma/schema.prisma`. Após qualquer alteração, é necessário
realizar as migrações do banco de dados através dos comandos:

```bash
npx prisma generate
DATABASE_URL=$(DATABASE_URL_EXTERNAL) npx prisma migrate dev --name init
```

## Informações úteis

Caso seu sistema operacional seja baseado em Unix, sugiro utilizar o comando make,
pois ele facilita a execução de comandos que são executados com frequência.

Exemplos:

```bash
make help // Exibe todos os comandos disponíveis
make setup // usado para instalar as dependências do projeto
make run // usado para iniciar o projeto
make logs // usado para visualizar os logs do projeto
make migrate // usado para fazer as migrações do banco de dados
make stop // usado para parar o projeto
```

## CUIDADOS !!!!

Não deixar IA manipular o banco de dados!!!

## Passos para manipular o banco de dados

- Peça para a IA criar as tabalas num PDF ou criar um schema prisma fora do código

```bash
model Subscription {
 id                  String    @id @default(uuid())
 createdAt           DateTime  @default(now())
 updatedAt           DateTime? @updatedAt
 customerId          String    @map("customer_id")
 customer            Customer  @relation(fields: [customerId], references: [id])
 planId              String    @map("plan_id")plan Plan @relation(fields: [planId], references: [id])
 asaasSubscriptionId String    @unique
 additionalAccesses  Int       @default(0)
 status              String // ACTIVE, PENDING, CANCELED,
 nextDueDate         DateTime
 value               Decimal

 @@map("subscriptions")
}
```

- Depois,colocar no schema e organizar principalemnte as relações
- Sempre que fizer um novo migrate, fazer Commit no git
- migrate use o comando `npx prisma migrate dev`
- Manter sempre o projeto atualizado na máquina, para evitar conflitos de migrates

# Como atualizar o homolog

1. Verificar se ta ok os migrates
2. Commit
3. acessar a VPS via SSH entrar na pasta do projeto e usar `git pull`
4. Após pullado executar o comando `docker build -t atrupe:latest .`
5. Quando finalizar pode fechar a conexão SSH
6. Abrir o portainer ir em stacks
7. Tenha em mãos o compose (entre no service atual e copie ou salve na sua máquina)
8. Apagar o service atual `atrupe-api`
9. Subir a nova stack com o mesmo nome `atrupe-api`
