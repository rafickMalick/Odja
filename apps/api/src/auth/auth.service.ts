import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { phoneVariants, type PublicUser, type RegisterInput } from '@oja/contracts';
import type { User } from '@oja/db';

import { EmailService } from '../notifications/email.service';
import { SmsService } from '../notifications/sms.service';
import { AdminBootstrapService } from './admin-bootstrap.service';
import { EmailVerificationService } from './email-verification.service';
import { MfaService } from './mfa.service';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from './otp.service';
import { PasswordService } from './password.service';
import { TokenService, type IssuedTokens } from './token.service';

/**
 * Parcours d'authentification.
 *
 * Principe qui traverse tout le fichier : **une réponse ne doit pas apprendre
 * à un inconnu si un compte existe.** Ni l'inscription, ni la connexion, ni la
 * demande de réinitialisation ne distinguent « adresse inconnue » de
 * « mot de passe faux ». C'est ce qui empêche d'énumérer la base de clients.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly termsVersions: Record<string, string> = {
    CUSTOMER: 'cgu-client',
    MAKER: 'cgu-createur',
    COURIER: 'cgu-livreur',
  };

  /**
   * Vérification du téléphone par SMS.
   *
   * Mise de côté pour l'instant : le compte s'ouvre à l'e-mail, ce qui évite
   * de payer un SMS pour chaque visiteur curieux — et la plupart ne
   * commanderont jamais. Toute la machinerie OTP reste en place et se
   * réactive en passant ce réglage à `true`.
   *
   * Quand elle reviendra, le bon moment sera la **première commande** : c'est
   * là que le numéro prend une valeur opérationnelle, puisque c'est celui que
   * le livreur appellera.
   */
  private readonly requirePhoneVerification: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly otp: OtpService,
    private readonly sms: SmsService,
    private readonly mail: EmailService,
    private readonly emailVerification: EmailVerificationService,
    private readonly adminBootstrap: AdminBootstrapService,
    private readonly mfa: MfaService,
    config: ConfigService,
  ) {
    this.requirePhoneVerification = config.get<boolean>('REQUIRE_PHONE_VERIFICATION', false);
  }

  async register(
    input: RegisterInput,
    context: { userAgent?: string; ip?: string } = {},
  ): Promise<{ tokens: IssuedTokens | null; user: PublicUser | null; pendingPhone: boolean }> {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: input.email }, { phone: { in: phoneVariants(input.phone) } }], deletedAt: null },
      select: { id: true, phoneVerifiedAt: true },
    });

    if (existing) {
      if (this.requirePhoneVerification) {
        /* Parcours SMS : on ne dit pas qu'un compte existe — la réponse est
           la même dans tous les cas, et un compte non vérifié reçoit
           simplement un nouveau code. */
        if (!existing.phoneVerifiedAt) {
          await this.sendPhoneCode(existing.id, input.phone);
        }
        return { tokens: null, user: null, pendingPhone: true };
      }

      /* Parcours e-mail : on refuse franchement.
       *
       * Arbitrage assumé. Répondre « regardez vos e-mails » quoi qu'il arrive
       * protégerait mieux contre l'énumération des comptes, mais obligerait
       * tout nouveau visiteur à quitter le site avant de pouvoir s'en servir.
       * Sur une place de marché grand public, savoir qu'une adresse a un
       * compte est un renseignement de faible valeur ; la friction, elle, se
       * paie à chaque inscription. */
      throw new ConflictException(
        'Un compte existe déjà avec cette adresse ou ce numéro. Connectez-vous.',
      );
    }

    const passwordHash = await this.passwords.hash(input.password);

    const created = await this.prisma.user.create({
      data: {
        role: input.role,
        /* Un client est actif tout de suite : il peut parcourir, remplir son
           panier et commander. Un créateur et un livreur restent en attente —
           leur dossier passe devant l'administration avant toute activité. */
        status: input.role === 'CUSTOMER' && !this.requirePhoneVerification ? 'ACTIVE' : 'PENDING',
        email: input.email,
        phone: input.phone,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        termsAcceptance: {
          create: {
            documentId: this.termsVersions[input.role] ?? 'cgu-client',
            version: input.acceptedTermsVersion,
          },
        },
      },
    });

    /* Premier admin d'une base neuve (ADMIN_BOOTSTRAP_EMAIL) : promu dès
       l'inscription, pour que la session émise porte déjà le bon rôle. */
    const user = (await this.adminBootstrap.promoteIfDesignated(created.id, created.email))
      ? await this.prisma.user.findUniqueOrThrow({ where: { id: created.id } })
      : created;

    if (this.requirePhoneVerification) {
      await this.sendPhoneCode(user.id, input.phone);
      return { tokens: null, user: null, pendingPhone: true };
    }

    /* Le lien de confirmation est créé à l'inscription, et l'e-mail part sans
       être attendu (EmailVerificationService) : il n'arrête personne, et le
       compte est utilisable tout de suite.

       Il avait été désactivé parce qu'il bloquait l'inscription en ligne
       (Render ferme les ports SMTP du plan gratuit). Depuis que l'envoi n'est
       plus attendu, ce blocage n'existe plus. Tant que l'expéditeur Brevo
       n'est pas configuré, l'envoi échoue en silence (une ligne dans les
       journaux) ; le lien reste en base et « Renvoyer le lien » fonctionnera
       dès que l'expéditeur le sera. */
    await this.emailVerification.sendVerification(user.id, user.email, user.firstName);

    const tokens = await this.tokens.issue(user, context);
    return { tokens, user: toPublicUser(user), pendingPhone: false };
  }

  async verifyPhone(
    phone: string,
    code: string,
    context: { userAgent?: string; ip?: string },
  ): Promise<{ tokens: IssuedTokens; user: PublicUser }> {
    const user = await this.prisma.user.findFirst({
      where: { phone, deletedAt: null },
    });

    // Même message et même statut qu'un code erroné : sinon la réponse dit
    // si le numéro est connu.
    if (!user) throw new BadRequestException('Code invalide ou expiré.');

    const result = await this.otp.verify(user.id, 'PHONE_VERIFICATION', code);
    if (!result.ok) {
      if (result.reason === 'too_many_attempts') {
        throw new BadRequestException(
          'Trop de tentatives. Demandez un nouveau code.',
        );
      }
      throw new BadRequestException('Code invalide ou expiré.');
    }

    /* Le téléphone vérifié suffit à activer un CLIENT. Un CRÉATEUR et un
       LIVREUR restent en attente : leur dossier doit être validé par
       l'administration avant toute activité (cahier client). */
    const activated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        phoneVerifiedAt: new Date(),
        status: user.role === 'CUSTOMER' ? 'ACTIVE' : 'PENDING',
      },
    });

    const tokens = await this.tokens.issue(activated, context);
    return { tokens, user: toPublicUser(activated) };
  }

  async resendPhoneCode(phone: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { phone, deletedAt: null, phoneVerifiedAt: null },
      select: { id: true },
    });
    // Silence si le numéro est inconnu ou déjà vérifié : la réponse de
    // l'endpoint est la même dans tous les cas.
    if (user) await this.sendPhoneCode(user.id, phone);
  }

  async login(
    identifier: string,
    password: string,
    context: { userAgent?: string; ip?: string },
  ): Promise<{ tokens: IssuedTokens; user: PublicUser } | { mfaChallenge: string }> {
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: identifier.toLowerCase() }, { phone: { in: [identifier, ...phoneVariants(identifier)] } }],
        deletedAt: null,
      },
    });

    /* Compte inconnu : on consomme quand même le temps d'une vérification.
       Sans cela, une réponse immédiate trahirait l'absence de compte là où
       une vérification argon2 prend ~50 ms — l'écart suffit à énumérer la
       base de clients depuis l'extérieur. */
    if (!user) {
      await this.passwords.burnTime(password);
      throw new UnauthorizedException('Identifiants incorrects.');
    }

    if (!user.passwordHash) {
      await this.passwords.burnTime(password);
      throw new UnauthorizedException('Identifiants incorrects.');
    }

    const valid = await this.passwords.verify(user.passwordHash, password);
    if (!valid) throw new UnauthorizedException('Identifiants incorrects.');

    if (user.status === 'SUSPENDED' || user.status === 'REJECTED') {
      throw new UnauthorizedException('Ce compte est suspendu. Contactez le support.');
    }

    if (this.requirePhoneVerification && !user.phoneVerifiedAt) {
      await this.sendPhoneCode(user.id, user.phone);
      throw new UnauthorizedException(
        'Numéro non vérifié. Un nouveau code vient de vous être envoyé.',
      );
    }

    // Les paramètres d'argon2 ont pu durcir depuis la création du compte :
    // on rehache en silence plutôt que d'imposer un changement de mot de passe.
    if (user.passwordHash && this.passwords.needsRehash(user.passwordHash)) {
      const passwordHash = await this.passwords.hash(password);
      await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    }

    /* Double authentification : le mot de passe ne suffit plus. Pas de
       session, un défi de cinq minutes que seul le code transforme en
       session (completeMfaLogin). */
    if (user.mfaEnabledAt) {
      return { mfaChallenge: await this.mfa.createChallenge(user.id) };
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await this.tokens.issue(user, context);
    return { tokens, user: toPublicUser(user) };
  }

  /** Seconde étape de la connexion : le défi et le code ouvrent la session. */
  async completeMfaLogin(
    challenge: string,
    code: string,
    context: { userAgent?: string; ip?: string },
  ): Promise<{ tokens: IssuedTokens; user: PublicUser }> {
    const userId = await this.mfa.readChallenge(challenge);

    if (!(await this.mfa.verifyCode(userId, code))) {
      throw new UnauthorizedException('Code incorrect.');
    }

    // Le compte a pu être suspendu pendant les cinq minutes du défi.
    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user || user.status === 'SUSPENDED' || user.status === 'REJECTED') {
      throw new UnauthorizedException('Ce compte est suspendu. Contactez le support.');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await this.tokens.issue(user, context, { mfaVerifiedAt: new Date() });
    return { tokens, user: toPublicUser(user) };
  }

  async refresh(
    refreshToken: string,
    context: { userAgent?: string; ip?: string },
  ): Promise<IssuedTokens> {
    return this.tokens.rotate(refreshToken, context);
  }

  async logout(sessionId: string): Promise<void> {
    await this.tokens.revokeSession(sessionId);
  }

  async logoutEverywhere(userId: string): Promise<number> {
    return this.tokens.revokeAllForUser(userId);
  }

  async forgotPassword(identifier: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: identifier.toLowerCase() }, { phone: { in: [identifier, ...phoneVariants(identifier)] } }],
        deletedAt: null,
      },
      select: { id: true, phone: true, email: true, firstName: true },
    });

    // Réponse identique que le compte existe ou non.
    if (!user) return;

    const { code } = await this.otp.issue(user.id, 'PASSWORD_RESET');

    /* Le code part par e-mail : c'est le canal qui ouvre le compte, c'est
       celui qui doit permettre de le récupérer. Le SMS ne s'y ajoute que si
       la vérification par téléphone est activée — sinon rien ne garantit que
       le numéro soit joignable. */
    await this.mail.send({
      to: user.email,
      subject: 'Ojà — réinitialisation de votre mot de passe',
      text: [
        `Bonjour ${user.firstName},`,
        '',
        `Votre code de réinitialisation : ${code}`,
        'Il est valable 10 minutes.',
        '',
        "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : ",
        "votre mot de passe reste inchangé.",
      ].join('\n'),
    });

    if (this.requirePhoneVerification) {
      await this.sms.send({
        to: user.phone,
        body: `Ojà — code de réinitialisation : ${code}. Valable 10 minutes.`,
      });
    }
  }

  async resetPassword(identifier: string, code: string, password: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: identifier.toLowerCase() }, { phone: { in: [identifier, ...phoneVariants(identifier)] } }],
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!user) throw new BadRequestException('Code invalide ou expiré.');

    const result = await this.otp.verify(user.id, 'PASSWORD_RESET', code);
    if (!result.ok) throw new BadRequestException('Code invalide ou expiré.');

    const passwordHash = await this.passwords.hash(password);
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

    /* Un mot de passe change parce qu'on le croit compromis. Toutes les
       sessions ouvertes tombent — sinon l'intrus garde son accès. */
    const revoked = await this.tokens.revokeAllForUser(user.id);
    this.logger.log(`Mot de passe réinitialisé, ${revoked} session(s) fermée(s)`);
  }

  /**
   * Modification de son propre nom.
   *
   * L'e-mail et le téléphone en sont volontairement absents : ce sont les
   * identifiants de connexion, et les changer suppose de vérifier le nouveau
   * canal **avant** d'abandonner l'ancien, sous peine de laisser un compte
   * sans porte d'entrée. C'est un parcours à écrire, pas un champ à ajouter.
   */
  async updateProfile(
    userId: string,
    input: { firstName?: string | undefined; lastName?: string | undefined },
  ): Promise<PublicUser> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
        ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
      },
    });
    return toPublicUser(user);
  }

  /**
   * Changement de mot de passe par un utilisateur connecté.
   *
   * L'ancien mot de passe est exigé, et la session courante survit seule : on
   * ferme les autres. Sans l'ancien mot de passe, un cookie volé suffirait à
   * verrouiller le propriétaire hors de son compte ; en fermant tout, on
   * déconnecterait celui qui vient précisément de sécuriser son accès.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    password: string,
  ): Promise<{ revoked: number }> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
    });
    if (!user) throw new UnauthorizedException('Compte introuvable.');
    if (!user.passwordHash) {
      throw new BadRequestException('Mot de passe actuel incorrect.');
    }

    const valid = await this.passwords.verify(user.passwordHash, currentPassword);
    if (!valid) {
      throw new BadRequestException('Mot de passe actuel incorrect.');
    }

    const passwordHash = await this.passwords.hash(password);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });

    const revoked = await this.tokens.revokeAllForUser(userId);
    this.logger.log(`Mot de passe changé, ${revoked} session(s) fermée(s)`);
    return { revoked };
  }

  /**
   * Réémet une session pour un utilisateur déjà authentifié.
   *
   * Utilisée après un changement de mot de passe : on ferme toutes les
   * sessions, puis on en rouvre une seule — celle du navigateur qui vient de
   * faire le changement. Sans cela, sécuriser son compte reviendrait à s'en
   * faire éjecter, ce que personne ne fait deux fois.
   */
  async reissueSession(
    userId: string,
    context: { userAgent?: string; ip?: string },
    /** La session remplacée avait été ouverte avec le second facteur. */
    mfaVerified = false,
  ): Promise<IssuedTokens> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user) throw new UnauthorizedException('Compte introuvable.');
    return this.tokens.issue(user, context, mfaVerified ? { mfaVerifiedAt: new Date() } : {});
  }

  async currentUser(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user) throw new UnauthorizedException('Compte introuvable.');
    return toPublicUser(user);
  }

  private async sendPhoneCode(userId: string, phone: string): Promise<void> {
    const { code } = await this.otp.issue(userId, 'PHONE_VERIFICATION');
    await this.sms.send({
      to: phone,
      body: `Ojà — votre code de vérification : ${code}. Valable 10 minutes.`,
    });
  }
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    role: user.role,
    status: user.status,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone,
    phoneVerified: user.phoneVerifiedAt !== null,
    emailVerified: user.emailVerifiedAt !== null,
    mfaEnabled: user.mfaEnabledAt !== null,
  };
}
