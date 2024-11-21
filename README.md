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

*TEMPORÁRIO, deve ser implantado uma forma sustentável e automatizada*

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
