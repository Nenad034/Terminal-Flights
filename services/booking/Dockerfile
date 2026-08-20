FROM node:22-alpine AS base
WORKDIR /app
COPY package.json pnpm-workspace.yaml ./
COPY packages/shared-types ./packages/shared-types
COPY services/booking ./services/booking
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
RUN pnpm install --filter @terminal-flights/booking... --frozen-lockfile
RUN pnpm --filter @terminal-flights/booking build

WORKDIR /app/services/booking
EXPOSE 4002
CMD ["node", "dist/index.js"]
