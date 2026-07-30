FROM oven/bun:1.3.14

WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY packages/sandbox/package.json packages/sandbox/package.json
RUN bun install --frozen-lockfile --production

COPY packages/sandbox packages/sandbox

ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --retries=6 --start-period=10s \
  CMD ["bun", "-e", "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["bun", "run", "--filter", "@deep-agent-template/sandbox", "mcp", "--transport", "http", "--host", "0.0.0.0", "--port", "3000"]
