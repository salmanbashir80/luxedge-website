// ============================================================================
// LUXEDGE — BUYER PASSWORD HASHING (PBKDF2-SHA256 via WebCrypto)
//
// WHY THIS ALGORITHM: the legacy credentials are bcrypt `$2a$`. bcrypt is NOT
// in WebCrypto, and a pure-JS implementation costs tens of milliseconds of CPU
// per verification inside a Worker — a cost that is paid by an attacker's
// request, not by us. PBKDF2-SHA256 is a standard, NIST-approved password KDF
// that WebCrypto implements natively, so verification is bounded, constant-ish
// work the platform can actually run. (scrypt and argon2 are not in WebCrypto
// at all; neither can be used here without shipping a JS implementation, which
// would be slower, unaudited and memory-hostile.)
//
// PARAMETERS ARE VERSIONED AND RECORDED PER HASH, so the cost can be raised
// later without invalidating anyone's password:
//
//     pbkdf2-sha256$v1$<iterations>$<salt-b64url>$<derived-b64url>
//
// ITERATIONS: see PBKDF2_ITERATIONS below — the value is set from a MEASURED
// benchmark on the real runtime (docs/CLOUDFLARE_MIGRATION.md records the
// numbers), not from a guess. `needsRehash()` reports when a stored hash was
// made with cheaper parameters so it can be upgraded transparently at the next
// successful sign-in.
//
// WHAT IS DELIBERATELY NOT HERE: no plaintext, no reversible encryption, no
// passwords in logs, no password in a URL, no "remember the password" cache,
// and no fallback to a weaker comparison under load.
// ============================================================================

const ALGO = 'pbkdf2-sha256';
const VERSION = 'v1';
const SALT_BYTES = 16;
const KEY_BITS = 256;

/**
 * PBKDF2 iteration count — THE RUNTIME'S HARD MAXIMUM.
 *
 * MEASURED on the real runtime (staging Worker, 2026-09-29) with the
 * AUTH_BENCH=1-only route /api/auth/_bench — see
 * docs/CLOUDFLARE_MIGRATION.md → "Password KDF: measured, not assumed":
 *
 *   100 000 iterations  -> 200 OK (8 derivations in one request, ~0.33 s)
 *   120 000+ iterations -> NotSupportedError:
 *      "Pbkdf2 failed: iteration counts above 100000 are not supported"
 *
 * So 100 000 is not a tuning choice, it is the ceiling workerd's WebCrypto
 * enforces. OWASP's current PBKDF2-SHA256 guidance is higher (600 000), which
 * this runtime cannot reach at all; the compensating controls are therefore
 * real and enforced rather than nominal — a 10-character minimum, durable
 * per-account AND per-IP rate limits (worker/auth/store.ts), single-use
 * expiring activation codes, and this versioned hash format so the cost can be
 * raised for existing users the moment the runtime allows it (verifyPassword
 * reads the parameters from each stored hash, and needsRehash() flags them).
 *
 * Also verified there: a request performing ~0.33 s of derivation returns 200,
 * so this Worker is not being held to the 10 ms Workers-Free CPU ceiling. The
 * account's plan could not be read back (no billing scope on the credential),
 * which is why the limit is documented as an observation, not a claim.
 */
export const PBKDF2_ITERATIONS = 100_000;

/**
 * Weakest stored hash we will still honour. Kept BELOW the current target so a
 * hash written under older parameters keeps working (and is upgraded on the
 * next successful sign-in) instead of locking that user out.
 */
export const PBKDF2_MIN_ITERATIONS = 50_000;

import { fromB64url, toB64url as b64url } from './tokens';

export interface HashRecord {
  algorithm: string;
  version: string;
  iterations: number;
  salt: string;
  hash: string;
}

/** NFKC-normalised passwords: "ﬁ" and "fi" must hash the same everywhere. */
function passwordBytes(password: string): Uint8Array {
  return new TextEncoder().encode(password.normalize('NFKC'));
}

/**
 * A plain ArrayBuffer over the bytes. WebCrypto's BufferSource does not accept
 * `Uint8Array<ArrayBufferLike>` (it could be a SharedArrayBuffer), so the view
 * is narrowed once here instead of casting at every call site.
 */
function bytes(part: Uint8Array): ArrayBuffer {
  return part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength) as ArrayBuffer;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', bytes(passwordBytes(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: bytes(salt), iterations },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

/** Constant-time comparison — a length leak is not a secret, content is. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Hash a password with a fresh random salt. Returns the versioned string. */
export async function hashPassword(password: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  if (!password) throw new Error('password required');
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derived = await derive(password, salt, iterations);
  return `${ALGO}$${VERSION}$${iterations}$${b64url(salt)}$${b64url(derived)}`;
}

/** Parse a stored hash. Returns null for anything malformed or too weak. */
export function parseHashRecord(stored: string | null | undefined): HashRecord | null {
  if (!stored) return null;
  const parts = stored.split('$');
  if (parts.length !== 5) return null;
  const [algorithm, version, itersRaw, salt, hash] = parts;
  if (algorithm !== ALGO || version !== VERSION) return null;
  const iterations = Number(itersRaw);
  if (!Number.isInteger(iterations) || iterations < PBKDF2_MIN_ITERATIONS) return null;
  if (!salt || !hash) return null;
  return { algorithm, version, iterations, salt, hash };
}

/** Verify a password against a stored hash. Never throws on bad input. */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const record = parseHashRecord(stored);
  if (!record || !password) return false;
  try {
    const derived = await derive(password, fromB64url(record.salt), record.iterations);
    return timingSafeEqual(derived, fromB64url(record.hash));
  } catch {
    return false;
  }
}

/** True when a stored hash was made with cheaper parameters than we now use. */
export function needsRehash(stored: string | null | undefined): boolean {
  const record = parseHashRecord(stored);
  if (!record) return true;
  return record.iterations < PBKDF2_ITERATIONS;
}

/**
 * Equal-cost rejection: when no usable account/hash exists (unknown email,
 * activation still pending), callers still spend the same derivation so the
 * response time cannot be used to enumerate which emails have accounts.
 */
export async function burnPasswordTime(iterations = PBKDF2_ITERATIONS): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  await derive('luxedge-timing-equaliser', salt, iterations);
}

/** Measures the real cost so the parameter choice is evidence-based. */
export async function benchmarkPbkdf2(iterations: number, runs = 3): Promise<{ iterations: number; msPerRun: number[]; medianMs: number }> {
  const ms: number[] = [];
  for (let i = 0; i < Math.max(1, runs); i++) {
    const started = Date.now();
    await hashPassword('benchmark-password-value', iterations);
    ms.push(Date.now() - started);
  }
  const sorted = [...ms].sort((a, b) => a - b);
  const medianMs = sorted[Math.floor(sorted.length / 2)];
  return { iterations, msPerRun: ms, medianMs };
}
