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

const repoRoot = findRepoRoot(process.cwd());
const packageRoot = join(repoRoot, "packages/image-gen");
const packageEnvPath = join(packageRoot, ".env");
const envPath = join(repoRoot, ".env");

const replToken =
  process.env.REPLICATE_API_TOKEN?.trim() ??
  readEnvValue(packageEnvPath, "REPLICATE-KEY") ??
  readEnvValue(envPath, "REPLICATE_API_TOKEN");

if (replToken !== undefined && replToken !== "") {
  process.env.REPLICATE_API_TOKEN = replToken;
}

export const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN?.trim();

export const hasLiveImageCredentials =
  process.env.RUN_LIVE_E2E === "1" &&
  typeof REPLICATE_API_TOKEN === "string" &&
  REPLICATE_API_TOKEN !== "";

export const isExpensiveLiveImageE2EEnabled =
  hasLiveImageCredentials && process.env.RUN_EXPENSIVE_E2E === "1";

export const LIVE_IMAGE_WIDTH = 300;
export const LIVE_IMAGE_HEIGHT = 300;

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

function readEnvValue(path: string, expectedKey: string): string | undefined {
  if (!existsSync(path)) {
    return undefined;
  }

  const contents = readFileSync(path, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    if (key !== expectedKey) {
      continue;
    }

    let value = trimmed.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    return value;
  }

  return undefined;
}
