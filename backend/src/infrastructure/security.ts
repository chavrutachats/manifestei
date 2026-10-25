import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type {
  AccessClaims,
  Clock,
  IdGenerator,
  PayloadHasher,
  DeviceAnchorHasher,
  TokenService,
} from '../application/ports.js';
import { DomainError } from '../domain/errors.js';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class CryptoIdGenerator implements IdGenerator {
  uuid(): string {
    return randomUUID();
  }
}

/**
 * HMAC com pepper guardado fora do banco: um vazamento do banco não permite
 * descobrir qual aparelho é qual, nem cruzar com outro sistema que conheça o ANDROID_ID.
 */
export class HmacAnchorHasher implements DeviceAnchorHasher {
  constructor(private readonly pepper: string) {
    if (pepper.length < 32) throw new Error('DEVICE_ANCHOR_PEPPER precisa de 32+ caracteres');
  }
  hash(platform: 'ios' | 'android', anchor: string): string {
    return createHmac('sha256', this.pepper).update(`${platform}:${anchor.toLowerCase()}`, 'utf8').digest('hex');
  }
}

export class Sha256PayloadHasher implements PayloadHasher {
  sha256Base64(data: string): string {
    return createHash('sha256').update(data, 'utf8').digest('base64');
  }
}

export class JoseTokenService implements TokenService {
  private readonly key: Uint8Array;
  private static readonly ISSUER = 'manifestei-api';
  private static readonly AUDIENCE = 'manifestei-app';

  constructor(
    secret: string,
    private readonly accessTtlSeconds = 15 * 60,
  ) {
    if (secret.length < 32) throw new Error('JWT_SECRET precisa de 32+ caracteres');
    this.key = new TextEncoder().encode(secret);
  }

  async issueAccessToken(claims: AccessClaims): Promise<{ token: string; expiresInSeconds: number }> {
    const token = await new SignJWT({ sid: claims.sessionId })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.userId)
      .setIssuer(JoseTokenService.ISSUER)
      .setAudience(JoseTokenService.AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.accessTtlSeconds}s`)
      .sign(this.key);
    return { token, expiresInSeconds: this.accessTtlSeconds };
  }

  async verifyAccessToken(token: string): Promise<AccessClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: JoseTokenService.ISSUER,
        audience: JoseTokenService.AUDIENCE,
        algorithms: ['HS256'],
      });
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') throw new Error('claims');
      return { userId: payload.sub, sessionId: payload.sid };
    } catch {
      throw new DomainError('UNAUTHENTICATED', 'Token inválido ou expirado.');
    }
  }

  newRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: this.hashRefreshToken(token) };
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }
}
