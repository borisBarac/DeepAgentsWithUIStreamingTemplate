import type { BaseStore } from "@langchain/langgraph";
import {
  type FileInfo,
  type GlobResult,
  type GrepMatch,
  type GrepResult,
  type LsResult,
  StoreBackend,
} from "deepagents";

import { DEFAULT_MEMORY_ROOT } from "../scaffold/constants.ts";

export interface MemoryStoreBackendOptions {
  store?: BaseStore;
  namespace: string[];
  memoryRoot?: string;
}

export class MemoryStoreBackend extends StoreBackend {
  private readonly memoryRoot: string;

  constructor(options: MemoryStoreBackendOptions) {
    super({ store: options.store, namespace: options.namespace });
    this.memoryRoot = options.memoryRoot ?? DEFAULT_MEMORY_ROOT;
  }

  private toFull(relativePath: string): string {
    const root = this.memoryRoot;
    if (relativePath === "/" || relativePath === "") return `${root}/`;
    if (relativePath === root || relativePath.startsWith(`${root}/`)) return relativePath;
    return `${root}/${relativePath.replace(/^\/+/, "")}`;
  }

  private toRelative(fullPath: string): string {
    const root = this.memoryRoot;
    if (fullPath === root) return "/";
    if (fullPath.startsWith(`${root}/`)) return fullPath.slice(root.length);
    return fullPath;
  }

  override async read(filePath: string, offset?: number, limit?: number) {
    return super.read(this.toFull(filePath), offset, limit);
  }

  override async readRaw(filePath: string) {
    return super.readRaw(this.toFull(filePath));
  }

  override async write(filePath: string, content: string) {
    return super.write(this.toFull(filePath), content);
  }

  override async edit(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll?: boolean,
  ) {
    return super.edit(this.toFull(filePath), oldString, newString, replaceAll);
  }

  override async ls(path: string): Promise<LsResult> {
    const result = await super.ls(this.toFull(path));
    if (!result.files) return result;
    const files: FileInfo[] = result.files.map((file) => ({
      ...file,
      path: this.toRelative(file.path),
    }));
    return { ...result, files };
  }

  override async grep(pattern: string, path?: string, glob?: string | null): Promise<GrepResult> {
    const result = await super.grep(pattern, this.toFull(path ?? "/"), glob);
    if (!result.matches) return result;
    const matches: GrepMatch[] = result.matches.map((match) => ({
      ...match,
      path: this.toRelative(match.path),
    }));
    return { ...result, matches };
  }

  override async glob(pattern: string, path?: string): Promise<GlobResult> {
    const result = await super.glob(pattern, this.toFull(path ?? "/"));
    if (!result.files) return result;
    const files: FileInfo[] = result.files.map((file) => ({
      ...file,
      path: this.toRelative(file.path),
    }));
    return { ...result, files };
  }

  override async uploadFiles(files: Array<[string, Uint8Array]>) {
    return super.uploadFiles(files.map(([path, content]) => [this.toFull(path), content]));
  }

  override async downloadFiles(paths: string[]) {
    return super.downloadFiles(paths.map((path) => this.toFull(path)));
  }
}
