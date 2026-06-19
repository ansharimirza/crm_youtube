FROM oven/bun:1.3-slim AS base
WORKDIR /app
# ffmpeg: needed by the auto-edit pipeline (video-assembler.ts)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

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
