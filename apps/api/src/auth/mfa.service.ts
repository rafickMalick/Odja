import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { MfaRecoveryCodes, MfaSetup, MfaStatus } from '@oja/contracts';

import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from './decorators/current-user.decorator';
import { MfaPolicy } from './mfa-policy';
import { TokenService } from './token.service';
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCode,
  generateTotpSecret,
  hashRecoveryCode,
  otpauthUrl,
  verifyTotp,
} from './totp';

const RECOVERY_CODE_COUNT = 10;
/** Le temps de sortir son téléphone, pas davantage. */
const CHALLENGE_TTL_SECONDS = 5 * 60;
const CHALLENGE_PURPOSE = 'mfa-login';

/**
 * Double authentification par TOTP (cahier L0-22, L7-16).
 *
 * Activation en deux temps : un secret est proposé, puis confirmé par un
 * premier code. Sans cette confirmation, un secret mal scanné verrouillerait
 * le compte dès la connexion suivante.
 *
 * À la connexion, un compte qui l'a activée reçoit un **défi** — un jeton
 * signé de cinq minutes — au lieu d'une session ; la session n'est ouverte
 * qu'avec le code. Le mot de passe seul ne suffit plus.
 */
@Injectable()
export class MfaService {
  private readonly pepper: string;
  private readonly challengeSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly tokens: TokenService,
    private readonly policy: MfaPolicy,
    config: ConfigService,
  ) {
    this.pepper = config.getOrThrow<string>('ARGON2_PEPPER');
    this.challengeSecret = config.getOrThrow<string>('JWT_ACCESS_SECRET');
  }

  async status(user: AuthenticatedUser): Promise<MfaStatus> {
    const record = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        mfaEnabledAt: true,
        _count: { select: { recoveryCodes: { where: { usedAt: null } } } },
      },
    });
    return {
      enabled: record.mfaEnabledAt !== null,
      required: this.policy.isRequiredFor(user.role),
      sessionVerified: user.mfa === true,
      recoveryCodesLeft: record._count.recoveryCodes,
    };
  }

  /** Propose un nouveau secret. Remplace une activation commencée et abandonnée. */
  async setup(userId: string): Promise<MfaSetup> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.mfaEnabledAt) {
      throw new BadRequestException('La double authentification est déjà activée.');
    }

    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: encryptSecret(secret, this.pepper), mfaLastStep: null },
    });
    return { secret, otpauthUrl: otpauthUrl(secret, user.email) };
  }

  /**
   * Confirme l'activation par un premier code.
   *
   * La session qui active est aussitôt marquée « second facteur vérifié » :
   * l'admin qui vient de s'équiper n'a pas à se reconnecter.
   */
  async enable(user: AuthenticatedUser, code: string): Promise<MfaRecoveryCodes> {
    const record = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (record.mfaEnabledAt) {
      throw new BadRequestException('La double authentification est déjà activée.');
    }
    if (!record.mfaSecret) {
      throw new BadRequestException('Commencez par afficher le code à scanner.');
    }

    const step = verifyTotp(decryptSecret(record.mfaSecret, this.pepper), code, null);
    if (step === null) {
      throw new BadRequestException(
        'Code incorrect. Vérifiez l’heure de votre téléphone et saisissez le code affiché.',
      );
    }

    const recoveryCodes = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { mfaEnabledAt: new Date(), mfaLastStep: step },
      });
      return this.replaceRecoveryCodes(tx, user.id);
    });
    await this.tokens.markMfaVerified(user.sessionId);

    return { recoveryCodes };
  }

  /** Désactivation : refusée là où elle est imposée, et seulement avec un code. */
  async disable(user: AuthenticatedUser, code: string): Promise<void> {
    if (this.policy.isRequiredFor(user.role)) {
      throw new ForbiddenException(
        'La double authentification est obligatoire pour un administrateur.',
      );
    }
    await this.assertCode(user.id, code);
    await this.clear(user.id);
  }

  /** Nouveaux codes de secours : les anciens cessent aussitôt de servir. */
  async regenerateRecoveryCodes(userId: string, code: string): Promise<MfaRecoveryCodes> {
    await this.assertCode(userId, code);
    const recoveryCodes = await this.prisma.$transaction((tx) =>
      this.replaceRecoveryCodes(tx, userId),
    );
    return { recoveryCodes };
  }

  /**
   * Un code de l'application ou un code de secours.
   *
   * Chaque acceptation est **consommée en base** par une écriture
   * conditionnelle : deux requêtes simultanées avec le même code ne passent
   * pas toutes les deux.
   */
  async verifyCode(userId: string, code: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.mfaEnabledAt || !user.mfaSecret) return false;

    const digits = code.replace(/\s/g, '');
    if (/^\d{6}$/.test(digits)) {
      const step = verifyTotp(decryptSecret(user.mfaSecret, this.pepper), digits, user.mfaLastStep);
      if (step === null) return false;
      const { count } = await this.prisma.user.updateMany({
        where: {
          id: userId,
          OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: step } }],
        },
        data: { mfaLastStep: step },
      });
      return count === 1;
    }

    const { count } = await this.prisma.mfaRecoveryCode.updateMany({
      where: { userId, codeHash: hashRecoveryCode(code), usedAt: null },
      data: { usedAt: new Date() },
    });
    return count === 1;
  }

  async createChallenge(userId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, purpose: CHALLENGE_PURPOSE },
      { secret: this.challengeSecret, expiresIn: CHALLENGE_TTL_SECONDS },
    );
  }

  /** L'utilisateur du défi, s'il est authentique et frais. */
  async readChallenge(challenge: string): Promise<string> {
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; purpose: string }>(challenge, {
        secret: this.challengeSecret,
      });
      if (payload.purpose !== CHALLENGE_PURPOSE) throw new Error('mauvais usage');
      return payload.sub;
    } catch {
      throw new UnauthorizedException('Délai dépassé. Reprenez la connexion depuis le début.');
    }
  }

  /**
   * Réinitialisation par un autre administrateur, pour un téléphone perdu.
   * Toutes les sessions de la personne sont fermées : elle réactivera à sa
   * prochaine connexion.
   */
  async resetFor(userId: string): Promise<void> {
    await this.clear(userId);
    await this.tokens.revokeAllForUser(userId);
  }

  private async assertCode(userId: string, code: string): Promise<void> {
    if (!(await this.verifyCode(userId, code))) {
      throw new BadRequestException('Code incorrect.');
    }
  }

  private async clear(userId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.user.update({
        where: { id: userId },
        data: { mfaSecret: null, mfaEnabledAt: null, mfaLastStep: null },
      }),
    ]);
  }

  private async replaceRecoveryCodes(
    tx: Pick<PrismaService, 'mfaRecoveryCode'>,
    userId: string,
  ): Promise<string[]> {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
    await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
    await tx.mfaRecoveryCode.createMany({
      data: codes.map((code) => ({ userId, codeHash: hashRecoveryCode(code) })),
    });
    return codes;
  }
}
