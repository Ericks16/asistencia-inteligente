import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

/**
 * KDF con scrypt (nativo de Node, sin dependencias nativas externas).
 * Formato almacenado: "saltHex:hashHex". Equivalente en seguridad a argon2id.
 */
export function hashSecret(secret: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(secret, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifySecret(stored: string, secret: string): boolean {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(secret, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}
