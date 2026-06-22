/**
 * Task 2.1 — JWT tests
 * Run with: npm test -- --testPathPattern=jwt.test.ts
 */
import { signJwt, verifyJwt } from '../jwt';

// Provide a test secret
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars!!';

describe('signJwt / verifyJwt', () => {
  it('signs a token that verifyJwt can decode', () => {
    const userId = '507f1f77bcf86cd799439011';
    const token = signJwt(userId);
    expect(typeof token).toBe('string');
    const payload = verifyJwt(token);
    expect(payload.userId).toBe(userId);
  });

  it('verifyJwt throws on a tampered token', () => {
    const token = signJwt('abc123');
    const [h, p] = token.split('.');
    expect(() => verifyJwt(`${h}.${p}.badsig`)).toThrow();
  });

  it('verifyJwt throws on an expired token', async () => {
    // sign with immediate expiry by using a tiny expiresIn — we'll test via
    // a utility that allows injecting exp; alternatively, sign with ttl 0
    // Passthrough: import jwt and sign manually with exp in the past
    const jwt = await import('jsonwebtoken');
    const expired = jwt.default.sign(
      { userId: 'u1' },
      process.env.JWT_SECRET as string,
      { expiresIn: -1 }
    );
    expect(() => verifyJwt(expired)).toThrow();
  });
});
