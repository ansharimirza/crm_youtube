FROM oven/bun:1.3-slim AS base
WORKDIR /app
# ffmpeg: auto-edit pipeline (video-assembler.ts). yt-dlp: download YouTube source
# videos for the Clipper (standalone binary — no Python runtime needed).
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates \
  python3 python3-opencv \
  && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
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
