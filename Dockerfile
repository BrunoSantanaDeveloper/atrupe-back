# ###################
# # BUILD FOR LOCAL DEVELOPMENT - TRIBO
# ###################

# FROM node:18

# # Criar diretório do app
# WORKDIR /usr/src/app

# # Copiar os manifests de dependências
# COPY --chown=node:node package*.json ./

# # Instalar dependências
# RUN npm ci && npm cache clean --force

# # Copiar o código-fonte
# COPY --chown=node:node . .

# # Gerar o cliente Prisma
# RUN npx prisma generate

# # Expor a porta usada pelo app
# EXPOSE 5000

# # Comando padrão (mude se necessário para seu fluxo)
# CMD ["npm", "run", "start:dev"]


# ###################
# # BUILD FOR LOCAL DEVELOPMENT - ORIGNAL
# ###################

# FROM node:18 AS development

# # Create app directory
# WORKDIR /usr/src/app

# # Copy application dependency manifests to the container image.
# # A wildcard is used to ensure copying both package.json AND package-lock.json (when available).
# # Copying this first prevents re-running npm install on every code change.
# COPY --chown=node:node package*.json ./

# # Install app dependencies using the `npm ci` command instead of `npm install`
# RUN npm ci && npm cache clean --force

# # Bundle app source
# COPY --chown=node:node . .

# # Generate Prisma client
# RUN npx prisma generate

# # Use the node user from the image (instead of the root user)
# USER node

# ###################
# # BUILD FOR PRODUCTION
# ###################

# Etapa 1: Build
FROM node:18 AS builder

# Diretório de trabalho
WORKDIR /usr/src/app

# Copiar apenas os arquivos necessários para instalar as dependências
COPY package*.json ./

# Instalar as dependências
RUN npm ci

# Copiar o restante do código-fonte
COPY . .

# Gerar o cliente Prisma
RUN npx prisma generate

# Construir o projeto
RUN npm run build

# Etapa 2: Final
FROM node:18

# Diretório de trabalho
WORKDIR /usr/src/app

# Copiar dependências de produção da etapa de build
COPY --from=builder /usr/src/app/node_modules ./node_modules

# Copiar o build e arquivos necessários
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/prisma ./prisma
COPY --from=builder /usr/src/app/package*.json ./
COPY .env .env


# Expor a porta usada pelo app
EXPOSE 5000

# Comando padrão usando script do npm
CMD ["npm", "run", "start:prod"]