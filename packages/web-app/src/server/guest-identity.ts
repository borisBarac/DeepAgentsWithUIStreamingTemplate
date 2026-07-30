import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import type { ExecutionIdentity } from "./agent-runtime/types.ts";

export const GUEST_COOKIE_NAME = "guest_identity";
export const GUEST_STATE_TTL_SECONDS = 1_800;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DEFAULT_GUEST_IDENTITY_SECRET = "deep-agent-template-guest-identity-default-20260731-v1";

export type ResolvedGuestIdentity = {
  readonly identity: ExecutionIdentity;
  readonly setCookie: string | null;
};

function secret(): string {
  const value = process.env.GUEST_IDENTITY_SECRET?.trim();
  return value || DEFAULT_GUEST_IDENTITY_SECRET;
}

function signature(uuid: string): string {
  return createHmac("sha256", secret()).update(uuid, "utf8").digest("base64url");
}

function cookieValue(uuid: string): string {
  return `${uuid}.${signature(uuid)}`;
}

function readCookie(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === GUEST_COOKIE_NAME) return value.join("=") || null;
  }
  return null;
}

function isValidCookie(value: string | null): value is string {
  if (!value) return false;
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return false;
  const uuid = value.slice(0, separator);
  const provided = value.slice(separator + 1);
  if (!UUID_PATTERN.test(uuid) || !provided) return false;
  const expected = Buffer.from(signature(uuid), "utf8");
  const actual = Buffer.from(provided, "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function cookieHeader(value: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${GUEST_COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

export function resolveGuestIdentity(request: Request): ResolvedGuestIdentity {
  const existing = readCookie(request);
  if (isValidCookie(existing)) {
    return {
      identity: { tenantId: "guest", userId: existing.slice(0, existing.lastIndexOf(".")) },
      setCookie: null,
    };
  }

  const uuid = randomUUID();
  return {
    identity: { tenantId: "guest", userId: uuid },
    setCookie: cookieHeader(cookieValue(uuid)),
  };
}

export function applyGuestCookie(response: Response, setCookie: string | null): Response {
  if (setCookie) response.headers.set("Set-Cookie", setCookie);
  return response;
}

export function __guestCookieForTest(uuid: string): string {
  return cookieValue(uuid);
}
