import { z } from 'zod';

/**
 * Service client : demandes (tickets) et fil de discussion.
 *
 * Chaque espace a ses propres types de problème. Les clés sont stables (elles
 * sont stockées en base) ; les libellés, eux, peuvent évoluer.
 */

export const CUSTOMER_TICKET_CATEGORIES = {
  livraison: 'Livraison',
  paiement: 'Paiement',
  remboursement: 'Remboursement',
  non_conforme: 'Produit non conforme',
  compte: 'Mon compte',
  autre: 'Autre',
} as const;

export const MAKER_TICKET_CATEGORIES = {
  paiements_retraits: 'Paiements et retraits',
  produits_validation: 'Produits et validation',
  commandes_recues: 'Commandes reçues',
  litige_acheteur: 'Litige avec un acheteur',
  compte_boutique: 'Compte et boutique',
  autre: 'Autre',
} as const;

/** Formulaire de contact public : questions sans lien avec un compte. */
export const CONTACT_TICKET_CATEGORIES = {
  question_generale: 'Question générale',
  partenariat: 'Partenariat',
  signalement: 'Signalement',
  autre: 'Autre',
} as const;

export type CustomerTicketCategory = keyof typeof CUSTOMER_TICKET_CATEGORIES;
export type MakerTicketCategory = keyof typeof MAKER_TICKET_CATEGORIES;
export type ContactTicketCategory = keyof typeof CONTACT_TICKET_CATEGORIES;

/** Tous les libellés, pour l'écran d'administration qui voit tous les espaces. */
export const TICKET_CATEGORY_LABELS: Readonly<Record<string, string>> = {
  ...CONTACT_TICKET_CATEGORIES,
  ...MAKER_TICKET_CATEGORIES,
  ...CUSTOMER_TICKET_CATEGORIES,
};

export const ticketStatusSchema = z.enum([
  'OPEN',
  'IN_PROGRESS',
  'WAITING_CUSTOMER',
  'RESOLVED',
  'CLOSED',
]);
export type TicketStatus = z.infer<typeof ticketStatusSchema>;

export const TICKET_STATUS_LABELS: Readonly<Record<TicketStatus, string>> = {
  OPEN: 'Ouvert',
  IN_PROGRESS: 'En cours',
  WAITING_CUSTOMER: 'En attente de votre réponse',
  RESOLVED: 'Résolu',
  CLOSED: 'Fermé',
};

export const ticketPrioritySchema = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);
export type TicketPriority = z.infer<typeof ticketPrioritySchema>;

export const TICKET_PRIORITY_LABELS: Readonly<Record<TicketPriority, string>> = {
  LOW: 'Basse',
  NORMAL: 'Normale',
  HIGH: 'Haute',
  URGENT: 'Urgente',
};

const fileKeysSchema = z.array(z.string().trim().min(1).max(300)).max(5).default([]);

/** Nouvelle demande depuis un espace connecté. La catégorie est validée selon le rôle. */
export const createTicketSchema = z.object({
  category: z.string().trim().min(1, 'Choisissez un type de problème').max(40),
  subject: z.string().trim().min(4, 'Résumez votre demande').max(140),
  message: z.string().trim().min(10, 'Décrivez votre demande').max(5_000),
  /** Commande concernée, facultative (espace acheteur). */
  orderReference: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((value) => value || undefined),
  fileKeys: fileKeysSchema,
});
export type CreateTicketInput = z.input<typeof createTicketSchema>;

/**
 * Formulaire de contact public : visiteur, inscrit ou non.
 *
 * `website` est un **piège à robots** (honeypot) : invisible pour un humain,
 * il est rempli par les robots qui complètent tous les champs d'un formulaire.
 * Le schéma l'accepte pour que la requête paraisse aboutir ; c'est l'API qui
 * décide de l'ignorer.
 */
export const contactMessageSchema = z.object({
  name: z.string().trim().min(2, 'Indiquez votre nom').max(80),
  email: z.string().trim().toLowerCase().email('Adresse e-mail invalide').max(180),
  category: z.enum(
    Object.keys(CONTACT_TICKET_CATEGORIES) as [ContactTicketCategory, ...ContactTicketCategory[]],
    { errorMap: () => ({ message: 'Choisissez un sujet' }) },
  ),
  message: z
    .string()
    .trim()
    .min(10, 'Votre message est trop court')
    .max(5_000, 'Votre message est trop long (5 000 caractères au plus)'),
  website: z.string().max(200).optional(),
});
export type ContactMessageInput = z.input<typeof contactMessageSchema>;

/** Réponse au formulaire public. */
export interface ContactReceipt {
  /** Référence à rappeler au service client. */
  reference: string;
}

export const ticketMessageSchema = z.object({
  body: z.string().trim().min(1, 'Message vide').max(5_000),
  fileKeys: fileKeysSchema,
});
export type TicketMessageInput = z.input<typeof ticketMessageSchema>;

/** Réponse du service client : publique, ou note interne invisible du client. */
export const adminTicketMessageSchema = ticketMessageSchema.extend({
  internal: z.boolean().default(false),
});
export type AdminTicketMessageInput = z.input<typeof adminTicketMessageSchema>;

export const updateTicketSchema = z
  .object({
    status: ticketStatusSchema.optional(),
    priority: ticketPrioritySchema.optional(),
  })
  .refine((input) => input.status !== undefined || input.priority !== undefined, {
    message: 'Rien à modifier',
  });
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;

export const myTicketsQuerySchema = z.object({
  status: ticketStatusSchema.optional(),
});

export const adminTicketsQuerySchema = z.object({
  status: ticketStatusSchema.optional(),
  priority: ticketPrioritySchema.optional(),
  category: z.string().trim().max(40).optional(),
  /** Rôle de l'auteur, ou GUEST pour un visiteur non inscrit. */
  role: z.enum(['CUSTOMER', 'MAKER', 'COURIER', 'GUEST']).optional(),
  /** Référence, sujet, nom ou e-mail. */
  q: z.string().trim().max(120).optional(),
});
export type AdminTicketsQuery = z.infer<typeof adminTicketsQuerySchema>;

export interface TicketMessageView {
  id: string;
  fromStaff: boolean;
  /** Toujours faux côté client : ses routes ne renvoient jamais les notes internes. */
  internal: boolean;
  body: string;
  fileKeys: string[];
  createdAt: string;
}

export interface TicketSummaryView {
  reference: string;
  category: string;
  categoryLabel: string;
  subject: string;
  status: TicketStatus;
  statusLabel: string;
  priority: TicketPriority;
  orderReference: string | null;
  createdAt: string;
  lastMessageAt: string;
}

export interface TicketView extends TicketSummaryView {
  messages: TicketMessageView[];
}

export interface AdminTicketSummaryView extends TicketSummaryView {
  channel: 'ACCOUNT' | 'CONTACT_FORM';
  /** CUSTOMER, MAKER… ou null pour un visiteur. */
  authorRole: string | null;
  authorName: string;
  authorEmail: string;
  /** Le formulaire public venait d'un visiteur non inscrit (ou relié après coup). */
  isGuest: boolean;
}

export interface AdminTicketView extends AdminTicketSummaryView {
  userId: string | null;
  messages: TicketMessageView[];
}
