import { z } from 'zod';

/**
 * Inscription à la newsletter, depuis le pied de page.
 *
 * Même piège à robots que le formulaire de contact : `website` est invisible
 * pour un humain ; rempli, la requête « réussit » sans rien enregistrer.
 */
export const newsletterSubscribeSchema = z.object({
  email: z.string().trim().toLowerCase().email('Adresse e-mail invalide').max(180),
  website: z.string().max(200).optional(),
});
export type NewsletterSubscribeInput = z.input<typeof newsletterSubscribeSchema>;

/**
 * Réponse identique que l'adresse soit nouvelle ou déjà inscrite : le
 * formulaire ne doit pas servir à savoir qui est abonné.
 */
export interface NewsletterReceipt {
  subscribed: true;
}
