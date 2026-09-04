import { z } from 'zod';

/**
 * Notifications in-app (cahier LN-04).
 *
 * Chaque avis métier — commande reçue, colis livré, versement prêt — dépose
 * ici une ligne consultable depuis l'espace de l'utilisateur, en plus de
 * l'e-mail ou du SMS. Le `href` pointe vers l'écran du geste attendu.
 */

export const notificationsQuerySchema = z.object({
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type NotificationsQuery = z.infer<typeof notificationsQuerySchema>;

export const markNotificationsReadSchema = z.object({
  /** Sans liste, tout est marqué lu. */
  ids: z.array(z.string().trim().min(1)).max(200).optional(),
});
export type MarkNotificationsReadInput = z.infer<typeof markNotificationsReadSchema>;

export interface NotificationView {
  id: string;
  /** Nom du gabarit (`sub_order_received`…), stable, pour un affichage typé. */
  template: string;
  title: string;
  body: string;
  /** Lien relatif vers l'écran concerné. */
  href: string;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationsPage {
  items: NotificationView[];
  nextCursor: string | null;
}

export interface UnreadCount {
  count: number;
}
