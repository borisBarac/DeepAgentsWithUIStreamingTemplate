import { fileURLToPath } from "node:url";
import {
  type ClientConfig,
  MultiServerMCPClient,
  type StdioConnection,
} from "@langchain/mcp-adapters";

export const LINKLOOM_MCP_SERVER_NAME = "linkloom";
export const LINKLOOM_MCP_TOOL_NAMES = [
  "scrape",
  "html_to_markdown",
  "pdf_to_markdown",
  "render_page",
  "extract_links",
  "extract_tables",
] as const;

export type LinkloomMcpOptions = Pick<
  StdioConnection,
  "args" | "command" | "cwd" | "defaultToolTimeout" | "env" | "restart" | "stderr"
> & {
  camoufoxInstallDir?: string;
};

export type LinkloomResearchConnection = {
  client: MultiServerMCPClient;
  tools: Awaited<ReturnType<MultiServerMCPClient["getTools"]>>;
  close: () => Promise<void>;
};

function resolveLinkloomMcpEntry(): string {
  const packageEntry = import.meta.resolve("@boris.barac/linkloom");
  return fileURLToPath(new URL("./src/mcp.ts", packageEntry));
}

export function createLinkloomMcpClient(
  options: Partial<LinkloomMcpOptions> = {},
): MultiServerMCPClient {
  const camoufoxInstallDir = options.camoufoxInstallDir ?? process.env.CAMOUFOX_INSTALL_DIR;

  const mergedEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") mergedEnv[key] = value;
  }
  if (options.env) Object.assign(mergedEnv, options.env);
  if (camoufoxInstallDir) {
    mergedEnv.CAMOUFOX_INSTALL_DIR = camoufoxInstallDir;
  }

  const connection: StdioConnection = {
    transport: "stdio",
    command: options.command ?? "bun",
    args: options.args ?? [resolveLinkloomMcpEntry()],
    env: mergedEnv,
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.stderr ? { stderr: options.stderr } : {}),
    ...(options.restart ? { restart: options.restart } : {}),
    ...(options.defaultToolTimeout !== undefined
      ? { defaultToolTimeout: options.defaultToolTimeout }
      : {}),
  };
  const config: ClientConfig = {
    throwOnLoadError: true,
    useStandardContentBlocks: true,
    mcpServers: {
      [LINKLOOM_MCP_SERVER_NAME]: connection,
    },
  };

  return new MultiServerMCPClient(config);
}

export async function connectLinkloomResearchTools(
  options: Partial<LinkloomMcpOptions> = {},
): Promise<LinkloomResearchConnection> {
  const client = createLinkloomMcpClient(options);

  try {
    const tools = await client.getTools(LINKLOOM_MCP_SERVER_NAME);

    return {
      client,
      tools,
      close: () => client.close(),
    };
  } catch (error) {
    await client.close();
    throw error;
  }
}
