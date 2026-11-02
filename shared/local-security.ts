import { getRandomBytesAsync } from 'expo-crypto';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

export const LOCAL_SECRET_ALGORITHM = 'PBKDF2-HMAC-SHA256' as const;
export const DEFAULT_LOCAL_SECRET_ITERATIONS = 210_000;
const SALT_LENGTH_BYTES = 16;
const HASH_LENGTH_BYTES = 32;
const MIN_ITERATIONS = 1;
const MAX_ITERATIONS = 10_000_000;

export interface LocalSecretCredential {
  algorithm: typeof LOCAL_SECRET_ALGORITHM;
  salt: string;
  hash: string;
  iterations: number;
}

/** Derives a local-only credential; the plaintext secret is never returned or persisted here. */
export async function deriveLocalSecret(
  secret: string,
  iterations = DEFAULT_LOCAL_SECRET_ITERATIONS,
): Promise<LocalSecretCredential> {
  if (typeof secret !== 'string' || !Number.isSafeInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    throw new TypeError('Invalid secret or iteration count');
  }

  const saltBytes = await getRandomBytesAsync(SALT_LENGTH_BYTES);
  const hashBytes = await pbkdf2Async(sha256, secret, saltBytes, {
    c: iterations,
    dkLen: HASH_LENGTH_BYTES,
  });
  return {
    algorithm: LOCAL_SECRET_ALGORITHM,
    salt: bytesToHex(saltBytes),
    hash: bytesToHex(hashBytes),
    iterations,
  };
}

function isCredential(value: unknown): value is LocalSecretCredential {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<LocalSecretCredential>;
  return candidate.algorithm === LOCAL_SECRET_ALGORITHM
    && typeof candidate.iterations === 'number'
    && Number.isSafeInteger(candidate.iterations)
    && candidate.iterations >= MIN_ITERATIONS
    && candidate.iterations <= MAX_ITERATIONS
    && typeof candidate.salt === 'string'
    && /^[0-9a-f]{32}$/i.test(candidate.salt)
    && typeof candidate.hash === 'string'
    && /^[0-9a-f]{64}$/i.test(candidate.hash);
}

/** Verifies a secret. Malformed credentials and mismatches fail closed. */
export async function verifyLocalSecret(
  secret: string,
  credential: LocalSecretCredential,
): Promise<boolean> {
  if (typeof secret !== 'string' || !isCredential(credential)) return false;
  try {
    const expected = hexToBytes(credential.hash);
    const actual = await pbkdf2Async(sha256, secret, hexToBytes(credential.salt), {
      c: credential.iterations,
      dkLen: HASH_LENGTH_BYTES,
    });
    let difference = 0;
    for (let i = 0; i < HASH_LENGTH_BYTES; i += 1) {
      difference |= expected[i] ^ actual[i];
    }
    return difference === 0;
  } catch {
    return false;
  }
}
