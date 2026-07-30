FROM oven/bun:1.3 AS deps
WORKDIR /app

COPY package.json bun.lock biome.json tsconfig.json ./
COPY patches ./patches
COPY packages/core/package.json ./packages/core/
COPY packages/image-gen/package.json ./packages/image-gen/
COPY packages/sandbox/package.json ./packages/sandbox/
COPY packages/web-app/package.json ./packages/web-app/

RUN bun install --frozen-lockfile

FROM deps AS build
WORKDIR /app

COPY packages ./packages
COPY .env.example ./.env.example

ENV NODE_ENV=production
RUN bun run --filter @deep-agent-template/web-app build

FROM oven/bun:1.3 AS runtime
WORKDIR /app

COPY --from=deps /app/package.json /app/bun.lock /app/biome.json /app/tsconfig.json ./
COPY --from=deps /app/patches ./patches
COPY --from=deps /app/packages ./packages
COPY --from=build /app/packages/web-app/.next ./packages/web-app/.next
COPY .env.example ./.env.example

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "run", "--filter", "@deep-agent-template/web-app", "start"]
