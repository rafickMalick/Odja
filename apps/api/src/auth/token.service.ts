import { createHash, randomBytes } from 'node:crypto';

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { UserRole } from '@oja/db';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Jetons de session.
 *
 * Deux jetons, deux rôles distincts :
 *
 *   · l'**accès** est un JWT de 15 minutes. Il n'est pas stocké : sa signature
 *     suffit à le valider, ce qui évite un aller-retour en base à chaque
 *     requête. Sa courte durée borne les dégâts d'une fuite.
 *
 *   · le **rafraîchissement** est un secret aléatoire de 30 jours, stocké
 *     **haché** en base. Il tourne à chaque usage : le jeton présenté est
 *     révoqué et remplacé.
 *
 * La rotation permet de détecter le vol. Si un jeton déjà consommé est
 * représenté, c'est que deux porteurs l'ont eu en main — l'original et un
 * voleur. On ne sait pas lequel se présente, alors on **révoque toute la
 * famille de sessions de l'utilisateur** : le légitime se reconnecte, le
 * voleur perd son accès.
 */

export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
  sid: string;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  accessExpiresInSeconds: number;
  refreshExpiresAt: Date;
}

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_DAYS = 30;

@Injectable()
export class TokenService {
  private readonly accessSecret: string;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.accessSecret = config.getOrThrow<string>('JWT_ACCESS_SECRET');
  }

  async issue(
    user: { id: string; role: UserRole },
    context: { userAgent?: string; ip?: string } = {},
  ): Promise<IssuedTokens> {
    const refreshToken = randomBytes(48).toString('base64url');
    const refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 86_400_000);

    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        refreshHash: hashToken(refreshToken),
        expiresAt: refreshExpiresAt,
        ...(context.userAgent ? { userAgent: context.userAgent } : {}),
        ...(context.ip ? { ip: context.ip } : {}),
      },
    });

    const accessToken = await this.jwt.signAsync(
      { sub: user.id, role: user.role, sid: session.id } satisfies AccessTokenPayload,
      { secret: this.accessSecret, expiresIn: ACCESS_TTL_SECONDS },
    );

    return {
      accessToken,
      refreshToken,
      sessionId: session.id,
      accessExpiresInSeconds: ACCESS_TTL_SECONDS,
      refreshExpiresAt,
    };
  }

  async verifyAccess(token: string): Promise<AccessTokenPayload> {
    try {
      return await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.accessSecret,
      });
    } catch {
      throw new UnauthorizedException('Session expirée ou invalide.');
    }
  }

  /** Consomme un jeton de rafraîchissement et en émet un nouveau. */
  async rotate(
    refreshToken: string,
    context: { userAgent?: string; ip?: string } = {},
  ): Promise<IssuedTokens> {
    const session = await this.prisma.session.findFirst({
      where: { refreshHash: hashToken(refreshToken) },
      include: { user: { select: { id: true, role: true, status: true, deletedAt: true } } },
    });

    if (!session) {
      throw new UnauthorizedException('Session inconnue.');
    }

    // Jeton déjà consommé : quelqu'un le rejoue. On ne peut pas distinguer le
    // porteur légitime du voleur, alors on coupe tout.
    if (session.revokedAt) {
      await this.revokeAllForUser(session.userId);
      throw new UnauthorizedException(
        'Jeton de session rejoué. Toutes les sessions ont été fermées par sécurité.',
      );
    }

    if (session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session expirée.');
    }

    if (session.user.deletedAt || session.user.status === 'SUSPENDED') {
      await this.revokeAllForUser(session.userId);
      throw new UnauthorizedException('Compte indisponible.');
    }

    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    return this.issue({ id: session.user.id, role: session.user.role }, context);
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Déconnexion de tous les appareils. */
  async revokeAllForUser(userId: string): Promise<number> {
    const { count } = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count;
  }

  /**
   * Une session révoquée doit cesser d'être acceptée **avant** l'expiration
   * naturelle du JWT d'accès : sans ce contrôle, une déconnexion laisserait
   * l'ancien jeton valide jusqu'à 15 minutes.
   */
  async isSessionActive(sessionId: string): Promise<boolean> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { revokedAt: true, expiresAt: true },
    });
    return Boolean(session && !session.revokedAt && session.expiresAt > new Date());
  }
}

/**
 * SHA-256 suffit ici, là où les mots de passe exigent argon2 : un jeton de
 * rafraîchissement fait 48 octets aléatoires, il n'y a rien à deviner. Le
 * hachage protège contre la lecture de la base, pas contre la force brute.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
