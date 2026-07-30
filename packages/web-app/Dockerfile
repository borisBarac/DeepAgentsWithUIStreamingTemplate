FROM oven/bun:1.3 AS base
WORKDIR /app

# Copy workspace manifests first for cached dependency install.
COPY package.json bun.lock biome.json tsconfig.json ./
COPY patches ./patches
COPY packages/core/package.json ./packages/core/
COPY packages/image-gen/package.json ./packages/image-gen/
COPY packages/sandbox/package.json ./packages/sandbox/
COPY packages/web-app/package.json ./packages/web-app/

RUN bun install --frozen-lockfile

# Copy the rest of the source.
COPY packages ./packages
COPY .env.example ./.env.example

ENV NODE_ENV=production
EXPOSE 3000

# Default command is the Next.js production server. The worker service
# overrides `command` to run scripts/worker.ts instead.
CMD ["bun", "--env-file=.env", "run", "--filter", "@deep-agent-template/web-app", "start"]
