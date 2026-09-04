import { createHash, randomInt } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import type { VerificationPurpose } from '@oja/db';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Codes de vérification à usage unique.
 *
 * Sur ce marché le téléphone est l'identité : c'est le SMS qui vérifie un
 * compte, pas l'e-mail. Trois protections encadrent un code à six chiffres :
 *
 *   · il est **haché** en base — une fuite ne donne pas les codes en cours ;
 *   · il **expire** en 10 minutes ;
 *   · il compte les **tentatives** — sans quoi 1 000 000 de combinaisons se
 *     balaient en quelques minutes.
 *
 * Le code est tiré avec `randomInt` du module crypto, pas `Math.random` : ce
 * dernier est prévisible et n'a rien à faire dans un secret d'authentification.
 */

export interface OtpIssue {
  code: string;
  expiresAt: Date;
}

const CODE_LENGTH = 6;
const TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;

export type OtpFailure =
  | 'not_found'
  | 'expired'
  | 'too_many_attempts'
  | 'mismatch';

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(private readonly prisma: PrismaService) {}

  async issue(userId: string, purpose: VerificationPurpose): Promise<OtpIssue> {
    // Un nouveau code invalide les précédents : deux codes valides en même
    // temps doublent la surface d'attaque sans rien apporter.
    await this.prisma.verificationToken.updateMany({
      where: { userId, purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    const code = String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
    const expiresAt = new Date(Date.now() + TTL_MINUTES * 60_000);

    await this.prisma.verificationToken.create({
      data: {
        userId,
        purpose,
        codeHash: hashCode(code),
        expiresAt,
        maxAttempts: MAX_ATTEMPTS,
      },
    });

    return { code, expiresAt };
  }

  /**
   * Vérifie un code et le consomme s'il est bon.
   *
   * Renvoie un motif d'échec typé plutôt qu'un booléen : l'appelant décide de
   * ce qu'il en dit à l'utilisateur. En pratique il ne distingue pas
   * « inexistant » de « erroné » dans sa réponse — cette différence
   * apprendrait à un attaquant quels comptes sont en cours de vérification.
   */
  async verify(
    userId: string,
    purpose: VerificationPurpose,
    code: string,
  ): Promise<{ ok: true } | { ok: false; reason: OtpFailure }> {
    const token = await this.prisma.verificationToken.findFirst({
      where: { userId, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!token) return { ok: false, reason: 'not_found' };

    if (token.expiresAt < new Date()) {
      return { ok: false, reason: 'expired' };
    }

    if (token.attempts >= token.maxAttempts) {
      return { ok: false, reason: 'too_many_attempts' };
    }

    if (token.codeHash !== hashCode(code)) {
      await this.prisma.verificationToken.update({
        where: { id: token.id },
        data: { attempts: { increment: 1 } },
      });
      return { ok: false, reason: 'mismatch' };
    }

    await this.prisma.verificationToken.update({
      where: { id: token.id },
      data: { consumedAt: new Date() },
    });

    return { ok: true };
  }

  /** Purge des codes expirés — tâche planifiée. */
  async purgeExpired(): Promise<number> {
    const { count } = await this.prisma.verificationToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (count > 0) this.logger.log(`${count} codes expirés purgés`);
    return count;
  }
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}
