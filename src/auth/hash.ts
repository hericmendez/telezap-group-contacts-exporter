import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

// scrypt with OWASP-ish parameters for interactive login (Node 22).
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

// Explicit wrapper (instead of promisify, which resolves the wrong overload
// in the installed @types/node) for the options form of scrypt.
function scryptAsync(password: string, salt: Buffer, keyLength: number, opts: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keyLength, opts, (err: Error | null, derivedKey: Buffer) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/**
 * Stored password format: `scrypt.N.r.p.saltB64url.hashB64url`.
 *
 * Deliberately `$`-free: Next.js expands `$VAR` references in environment
 * values at startup, which corrupts classic PHC `scrypt$…` strings before
 * the application ever sees them. Dots and base64url are inert in `.env`
 * files, shells, and Next's env pipeline. Never store or compare plaintext.
 * Verification uses timingSafeEqual.
 */
const HASH_PREFIX = "scrypt";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const hash = (await scryptAsync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  })) as Buffer;
  return [
    HASH_PREFIX,
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString("base64url"),
    hash.toString("base64url"),
  ].join(".");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(".");
  if (parts.length !== 6 || parts[0] !== HASH_PREFIX) return false;
  const [, n, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const N = Number(n);
  const R = Number(r);
  const P = Number(p);
  if (!Number.isInteger(N) || !Number.isInteger(R) || !Number.isInteger(P)) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltB64, "base64url");
    expected = Buffer.from(hashB64, "base64url");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;
  let actual: Buffer;
  try {
    actual = (await scryptAsync(password, salt, expected.length, { N, r: R, p: P })) as Buffer;
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
