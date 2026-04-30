FROM oven/bun:1.3-slim AS base
WORKDIR /app

FROM base AS deps
COPY package.json ./
RUN bun install

FROM base AS dev
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["bun", "run", "--hot", "src/index.ts"]

FROM base AS prod
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]
