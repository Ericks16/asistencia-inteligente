import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto';

/**
 * Cifrado AES-256-GCM (autenticado) para fotos y datos biométricos.
 * En producción la clave de datos (data key) se obtiene/rota vía AWS KMS
 * (envelope encryption). Aquí se muestra la primitiva criptográfica real.
 */
export function encryptAes256Gcm(plaintext: Buffer, key: Buffer): { iv: string; tag: string; ciphertext: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export function decryptAes256Gcm(payload: { iv: string; tag: string; ciphertext: string }, key: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, 'base64')), decipher.final()]);
}

/** HMAC-SHA256 para firma anti-replay de la foto (clave derivada del token). */
export function hmacSha256(data: Buffer, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

/** SHA-256 de los bytes originales (inmutabilidad de la foto). */
export function sha256(data: Buffer): string {
  return createHmac('sha256', '').update(data).digest('hex');
}

/** Comparación en tiempo constante (evita timing attacks). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return createHmac('sha256', ab).update(bb).digest().equals(createHmac('sha256', bb).update(ab).digest());
}
