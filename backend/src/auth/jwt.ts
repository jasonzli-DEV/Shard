import jwt from 'jsonwebtoken';

const JWT_TTL = '7d';

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }
  return secret;
}

export interface JwtPayload {
  userId: string;
}

/**
 * Sign a JWT for the given userId.
 * Expires in 7 days.
 */
export function signJwt(userId: string): string {
  return jwt.sign({ userId }, getSecret(), { expiresIn: JWT_TTL });
}

/**
 * Verify a JWT and return its payload.
 * Throws if the token is invalid or expired.
 */
export function verifyJwt(token: string): JwtPayload {
  const decoded = jwt.verify(token, getSecret()) as jwt.JwtPayload;
  if (!decoded || typeof decoded.userId !== 'string') {
    throw new Error('Invalid JWT payload');
  }
  return { userId: decoded.userId };
}
