import {
  MODEL_CATEGORIES,
  MODEL_ROLES,
  type ModelCategory,
  type ModelRole,
  OPENAI_COMPATIBLE_PROVIDER,
  OPENROUTER_PROVIDER,
} from "./constants.ts";
import type { ModelRuntimeConfig } from "./types.ts";

export function assertValidName(name: string, kind: string): void {
  if (name.trim() === "" || name !== name.trim()) {
    throw new Error(`${kind} names must be non-empty and cannot contain surrounding whitespace.`);
  }
}

export function validateBaseURL(connectionName: string, baseURL: string): void {
  try {
    const url = new URL(baseURL);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    throw new Error(
      `OpenAI-compatible connection "${connectionName}" must provide a valid HTTP(S) baseURL.`,
    );
  }
}

export function validateRuntimeConfig(config: ModelRuntimeConfig): void {
  const connectionNames = Object.keys(config.connections);

  if (connectionNames.length === 0) {
    throw new Error("Model runtime requires at least one named connection.");
  }

  for (const name of connectionNames) {
    assertValidName(name, "Connection");
    const connection = config.connections[name];
    if (!connection) continue;
    const rawProvider = String(connection.provider);
    switch (connection.provider) {
      case OPENAI_COMPATIBLE_PROVIDER:
        validateBaseURL(name, connection.baseURL);
        break;
      case OPENROUTER_PROVIDER:
        break;
      default:
        throw new Error(`Connection "${name}" uses unsupported provider "${rawProvider}".`);
    }
  }

  for (const category of MODEL_CATEGORIES) {
    const profile = config.categories[category];
    if (!profile) {
      throw new Error(`Model runtime must define a "${category}" category.`);
    }
    if (profile.model.trim() === "") {
      throw new Error(`Category "${category}" must provide a non-empty model ID.`);
    }
    if (!config.connections[profile.connection]) {
      throw new Error(
        `Category "${category}" references unknown connection "${profile.connection}".`,
      );
    }
  }

  const extraCategories = Object.keys(config.categories).filter(
    (name): name is ModelCategory => !MODEL_CATEGORIES.includes(name as ModelCategory),
  );
  if (extraCategories.length > 0) {
    throw new Error(
      `Unknown model categories: ${extraCategories.join(", ")}. Allowed: ${MODEL_CATEGORIES.join(", ")}.`,
    );
  }

  for (const [role, category] of Object.entries(config.assignments)) {
    if (role !== "default" && !MODEL_ROLES.includes(role as ModelRole)) {
      throw new Error(`Model assignment uses unknown role "${role}".`);
    }
    if (typeof category !== "string" || !MODEL_CATEGORIES.includes(category as ModelCategory)) {
      throw new Error(
        `Model assignment "${role}" references unknown model category "${String(category)}".`,
      );
    }
  }
}
