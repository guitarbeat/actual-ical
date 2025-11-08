ARG NODE_VERSION=22.14.0

FROM node:${NODE_VERSION}-alpine AS builder
WORKDIR /app

COPY package*.json .
RUN npm ci

COPY . .
RUN npm run build

FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY package*.json .
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist

EXPOSE ${PORT:-3000}

CMD ["node", "dist/bin/server.js"]
