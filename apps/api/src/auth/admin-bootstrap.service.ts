import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { maskEmail } from '../notifications/email.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Premier compte administrateur.
 *
 * L'inscription publique refuse le rôle ADMIN, à juste titre. Sur une base
 * neuve, il faut pourtant un premier admin, et le créer à la main suppose un
 * accès direct à la base que l'équipe n'a pas forcément. `ADMIN_BOOTSTRAP_EMAIL`
 * désigne l'adresse qui le deviendra :
 *
 *   · au démarrage de l'API, si le compte existe déjà ;
 *   · à l'inscription, si le compte est créé après coup.
 *
 * Le garde-fou : **rien ne se passe dès qu'un admin existe**. La variable ne
 * sert qu'une fois, sur une base qui n'a encore personne pour administrer ;
 * oubliée sur Render, elle ne permet pas d'en fabriquer un second. Les admins
 * suivants se nomment depuis la base, comme avant.
 */
@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminBootstrapService.name);
  private readonly email: string | null;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const raw = config.get<string>('ADMIN_BOOTSTRAP_EMAIL')?.trim().toLowerCase();
    this.email = raw ? raw : null;
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.email) return;
    const user = await this.prisma.user.findFirst({
      where: { email: this.email, deletedAt: null },
      select: { id: true, email: true },
    });
    if (!user) {
      this.logger.log(
        `ADMIN_BOOTSTRAP_EMAIL : aucun compte ${maskEmail(this.email)} pour l'instant, il sera promu à son inscription`,
      );
      return;
    }
    await this.promoteIfDesignated(user.id, user.email);
  }

  /**
   * Promeut le compte s'il est celui désigné et qu'aucun admin n'existe.
   * Renvoie vrai si la promotion a eu lieu.
   */
  async promoteIfDesignated(userId: string, email: string): Promise<boolean> {
    if (!this.email || email.trim().toLowerCase() !== this.email) return false;

    const admins = await this.prisma.user.count({ where: { role: 'ADMIN', deletedAt: null } });
    if (admins > 0) {
      this.logger.log('ADMIN_BOOTSTRAP_EMAIL ignorée : un administrateur existe déjà');
      return false;
    }

    const before = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { role: true, status: true },
    });

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { role: 'ADMIN', status: 'ACTIVE' },
      }),
      this.prisma.auditLog.create({
        data: {
          actorId: null,
          actorRole: null,
          action: 'user.admin.bootstrap',
          targetType: 'User',
          targetId: userId,
          before,
          after: { role: 'ADMIN', status: 'ACTIVE' },
        },
      }),
    ]);

    this.logger.warn(`Premier administrateur créé : ${maskEmail(email)} (ADMIN_BOOTSTRAP_EMAIL)`);
    return true;
  }
}
