// ============================================================================
// LUXEDGE — AUTH TOKEN PRIMITIVES
//
// One place that produces and hashes the bearer secrets of the buyer auth
// system, so session tokens and activation codes cannot drift apart in entropy
// or encoding.
//
// RULES ENFORCED HERE:
//   * Every token comes from crypto.getRandomValues (the platform CSPRNG) —
//     never Math.random, never a timestamp, never a counter.
//   * Only the SHA-256 of a token is ever persisted. A database dump therefore
//     yields no usable session and no usable activation code.
//   * Codes are drawn from an unambiguous alphabet and compared after
//     normalisation, so a customer reading one over the phone cannot be
//     defeated by O/0 or I/1 lookalikes.
// ============================================================================

/** base64url — URL/cookie safe, no padding. */
export function toB64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** 256 bits of CSPRNG entropy, base64url encoded (43 chars). */
export function randomToken(bytes = 32): string {
  return toB64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** SHA-256 hex — what actually goes into D1. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return toHex(new Uint8Array(digest));
}

/**
 * Activation/reset code alphabet: Crockford-style, without I, L, O, U, 0 or 1,
 * so a code dictated over the phone has exactly one plausible spelling.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const CODE_LENGTH = 10;

/** A code shaped `XXXX-XXXX-XX` (the dashes are cosmetic; hashing strips them). */
export function generateActivationCode(): string {
  const raw = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  let body = '';
  for (const byte of raw) body += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return `${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8)}`;
}

/** Canonical form used for hashing and comparison (uppercase, no separators). */
export function normalizeActivationCode(code: string): string {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Entropy of a generated code. 10 chars over a 30-symbol alphabet ≈ 49 bits —
 * far beyond online guessing, and the redemption endpoint is rate limited and
 * the code expires, so offline speed is irrelevant here (unlike a password).
 */
export const ACTIVATION_CODE_ENTROPY_BITS = Math.floor(Math.log2(CODE_ALPHABET.length ** CODE_LENGTH));
