/**
 * Registre des gabarits de notification (cahier LN-01).
 *
 * Chaque avis métier porte un **nom stable** (`sub_order_received`) et une
 * **version**. Le nom sert de clé partout — journal, filtre, statistiques ; la
 * version est figée sur la ligne `Notification` au moment de l'envoi, si bien
 * qu'un gabarit qui évolue n'efface pas la lecture de l'historique.
 *
 * Le registre est la source unique de trois choses :
 *
 *   · les **canaux** sur lesquels l'avis part (`email`, `sms`, `inapp`) ;
 *   · la **version** courante du gabarit ;
 *   · le rendu **in-app** — un titre court, un corps d'une ligne, un lien
 *     direct vers le geste attendu. Les corps d'e-mail restent composés dans
 *     `NotificationService` : ils sont longs, situés, et n'ont pas vocation à
 *     tenir dans une cellule de tableau.
 *
 * Ajouter un avis = ajouter une entrée ici. Un nom absent du registre est une
 * erreur de programmation, pas une donnée.
 */

export type NotificationChannel = 'email' | 'sms' | 'inapp';

export interface InAppRender {
  /** Titre court, sans ponctuation finale. */
  title: string;
  /** Une phrase : ce qui vient de se passer et ce qu'on attend. */
  body: string;
  /** Lien relatif vers l'écran du geste. */
  href: string;
}

export interface NotificationTemplate<Data> {
  version: number;
  channels: NotificationChannel[];
  inapp: (data: Data) => InAppRender;
}

/** Formatte un montant XOF comme le reste de l'application (§ 11). */
export function money(amountXof: number): string {
  return `${amountXof.toLocaleString('fr-FR').replace(/ | /g, ' ')} F CFA`;
}

/* ── Données attendues par chaque gabarit ──
   Volontairement plates : ce sont les champs strictement nécessaires au rendu
   in-app, pas le modèle Prisma. Le service les extrait avant d'appeler. */

/** Avis composé par l'appelant : un titre, une phrase, un lien. */
export interface Notice {
  title: string;
  body: string;
  href: string;
}

export interface SubOrderRef {
  orderReference: string;
  shopName: string;
}

