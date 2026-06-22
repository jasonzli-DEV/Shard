import { encryptBuffer, decryptBuffer, generateEncryptionKey } from '../crypto';

describe('crypto utils', () => {
  describe('generateEncryptionKey', () => {
    it('returns a 64-character hex string (256-bit key)', () => {
      const key = generateEncryptionKey();
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    });

    it('generates unique keys each call', () => {
      const k1 = generateEncryptionKey();
      const k2 = generateEncryptionKey();
      expect(k1).not.toBe(k2);
    });
  });

  describe('encryptBuffer / decryptBuffer', () => {
    it('roundtrip: decrypt(encrypt(buf)) === original', () => {
      const key = generateEncryptionKey();
      const original = Buffer.from('Hello, Shard!');
      const encrypted = encryptBuffer(original, key);
      const decrypted = decryptBuffer(encrypted, key);
      expect(decrypted).toEqual(original);
    });

    it('adds exactly 44 bytes of overhead (salt16 + iv12 + tag16)', () => {
      const key = generateEncryptionKey();
      const original = Buffer.alloc(100, 0xab);
      const encrypted = encryptBuffer(original, key);
      expect(encrypted.length).toBe(100 + 44);
    });

    it('roundtrip works for empty buffer', () => {
      const key = generateEncryptionKey();
      const original = Buffer.alloc(0);
      const encrypted = encryptBuffer(original, key);
      const decrypted = decryptBuffer(encrypted, key);
      expect(decrypted).toEqual(original);
    });

    it('roundtrip works for large buffer', () => {
      const key = generateEncryptionKey();
      const original = Buffer.alloc(1024 * 1024, 0x42); // 1 MB
      const encrypted = encryptBuffer(original, key);
      const decrypted = decryptBuffer(encrypted, key);
      expect(decrypted).toEqual(original);
    });

    it('encrypts non-deterministically (same input → different ciphertext)', () => {
      const key = generateEncryptionKey();
      const original = Buffer.from('determinism test');
      const e1 = encryptBuffer(original, key);
      const e2 = encryptBuffer(original, key);
      expect(e1).not.toEqual(e2);
    });

    it('wrong key throws on decrypt (GCM auth tag mismatch)', () => {
      const key = generateEncryptionKey();
      const wrongKey = generateEncryptionKey();
      const encrypted = encryptBuffer(Buffer.from('secret'), key);
      expect(() => decryptBuffer(encrypted, wrongKey)).toThrow();
    });
  });
});
