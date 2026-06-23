import os from "node:os";
import path from "node:path";

export type AppConfigOptions = {
  camoufoxInstallDir?: string;
};

export type AppConfig = {
  camoufoxInstallDir: string;
};

const DEFAULT_CAMOUFOX_INSTALL_DIR = Object.freeze(path.join(os.homedir(), ".cache", "camoufox"));

export function createAppConfig(options: AppConfigOptions = {}): AppConfig {
  const camoufoxInstallDir =
    options.camoufoxInstallDir ?? process.env.CAMOUFOX_INSTALL_DIR ?? DEFAULT_CAMOUFOX_INSTALL_DIR;

  process.env.CAMOUFOX_INSTALL_DIR = camoufoxInstallDir;

  return { camoufoxInstallDir };
}
