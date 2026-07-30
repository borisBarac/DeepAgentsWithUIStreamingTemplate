import { DEFAULT_MEMORY_ROOT } from "../scaffold/constants.ts";

export type MemoryPolicy = {
  writableRoot: string;
};

export function createMemoryPolicy(options: { writableRoot?: string } = {}): MemoryPolicy {
  return {
    writableRoot: options.writableRoot ?? DEFAULT_MEMORY_ROOT,
  };
}

export type MemoryContentCategory = "secrets" | "inferred-preferences" | "transient-details";

export type MemoryContentReview = {
  allowed: boolean;
  reasons: MemoryContentCategory[];
};

const SECRET_PATTERNS: readonly RegExp[] = [
  /(?:api[_-]?key|secret|password|passwd|token|access[_-]?key|client[_-]?secret)\s*[=:]\s*\S+/i,
  /\bsk-[A-Za-z0-9]{16,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----/,
];

const INFERENCE_PATTERNS: readonly RegExp[] = [
  /\b(?:probably|likely|presumably)\b.{0,40}\b(?:prefer|like|want|favor)/i,
  /\buser\s+(?:seems to|appears to|might)\b/i,
  /\bi\s+(?:guess|assume|infer|think)\b.{0,40}\b(?:user|you)\s+(?:prefer|like|want)/i,
];

const TRANSIENT_PATTERNS: readonly RegExp[] = [
  /\b(?:for this (?:task|session|run|conversation)|just for now|temporarily|only today|only for this session)\b/i,
];

function matchesAny(content: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(content));
}

export function reviewMemoryContent(content: string): MemoryContentReview {
  const reasons: MemoryContentCategory[] = [];

  if (matchesAny(content, SECRET_PATTERNS)) {
    reasons.push("secrets");
  }
  if (matchesAny(content, INFERENCE_PATTERNS)) {
    reasons.push("inferred-preferences");
  }
  if (matchesAny(content, TRANSIENT_PATTERNS)) {
    reasons.push("transient-details");
  }

  return { allowed: reasons.length === 0, reasons };
}
