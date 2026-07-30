# LinkLoom MCP service — dedicated streamable-HTTP MCP server.
#
# Runs @boris.barac/linkloom 0.2.1 over HTTP so agent workers can reach the
# scraping/conversion tools on the internal Compose network without pulling
# Camoufox, Playwright, or better-sqlite3 into the application image. The
# Camoufox browser engine is fetched at build time, so the running container
# can serve render_page / scrape requests immediately.
#
# Endpoints (bound to 0.0.0.0:3000):
#   POST /mcp     — streamable-HTTP MCP transport (tool calls)
#   GET  /health  — liveness probe used by Compose healthcheck
#
# Build context is this directory (docker/linkloom); it is self-contained and
# does not import anything from the monorepo.

FROM oven/bun:1.3.14 AS base
WORKDIR /app

# better-sqlite3 (a transitive dependency of camoufox-js) has no Bun prebuild
# and falls back to node-gyp, so the image needs a C/C++/python3 toolchain to
# compile it during install.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Install the exact LinkLoom dependency graph captured in bun.lock.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Fetch the Camoufox browser engine + GeoIP database during the build so the
# runtime image is ready to serve browser-backed tools.
RUN bunx --no-install camoufox-js fetch

ENV NODE_ENV=production
EXPOSE 3000

# Bun ships a global fetch(), so the healthcheck needs no extra binary (curl).
HEALTHCHECK --interval=10s --timeout=5s --retries=6 --start-period=30s \
  CMD ["bun", "-e", "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# Streamable HTTP MCP server. The endpoint clients POST to is /mcp.
CMD ["bun", "run", "node_modules/@boris.barac/linkloom/dist/cli.js", "mcp", "--transport", "http", "--host", "0.0.0.0", "--port", "3000"]