export const NOTIFICATION_TEMPLATES = {
  sub_order_received: {
    version: 1,
    channels: ['email', 'inapp'],
    inapp: (d: SubOrderRef & { amountXof: number }) => ({
      title: 'Nouvelle commande',
      body: `Commande ${d.orderReference} à accepter sous 48 h — votre part : ${money(d.amountXof)}.`,
      href: '/espace-createur/commandes',
    }),
  } satisfies NotificationTemplate<SubOrderRef & { amountXof: number }>,

  sub_order_reminder: {
    version: 1,
    channels: ['email', 'sms', 'inapp'],
    inapp: (d: SubOrderRef & { hoursLeft: number }) => ({
      title: 'Commande en attente de réponse',
      body: `Il vous reste ${d.hoursLeft} h pour accepter ou refuser ${d.orderReference}. Sans réponse, elle est annulée.`,
      href: '/espace-createur/commandes',
    }),
  } satisfies NotificationTemplate<SubOrderRef & { hoursLeft: number }>,

  sub_order_rejected: {
    version: 1,
    channels: ['email', 'inapp'],
    inapp: (d: SubOrderRef & { reason: string }) => ({
      title: 'Une partie de votre commande est annulée',
      body: `${d.shopName} n'a pas pu honorer ${d.orderReference} : ${d.reason}. Le prix des pièces concernées vous est remboursé.`,
      href: `/compte/commandes/${d.orderReference}`,
    }),
  } satisfies NotificationTemplate<SubOrderRef & { reason: string }>,

  sub_order_ready_for_pickup: {
    version: 1,
    channels: ['email', 'inapp'],
    inapp: (d: SubOrderRef) => ({
      title: 'Votre commande est prête',
      body: `${d.shopName} a terminé votre commande ${d.orderReference}. Un livreur va venir l'enlever.`,
      href: `/compte/commandes/${d.orderReference}`,
    }),
  } satisfies NotificationTemplate<SubOrderRef>,

  courier_offer: {
    version: 1,
    channels: ['inapp'],
    inapp: (d: { shipmentReference: string; pickupLine1: string; distanceKm: number }) => ({
      title: 'Nouvelle course disponible',
      body: `Course ${d.shipmentReference} à prendre — enlèvement ${d.pickupLine1}, ~${d.distanceKm.toFixed(1)} km.`,
      href: '/espace-livreur/missions',
    }),
  } satisfies NotificationTemplate<{ shipmentReference: string; pickupLine1: string; distanceKm: number }>,

  shipment_assigned: {
    version: 1,
    channels: ['email', 'sms', 'inapp'],
    inapp: (d: { shipmentReference: string; pickupLine1: string; distanceKm: number }) => ({
      title: 'Nouvelle mission',
      body: `Course ${d.shipmentReference} vous est affectée — enlèvement ${d.pickupLine1}, ~${d.distanceKm.toFixed(1)} km.`,
      href: `/espace-livreur/missions/${d.shipmentReference}`,
    }),
  } satisfies NotificationTemplate<{ shipmentReference: string; pickupLine1: string; distanceKm: number }>,

  sub_order_delivered: {
    version: 1,
    channels: ['email', 'inapp'],
    inapp: (d: SubOrderRef) => ({
      title: 'Votre colis est arrivé',
      body: `Votre commande chez ${d.shopName} (${d.orderReference}) vient d'être remise. Validez la réception ou signalez un problème.`,
      href: `/compte/commandes/${d.orderReference}`,
    }),
  } satisfies NotificationTemplate<SubOrderRef>,

  sub_order_validated: {
    version: 1,
    channels: ['email', 'inapp'],
    inapp: (d: SubOrderRef & { amountXof: number }) => ({
      title: 'Réception validée',
      body: `Le client a confirmé ${d.orderReference}. Votre versement de ${money(d.amountXof)} est programmé sous 24 h.`,
      href: '/espace-createur/portefeuille',
    }),
  } satisfies NotificationTemplate<SubOrderRef & { amountXof: number }>,

  payout_released: {
    version: 1,
    channels: ['inapp'],
    inapp: (d: { amountXof: number; role: 'MAKER' | 'COURIER' }) => ({
      title: 'Versement prêt',
      body: `Votre versement de ${money(d.amountXof)} est arrivé à échéance et va être exécuté.`,
      href: d.role === 'MAKER' ? '/espace-createur/portefeuille' : '/espace-livreur/gains',
    }),
  } satisfies NotificationTemplate<{ amountXof: number; role: 'MAKER' | 'COURIER' }>,

  kyc_decision: {
    version: 1,
    channels: ['email', 'inapp'],
    inapp: (d: { approved: boolean; role: 'MAKER' | 'COURIER'; reason?: string | null }) => ({
      title: d.approved ? 'Dossier validé' : 'Dossier à corriger',
      body: d.approved
        ? 'Votre dossier est validé. Vous pouvez commencer.'
        : `Votre dossier n'a pas été validé : ${d.reason ?? 'non précisé'}. Corrigez-le et redéposez-le.`,
      href: d.role === 'MAKER' ? '/espace-createur/boutique' : '/espace-livreur/profil',
    }),
  } satisfies NotificationTemplate<{ approved: boolean; role: 'MAKER' | 'COURIER'; reason?: string | null }>,

  product_decision: {
    version: 1,
    channels: ['email', 'inapp'],
    inapp: (d: { productName: string; productId: string; slug: string; published: boolean; reason?: string | null }) => ({
      title: d.published ? 'Fiche publiée' : 'Fiche à corriger',
      body: d.published
        ? `« ${d.productName} » est en ligne au catalogue.`
        : `« ${d.productName} » n'a pas été publiée : ${d.reason ?? 'non précisé'}.`,
      href: d.published ? `/produit/${d.slug}` : `/espace-createur/produits/${d.productId}`,
    }),
  } satisfies NotificationTemplate<{ productName: string; productId: string; slug: string; published: boolean; reason?: string | null }>,

  dispute_resolved: {
    version: 1,
    channels: ['email', 'inapp'],
    inapp: (d: { reference: string; refundXof: number | null }) => ({
      title: 'Réclamation tranchée',
      body: d.refundXof
        ? `${d.reference} : un remboursement de ${money(d.refundXof)} vous a été accordé.`
        : `${d.reference} : notre décision est disponible.`,
      href: `/compte/reclamations/${d.reference}`,
    }),
  } satisfies NotificationTemplate<{ reference: string; refundXof: number | null }>,

  dispute_opened: {
    version: 1,
    channels: ['email', 'inapp'],
    inapp: (d: { reference: string; orderReference: string; reason: string }) => ({
      title: 'Nouvelle réclamation',
      body: `${d.reference} ouverte sur ${d.orderReference} (${d.reason}). À prendre en charge.`,
      href: `/admin/litiges`,
    }),
  } satisfies NotificationTemplate<{ reference: string; orderReference: string; reason: string }>,

  admin_critical_alert: {
    version: 1,
    channels: ['email', 'inapp'],
    inapp: (d: { subject: string; body: string; href?: string }) => ({
      title: d.subject,
      body: d.body,
      href: d.href ?? '/admin',
    }),
  } satisfies NotificationTemplate<{ subject: string; body: string; href?: string }>,

  // ── Service client ──

  support_reply: {
    version: 1,
    channels: ['email', 'inapp'],
    inapp: (d: { reference: string; subject: string; href: string }) => ({
      title: 'Réponse du service client',
      body: `${d.reference} · ${d.subject} : le service client vous a répondu.`,
      href: d.href,
    }),
  } satisfies NotificationTemplate<{ reference: string; subject: string; href: string }>,

  support_status_changed: {
    version: 1,
    channels: ['email', 'inapp'],
    inapp: (d: { reference: string; statusLabel: string; href: string }) => ({
      title: 'Demande mise à jour',
      body: `${d.reference} : ${d.statusLabel.toLowerCase()}.`,
      href: d.href,
    }),
  } satisfies NotificationTemplate<{ reference: string; statusLabel: string; href: string }>,

  /* Avis des évolutions créatives (cahier des évolutions, § 12). Leur texte
     est composé par l'appelant : chaque événement — dépôt d'un justificatif,
     décision sur une exposition, billet confirmé — dit en une phrase ce qui
     s'est passé et où agir. Le nom du gabarit range l'avis par destinataire,
     pour les filtres et les statistiques. */

  creator_notice: {
    version: 1,
    channels: ['email', 'inapp'],
    inapp: (d: Notice) => ({ title: d.title, body: d.body, href: d.href }),
  } satisfies NotificationTemplate<Notice>,

  organizer_notice: {
    version: 1,
    channels: ['email', 'inapp'],
    inapp: (d: Notice) => ({ title: d.title, body: d.body, href: d.href }),
  } satisfies NotificationTemplate<Notice>,

  visitor_notice: {
    version: 1,
    channels: ['email', 'inapp'],
    inapp: (d: Notice) => ({ title: d.title, body: d.body, href: d.href }),
  } satisfies NotificationTemplate<Notice>,

  admin_notice: {
    version: 1,
    channels: ['inapp'],
    inapp: (d: Notice) => ({ title: d.title, body: d.body, href: d.href }),
  } satisfies NotificationTemplate<Notice>,

  support_ticket_opened: {
    version: 1,
    channels: ['email', 'inapp'],
    inapp: (d: { reference: string; subject: string; author: string }) => ({
      title: 'Nouvelle demande au service client',
      body: `${d.reference} · ${d.subject} (${d.author}).`,
      href: `/admin/support/${d.reference}`,
    }),
  } satisfies NotificationTemplate<{ reference: string; subject: string; author: string }>,
} as const;

export type NotificationTemplateName = keyof typeof NOTIFICATION_TEMPLATES;

export function templateOf(name: NotificationTemplateName) {
  return NOTIFICATION_TEMPLATES[name];
}
