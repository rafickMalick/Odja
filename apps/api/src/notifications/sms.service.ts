import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Envoi de SMS.
 *
 * Même principe que le fournisseur de paiement : une interface, et une
 * implémentation simulée qui permet de dérouler tout le parcours sans
 * dépendre d'un contrat opérateur. En développement le code s'affiche dans les
 * journaux ; en production, brancher l'agrégateur retenu ne changera que cette
 * classe.
 */
export interface SmsMessage {
  /** Numéro au format E.164. */
  to: string;
  body: string;
}

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly isProduction: boolean;

  constructor(config: ConfigService) {
    this.isProduction = config.get<string>('NODE_ENV') === 'production';
  }

  async send(message: SmsMessage): Promise<void> {
    if (this.isProduction) {
      // Volontairement bruyant : mieux vaut une alerte qu'un OTP jamais reçu
      // et un utilisateur bloqué sans explication.
      this.logger.error(
        `Aucun agrégateur SMS branché — message vers ${maskPhone(message.to)} non envoyé`,
      );
      throw new Error('Envoi de SMS non configuré');
    }

    this.logger.log(`[SMS simulé] ${maskPhone(message.to)} — ${message.body}`);
  }
}

/** Les journaux ne portent jamais un numéro entier (cahier § 11). */
export function maskPhone(phone: string): string {
  if (phone.length <= 4) return '••••';
  return `${phone.slice(0, 4)}••••${phone.slice(-2)}`;
}
