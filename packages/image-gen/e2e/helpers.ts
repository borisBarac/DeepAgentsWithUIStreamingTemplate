import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  createImageGenerationServiceFromEnv,
  type ImageGenerationServiceContract,
} from "../src/index.ts";

function readPackageJson(path: string): { workspaces?: unknown } | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as { workspaces?: unknown };
}

function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (readPackageJson(join(dir, "package.json"))?.workspaces !== undefined) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not locate monorepo root starting from ${startDir}.`);
    }
    dir = parent;
  }
}

const repoRoot = findRepoRoot(import.meta.dir);
const envPath = join(repoRoot, ".env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

export const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN?.trim();

export const hasLiveImageCredentials =
  process.env.RUN_LIVE_E2E === "1" &&
  typeof REPLICATE_API_TOKEN === "string" &&
  REPLICATE_API_TOKEN !== "";

export function createLiveService(): ImageGenerationServiceContract {
  return createImageGenerationServiceFromEnv({ useFake: false });
}

export async function assertLiveImageUrl(url: string): Promise<void> {
  if (typeof url !== "string" || url.trim() === "") {
    throw new Error(`Expected a non-empty image URL string, got: ${String(url)}`);
  }
  new URL(url);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Fetch of ${url} failed: HTTP ${response.status} ${response.statusText}`);
  }
  const contentType = response.headers.get("content-type");
  if (contentType === null || !/^image\//i.test(contentType)) {
    throw new Error(`Expected image content-type for ${url}, got: ${contentType ?? "<none>"}`);
  }
  const body = await response.arrayBuffer();
  if (body.byteLength === 0) {
    throw new Error(`Image at ${url} returned an empty body.`);
  }
}
