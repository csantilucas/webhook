# Estágio 1: Build da aplicação TypeScript
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src/ ./src/
RUN npm run build

# Estágio 2: Imagem final enxuta para produção
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4100

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# Expõe a porta configurada
EXPOSE 4100

# Executa o servidor compilado
CMD ["node", "dist/server.js"]
