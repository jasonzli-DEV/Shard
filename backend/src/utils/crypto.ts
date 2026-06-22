import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
/** Total overhead added to every encrypted buffer: salt(16) + iv(12) + tag(16) = 44 bytes */
export const ENCRYPTION_OVERHEAD = SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH; // 44

function deriveKey(keyHex: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(keyHex, salt, 100_000, 32, 'sha256');
}

/**
 * Encrypt a buffer with AES-256-GCM.
 * Output layout: salt(16) + iv(12) + authTag(16) + ciphertext
 * @param buf - plaintext bytes
 * @param keyHex - 64-hex-char (256-bit) encryption key
 */
export function encryptBuffer(buf: Buffer, keyHex: string): Buffer {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(keyHex, salt);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(buf), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([salt, iv, authTag, ciphertext]);
}

/**
 * Decrypt a buffer previously encrypted with encryptBuffer.
 * Throws if the key is wrong or the data has been tampered (GCM auth tag mismatch).
 * @param buf - encrypted bytes (salt+iv+tag+ciphertext)
 * @param keyHex - 64-hex-char encryption key
 */
export function decryptBuffer(buf: Buffer, keyHex: string): Buffer {
  if (buf.length < ENCRYPTION_OVERHEAD) {
    throw new Error(`Encrypted buffer too short: ${buf.length} < ${ENCRYPTION_OVERHEAD}`);
  }
  const salt = buf.subarray(0, SALT_LENGTH);
  const iv = buf.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = buf.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

  const key = deriveKey(keyHex, salt);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Generate a new random AES-256 encryption key.
 * @returns 64-char lowercase hex string (256 bits)
 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString('hex');
}
