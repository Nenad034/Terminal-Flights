FROM node:22-alpine AS base
WORKDIR /app
COPY package.json pnpm-workspace.yaml ./
COPY packages/shared-types ./packages/shared-types
COPY services/supplier-layer ./services/supplier-layer
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
RUN pnpm install --filter @terminal-flights/supplier-layer... --frozen-lockfile
RUN pnpm --filter @terminal-flights/supplier-layer build

WORKDIR /app/services/supplier-layer
EXPOSE 4001
CMD ["node", "dist/index.js"]
