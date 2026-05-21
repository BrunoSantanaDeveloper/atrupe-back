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

# Compilar o seed
RUN npx tsc prisma/seed.ts --outDir dist/prisma --moduleResolution node --esModuleInterop --allowSyntheticDefaultImports --target es2018 --module commonjs

# Etapa 2: Final
FROM node:18

# Diretório de trabalho
WORKDIR /usr/src/app

# Copiar dependências de produção da etapa de build
COPY --from=builder /usr/src/app/node_modules ./node_modules

# Copiar o build e arquivos necessários
COPY --from=builder /usr/src/app/dist ./dist
# Garantir que templates de e-mail estejam presentes (assets do nest build)
COPY --from=builder /usr/src/app/src/core/mail/templates ./dist/core/mail/templates
COPY --from=builder /usr/src/app/prisma ./prisma
COPY --from=builder /usr/src/app/src/seeds ./src/seeds
COPY --from=builder /usr/src/app/package*.json ./
COPY .env .env
COPY scripts/start.sh ./

# Dar permissão de execução ao script
RUN chmod +x start.sh

# Health check — o Swarm usa isso para saber quando o container está saudável.
# start-period=90s dá tempo para as migrations rodarem antes de monitorar.
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
  CMD wget -qO- http://localhost:5000 > /dev/null || exit 1

# Expor a porta usada pelo app
EXPOSE 5000

# Comando padrão usando script de startup
CMD ["./start.sh"]