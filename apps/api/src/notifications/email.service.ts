import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

/**
 * Envoi d'e-mails.
 *
 * Deux canaux, choisis par la configuration :
 *
 *   · **l'API HTTP de Brevo** quand `BREVO_API_KEY` est renseignée. C'est le
 *     canal de production : Render bloque, sur ses services gratuits, toute
 *     connexion sortante vers les ports SMTP (25, 465, 587) depuis septembre
 *     2025. L'API passe par HTTPS (443), qui reste ouvert ;
 *   · **SMTP** sinon. En développement, tout part vers Mailpit
 *     (http://localhost:58025) : les messages sont réellement composés et
 *     envoyés, simplement interceptés.
 *
 * Chaque envoi est **borné dans le temps**. Un relais injoignable ne répond
 * pas, il se tait : sans délai maximum, la requête qui attend l'e-mail
 * (inscription, mot de passe oublié) tournait plusieurs minutes.
 *
 * En production, une configuration absente **fait échouer l'envoi
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

/** Au-delà, on abandonne et on le dit, plutôt que de faire attendre. */
const SEND_TIMEOUT_MS = 15_000;
const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: Transporter | null;
  private readonly brevoApiKey: string | null;
  private readonly from: string;
  private readonly isProduction: boolean;

  constructor(config: ConfigService) {
    this.isProduction = config.get<string>('NODE_ENV') === 'production';
    this.from = config.get<string>('MAIL_FROM', 'Ojà <bonjour@oja.market>');
    this.brevoApiKey = config.get<string>('BREVO_API_KEY')?.trim() || null;

    const host = config.get<string>('SMTP_HOST');
    const port = config.get<number>('SMTP_PORT');

    this.transporter =
      host && !this.brevoApiKey
        ? createTransport({
            host,
            port: port ?? 1025,
            // Mailpit n'a ni TLS ni authentification ; un vrai relais en aura.
            secure: config.get<boolean>('SMTP_SECURE', false),
            connectionTimeout: 10_000,
            greetingTimeout: 10_000,
            socketTimeout: SEND_TIMEOUT_MS,
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
    if (this.brevoApiKey) {
      await this.sendWithBrevo(message, this.brevoApiKey);
    } else if (this.transporter) {
      await this.transporter.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      });
    } else {
      if (this.isProduction) {
        this.logger.error(
          `Aucun canal d'envoi configuré (BREVO_API_KEY ou SMTP_HOST) — message « ${message.subject} » non envoyé`,
        );
        throw new Error('Envoi d’e-mail non configuré');
      }
      this.logger.warn(`[e-mail non envoyé] ${message.to} — ${message.subject}`);
      return;
    }

    this.logger.log(`E-mail envoyé à ${maskEmail(message.to)} — ${message.subject}`);
  }

  /** API transactionnelle de Brevo : https://developers.brevo.com/reference/sendtransacemail */
  private async sendWithBrevo(message: EmailMessage, apiKey: string): Promise<void> {
    const response = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: parseAddress(this.from),
        to: [{ email: message.to }],
        subject: message.subject,
        textContent: message.text,
        ...(message.html ? { htmlContent: message.html } : {}),
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!response.ok) {
      // Le corps de Brevo dit pourquoi (clé invalide, expéditeur non vérifié…),
      // jamais rien de personnel : on le garde pour le journal.
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw new Error(`Brevo a refusé l'envoi (HTTP ${response.status}) : ${detail}`);
    }
  }
}

/** « Ojà <bonjour@oja.market> » → { name: 'Ojà', email: 'bonjour@oja.market' }. */
export function parseAddress(value: string): { name?: string; email: string } {
  const match = value.match(/^\s*"?([^"<]*?)"?\s*<\s*([^>]+)\s*>\s*$/);
  if (!match) return { email: value.trim() };
  const name = match[1]?.trim();
  return { ...(name ? { name } : {}), email: match[2]!.trim() };
}

/** Les journaux ne portent jamais une adresse entière (cahier § 11). */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  const visible = local.slice(0, 2);
  return `${visible}${'•'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}
