import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

/**
 * Envoi d'e-mails.
 *
 * En développement, tout part vers Mailpit (http://localhost:58025) : les
 * messages sont réellement composés et envoyés, simplement interceptés. C'est
 * mieux qu'un journal — on voit le rendu, les en-têtes et les liens tels que
 * le destinataire les recevra.
 *
 * En production, une configuration SMTP absente **fait échouer l'envoi
 * bruyamment** plutôt que de l'avaler : un e-mail de vérification jamais parti
 * bloque un compte, et personne ne le saurait.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  /** Corps en texte brut. Toujours fourni : certains clients n'affichent que lui. */
  text: string;
  html?: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;
  private readonly isProduction: boolean;

  constructor(config: ConfigService) {
    this.isProduction = config.get<string>('NODE_ENV') === 'production';
    this.from = config.get<string>('MAIL_FROM', 'Ojà <bonjour@oja.market>');

    const host = config.get<string>('SMTP_HOST');
    const port = config.get<number>('SMTP_PORT');

    this.transporter = host
      ? createTransport({
          host,
          port: port ?? 1025,
          // Mailpit n'a ni TLS ni authentification ; un vrai relais en aura.
          secure: config.get<boolean>('SMTP_SECURE', false),
          ...(config.get<string>('SMTP_USER')
            ? {
                auth: {
                  user: config.getOrThrow<string>('SMTP_USER'),
                  pass: config.getOrThrow<string>('SMTP_PASSWORD'),
                },
              }
            : {}),
        })
      : null;
  }

  async send(message: EmailMessage): Promise<void> {
    if (!this.transporter) {
      if (this.isProduction) {
        this.logger.error(
          `Aucun relais SMTP configuré — message « ${message.subject} » non envoyé`,
        );
        throw new Error('Envoi d’e-mail non configuré');
      }
      this.logger.warn(`[e-mail non envoyé] ${message.to} — ${message.subject}`);
      return;
    }

    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    });

    this.logger.log(`E-mail envoyé à ${maskEmail(message.to)} — ${message.subject}`);
  }
}

/** Les journaux ne portent jamais une adresse entière (cahier § 11). */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  const visible = local.slice(0, 2);
  return `${visible}${'•'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}
