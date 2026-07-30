// Client-side guest identity.
//
// Each browser gets one UUID v4 that survives reloads and restarts. The id is
// minted on first contact and persisted in both localStorage (primary) and a
// non-HttpOnly cookie (backup) so:
//   - subsequent requests read it synchronously from localStorage, and
//   - a fresh tab or a localStorage wipe can still recover from the cookie.
//
// There is no authentication, no rotation, and no server-side lookup. The
// server treats any well-formed UUID v4 as a valid guest; this module owns the
// stability of the id across the lifetime of a browser profile.

const STORAGE_KEY = "deep-agent-template.guestId";
const COOKIE_KEY = "deep-agent-template-guestId";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year

// RFC 4122 v4 generator using the Web Crypto API. Available in all modern
// browsers, SSR-safe via the typeof guard in getOrCreateGuestId().
export function mintUuidV4(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Set version (4) and variant (10xx) bits per RFC 4122 §4.4. The `?? 0`
  // fallbacks are only there to satisfy `noUncheckedIndexedAccess`; indices
  // 6 and 8 always exist on a 16-byte buffer.
  setByte(bytes, 6, ((bytes[6] ?? 0) & 0x0f) | 0x40);
  setByte(bytes, 8, ((bytes[8] ?? 0) & 0x3f) | 0x80);
  const hex = [...bytes].map((b) => (b ?? 0).toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20)}`;
}

function setByte(bytes: Uint8Array, index: number, value: number): void {
  bytes[index] = value;
}

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** True if `value` is a canonical UUID v4 string. Case-insensitive. */
export function isValidGuestId(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_V4_PATTERN.test(value);
}

function readCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${COOKIE_KEY}=`));
  if (!match) return null;
  const value = decodeURIComponent(match.slice(COOKIE_KEY.length + 1));
  return isValidGuestId(value) ? value : null;
}

function writeCookie(id: string): void {
  if (typeof document === "undefined") return;
  const encoded = encodeURIComponent(id);
  const secure =
    typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  // Direct document.cookie assignment is the only browser API for setting a
  // cookie from client JS; the lint rule's "use a wrapper" suggestion does
  // not apply here.
  // biome-ignore lint/suspicious/noDocumentCookie: intentional client-side cookie write
  document.cookie = `${COOKIE_KEY}=${encoded}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`;
}

function readLocalStorage(): string | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isValidGuestId(value) ? value : null;
  } catch {
    // localStorage can throw in private-browsing modes; fall back to cookie.
    return null;
  }
}

function writeLocalStorage(id: string): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // See readLocalStorage — ignore quota/private-mode failures. The cookie
    // backup keeps the id stable.
  }
}

let cachedGuestId: string | null = null;

/**
 * Returns the browser's guest UUID v4, minting one on first call. Subsequent
 * calls return the cached value. The id is persisted to localStorage and a
 * SameSite=Lax cookie so it survives reloads, new tabs, and localStorage loss.
 *
 * SSR-safe: returns an empty string when called outside a browser. The hook
 * callers must be in a client component ("use client"), so this never runs on
 * the server in practice, but the guard keeps the function safe to import.
 */
export function getOrCreateGuestId(): string {
  if (cachedGuestId) return cachedGuestId;
  if (typeof window === "undefined") return "";

  const fromStorage = readLocalStorage();
  if (fromStorage) {
    cachedGuestId = fromStorage;
    // Ensure the cookie exists even if only localStorage had the id.
    if (!readCookie()) writeCookie(fromStorage);
    return fromStorage;
  }

  const fromCookie = readCookie();
  if (fromCookie) {
    cachedGuestId = fromCookie;
    writeLocalStorage(fromCookie);
    return fromCookie;
  }

  const minted = mintUuidV4();
  writeLocalStorage(minted);
  writeCookie(minted);
  cachedGuestId = minted;
  return minted;
}

/**
 * Resets the in-process cache. Test-only — production callers should never
 * need to forget an id once minted.
 */
export function resetGuestIdForTest(): void {
  cachedGuestId = null;
}
