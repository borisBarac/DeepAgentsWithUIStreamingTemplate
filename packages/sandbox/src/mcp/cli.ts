#!/usr/bin/env bun
import { createSandboxMcpServer } from "./server.ts";
import { startSandboxHttpServer, startSandboxStdioServer } from "./transports.ts";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const transport = argument("--transport") ?? "http";
if (transport !== "http" && transport !== "stdio") {
  throw new Error("--transport must be http or stdio");
}

const server = createSandboxMcpServer();
if (transport === "stdio") {
  await startSandboxStdioServer(server);
} else {
  const port = Number.parseInt(argument("--port") ?? "3010", 10);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("--port must be a valid TCP port");
  }
  await startSandboxHttpServer(server, { host: argument("--host") ?? "0.0.0.0", port });
}
