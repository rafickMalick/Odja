import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EmailService } from '../notifications/email.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Vérification d'adresse e-mail, par lien.
 *
 * Un lien, pas un code à six chiffres : le destinataire clique, il ne recopie
 * rien. Puisqu'il n'y a rien à taper, le jeton peut être long — 32 octets
 * aléatoires plutôt que 10⁶ combinaisons devinables. La protection est
 * gratuite, autant la prendre.
 *
 * Le jeton est **haché en base**, comme les OTP : une fuite de la table ne
 * doit pas donner un accès immédiat aux comptes en attente.
 */

const TTL_HOURS = 24;

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);
  private readonly webOrigin: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    config: ConfigService,
  ) {
    this.webOrigin = config.get<string>('WEB_ORIGIN', 'http://localhost:3000');
  }

  async sendVerification(userId: string, address: string, firstName: string): Promise<void> {
    // Un nouveau lien invalide les précédents : deux liens valides en même
    // temps doublent la surface d'attaque sans rien apporter.
    await this.prisma.verificationToken.updateMany({
      where: { userId, purpose: 'EMAIL_VERIFICATION', consumedAt: null },
      data: { consumedAt: new Date() },
    });

    const token = randomBytes(32).toString('base64url');

    await this.prisma.verificationToken.create({
      data: {
        userId,
        purpose: 'EMAIL_VERIFICATION',
        codeHash: hash(token),
        expiresAt: new Date(Date.now() + TTL_HOURS * 3_600_000),
        // Un lien ne se devine pas : le compteur de tentatives n'a pas d'objet.
        maxAttempts: 1_000,
      },
    });

    const link = `${this.webOrigin}/verifier-email?jeton=${token}`;

    /* L'envoi part **sans être attendu**. Le lien existe déjà en base ; le
       compte, lui, s'ouvre sans attendre la confirmation. Attendre le relais
       faisait tourner l'inscription sans fin quand il ne répondait pas. Un
       échec est journalisé, et « Renvoyer le lien » reste possible. */
    const message = {
      to: address,
      subject: 'Ojà — confirmez votre adresse e-mail',
      text: [
        `Bonjour ${firstName},`,
        '',
        'Confirmez votre adresse e-mail pour finaliser votre inscription sur Ojà :',
        link,
        '',
        `Ce lien est valable ${TTL_HOURS} heures.`,
        "Si vous n'êtes pas à l'origine de cette inscription, ignorez ce message.",
        '',
        'L’équipe Ojà',
      ].join('\n'),
      html: [
        `<p>Bonjour ${escapeHtml(firstName)},</p>`,
        '<p>Confirmez votre adresse e-mail pour finaliser votre inscription sur Ojà :</p>',
        `<p><a href="${link}">Confirmer mon adresse</a></p>`,
        `<p style="color:#6B6B6B;font-size:14px">Ce lien est valable ${TTL_HOURS} heures. ` +
          "Si vous n'êtes pas à l'origine de cette inscription, ignorez ce message.</p>",
      ].join(''),
    };

    void this.email
      .send(message)
      .catch((error: unknown) => {
        this.logger.error(
          `Lien de vérification non envoyé (utilisateur ${userId}) : ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }

  /**
   * Consomme un lien de vérification.
   *
   * On cherche par empreinte, pas par utilisateur : le lien porte à lui seul
   * l'identité de ce qu'il vérifie. Cela évite de demander au visiteur qui il
   * est avant de cliquer.
   */
  async verify(token: string): Promise<{ userId: string }> {
    const record = await this.prisma.verificationToken.findFirst({
      where: { purpose: 'EMAIL_VERIFICATION', consumedAt: null, codeHash: hash(token) },
      orderBy: { createdAt: 'desc' },
    });

    // Même message pour un lien inconnu et un lien expiré : la distinction
    // n'aiderait que quelqu'un qui essaie des jetons au hasard.
    if (!record || record.expiresAt < new Date()) {
      throw new BadRequestException('Ce lien est invalide ou a expiré. Demandez-en un nouveau.');
    }

    // Comparaison à temps constant, par principe : le jeton est déjà retrouvé
    // par empreinte, mais rien ne justifie d'ouvrir une différence de temps.
    if (!constantTimeEquals(record.codeHash, hash(token))) {
      throw new BadRequestException('Ce lien est invalide ou a expiré.');
    }

    await this.prisma.$transaction([
      this.prisma.verificationToken.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: new Date() },
      }),
    ]);

    this.logger.log(`Adresse e-mail vérifiée pour ${record.userId}`);
    return { userId: record.userId };
  }

  /** Renvoi d'un lien. Silencieux si l'adresse est inconnue ou déjà vérifiée. */
  async resend(address: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { email: address.toLowerCase(), deletedAt: null, emailVerifiedAt: null },
      select: { id: true, email: true, firstName: true },
    });
    if (!user) return;

    await this.sendVerification(user.id, user.email, user.firstName);
  }
}

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return map[char] ?? char;
  });
}
