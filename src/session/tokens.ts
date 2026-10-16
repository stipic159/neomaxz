export const MIN_TOKEN_LENGTH = 32;
export const MAX_TOKEN_LENGTH = 4096;
export const SESSION_TOKEN_LENGTH = 663; // Retained for backwards compatibility

const TOKEN_ALPHABET = /^[A-Za-z0-9\-._~+/]+=*$/;
const OBVIOUS_TEXT = /[\sЀ-ӿ]/;

const SNAPSHOT_KEYS = new Set([
  'profile',
  'chats',
  'messages',
  'contacts',
  'presence',
  'config',
  'updates',
]);

export function looksLikeToken(
  value: string,
  minLength = MIN_TOKEN_LENGTH,
  maxLength = MAX_TOKEN_LENGTH
): boolean {
  if (typeof value !== 'string') return false;
  const len = value.length;
  return len >= minLength && len <= maxLength && TOKEN_ALPHABET.test(value);
}

export function couldBeToken(
  value: string,
  minLength = MIN_TOKEN_LENGTH,
  maxLength = MAX_TOKEN_LENGTH
): boolean {
  if (typeof value !== 'string') return false;
  const len = value.length;
  return len >= minLength && len <= maxLength && !OBVIOUS_TEXT.test(value);
}

export function findAuthToken(payload: unknown): string | undefined {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const p = payload as Record<string, unknown>;
    const token = p.token ?? p.authToken ?? p.auth_token;
    if (typeof token === 'string' && token.length > 0) return token;
  }
  return undefined;
}

/**
 * Searches the payload for a session token based on known response paths,
 * object keys, or structural patterns (flexible length 32..4096).
 */
export function findLongToken(
  value: unknown,
  minLength = MIN_TOKEN_LENGTH,
  maxLength = MAX_TOKEN_LENGTH
): string | undefined {
  if (!value || typeof value !== 'object') return undefined;

  const v = value as any;

  // 1. Fast path: check known direct schema locations first
  const directToken =
    v.tokenAttrs?.LOGIN?.token ??
    v.tokenAttrs?.token ??
    v.loginToken ??
    v.sessionToken ??
    v.token ??
    v.auth?.token ??
    v.auth?.loginToken ??
    v.credentials?.sessionToken;

  if (typeof directToken === 'string' && looksLikeToken(directToken, minLength, maxLength)) {
    return directToken;
  }

  // 2. Structured walk: prioritize fields with "token" in key name
  const strict = walkForToken(value, (s) => looksLikeToken(s, minLength, maxLength), new Set());
  if (strict) return strict;

  // 3. Permissive walk fallback
  return walkForToken(value, (s) => couldBeToken(s, minLength, maxLength), new Set());
}

function walkForToken(
  value: unknown,
  accept: (s: string) => boolean,
  seen: Set<unknown>
): string | undefined {
  if (typeof value === 'string') {
    return accept(value) ? value : undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);

  const entries: Array<[string | unknown, unknown]> =
    value instanceof Map
      ? Array.from(value.entries())
      : Array.isArray(value)
      ? Array.from(value.entries())
      : Object.entries(value as object);

  // First pass: inspect children whose key contains "token"
  for (const [key, child] of entries) {
    if (typeof key === 'string') {
      if (SNAPSHOT_KEYS.has(key)) continue;
      if (key.toLowerCase().includes('token')) {
        const found = walkForToken(child, accept, seen);
        if (found) return found;
      }
    }
  }

  // Second pass: inspect other keys
  for (const [key, child] of entries) {
    if (typeof key === 'string' && (SNAPSHOT_KEYS.has(key) || key.toLowerCase().includes('token'))) {
      continue;
    }
    const found = walkForToken(child, accept, seen);
    if (found) return found;
  }

  return undefined;
}

export interface PasswordChallenge {
  trackId: string;
  hint?: string;
}

export function extractPasswordChallenge(payload: unknown): PasswordChallenge | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const challenge = (payload as Record<string, unknown>).passwordChallenge;
  if (!challenge || typeof challenge !== 'object') return undefined;
  const trackId = (challenge as Record<string, unknown>).trackId;
  if (typeof trackId !== 'string') return undefined;
  const hint = (challenge as Record<string, unknown>).hint;
  return { trackId, hint: typeof hint === 'string' ? hint : undefined };
}

export function describeAuthError(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    const msg = p.localizedMessage ?? p.message ?? p.error;
    if (typeof msg === 'string') return msg;
  }
  return fallback;
}
