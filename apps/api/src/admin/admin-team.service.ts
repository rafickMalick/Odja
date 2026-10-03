import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { MfaService } from '../auth/mfa.service';
import { TokenService } from '../auth/token.service';
import { PrismaService } from '../prisma/prisma.service';

export interface AdminMember {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  createdAt: string;
  isYou: boolean;
  /** Double authentification activée. */
  mfaEnabled: boolean;
}

/**
 * Équipe d'administration (cahier L7-16) : nommer et retirer des admins
 * depuis le site, sans accès à la base.
 *
 * Les règles qui protègent la plateforme :
 *
 *   · on nomme un compte **déjà inscrit**, et seulement un compte client :
 *     un créateur ou un livreur perdrait son espace et ses dossiers ;
 *   · on ne se retire pas soi-même, et le **dernier admin** ne peut pas être
 *     retiré : sinon personne ne pourrait plus en nommer ;
 *   · toute nomination ou tout retrait **ferme les sessions** du compte : le
 *     rôle est inscrit dans le jeton, un ancien admin garderait sinon ses
 *     droits jusqu'à l'expiration de sa session ;
 *   · chaque geste est écrit au journal d'audit, avec son auteur.
 */
@Injectable()
export class AdminTeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly mfa: MfaService,
  ) {}

  async list(currentAdminId: string): Promise<AdminMember[]> {
    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN', deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        createdAt: true,
        mfaEnabledAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    return admins.map(({ mfaEnabledAt, ...admin }) => ({
      ...admin,
      createdAt: admin.createdAt.toISOString(),
      isYou: admin.id === currentAdminId,
      mfaEnabled: mfaEnabledAt !== null,
    }));
  }

  async grant(email: string, actorId: string): Promise<AdminMember> {
    const user = await this.prisma.user.findFirst({
      where: { email: email.trim().toLowerCase(), deletedAt: null },
    });
    if (!user) {
      throw new NotFoundException(
        "Aucun compte avec cette adresse. La personne doit d'abord s'inscrire sur le site.",
      );
    }
    if (user.role === 'ADMIN') {
      throw new BadRequestException('Ce compte est déjà administrateur.');
    }
    if (user.role !== 'CUSTOMER') {
      throw new BadRequestException(
        `Ce compte est ${user.role === 'MAKER' ? 'créateur' : 'livreur'} : il perdrait son espace. ` +
          'Demandez à la personne de créer un compte client avec une autre adresse.',
      );
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { role: 'ADMIN', status: 'ACTIVE' },
      }),
      this.prisma.auditLog.create({
        data: {
          actorId,
          actorRole: 'ADMIN',
          action: 'user.admin.grant',
          targetType: 'User',
          targetId: user.id,
          before: { role: user.role, status: user.status },
          after: { role: 'ADMIN', status: 'ACTIVE' },
        },
      }),
    ]);
    // Reconnexion obligatoire : la nouvelle session portera le rôle ADMIN.
    await this.tokens.revokeAllForUser(user.id);

    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      createdAt: user.createdAt.toISOString(),
      isYou: false,
      mfaEnabled: user.mfaEnabledAt !== null,
    };
  }

  async revoke(userId: string, actorId: string): Promise<{ revoked: true }> {
    if (userId === actorId) {
      throw new BadRequestException(
        'Vous ne pouvez pas retirer vos propres droits. Demandez à un autre administrateur.',
      );
    }

    const user = await this.prisma.user.findFirst({
      where: { id: userId, role: 'ADMIN', deletedAt: null },
    });
    if (!user) throw new NotFoundException('Administrateur introuvable.');

    const admins = await this.prisma.user.count({ where: { role: 'ADMIN', deletedAt: null } });
    if (admins <= 1) {
      throw new BadRequestException('Le dernier administrateur ne peut pas être retiré.');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { role: 'CUSTOMER' } }),
      this.prisma.auditLog.create({
        data: {
          actorId,
          actorRole: 'ADMIN',
          action: 'user.admin.revoke',
          targetType: 'User',
          targetId: user.id,
          before: { role: 'ADMIN' },
          after: { role: 'CUSTOMER' },
        },
      }),
    ]);
    // Effet immédiat : son jeton actuel porte encore le rôle ADMIN.
    await this.tokens.revokeAllForUser(user.id);

    return { revoked: true };
  }

  /**
   * Efface la double authentification d'un collègue qui a perdu son
   * téléphone. Jamais la sienne : sinon un mot de passe volé suffirait à
   * retirer le second facteur. Ses sessions sont fermées ; il réactivera à
   * sa prochaine connexion.
   */
  async resetMfa(userId: string, actorId: string): Promise<{ reset: true }> {
    if (userId === actorId) {
      throw new BadRequestException(
        'Vous ne pouvez pas réinitialiser votre propre double authentification. ' +
          'Utilisez un code de secours, ou demandez à un autre administrateur.',
      );
    }

    const user = await this.prisma.user.findFirst({
      where: { id: userId, role: 'ADMIN', deletedAt: null },
    });
    if (!user) throw new NotFoundException('Administrateur introuvable.');

    await this.mfa.resetFor(user.id);
    await this.prisma.auditLog.create({
      data: {
        actorId,
        actorRole: 'ADMIN',
        action: 'user.mfa.reset',
        targetType: 'User',
        targetId: user.id,
        before: { mfaEnabled: user.mfaEnabledAt !== null },
        after: { mfaEnabled: false },
      },
    });

    return { reset: true };
  }
}
