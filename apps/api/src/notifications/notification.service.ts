import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TICKET_STATUS_LABELS } from '@oja/contracts';
import type { Prisma } from '@oja/db';

import { PrismaService } from '../prisma/prisma.service';
import { cursorArgs, toPage, type CursorQuery, type Page } from '../common/pagination';
import { EmailService } from './email.service';
import { SmsService } from './sms.service';
import {
  money,
  templateOf,
  type NotificationTemplateName,
} from './templates';

/**
 * Avis métier.
 *
 * Jusqu'ici, seule l'authentification écrivait aux gens, et rien n'était
 * conservé : un envoi parti, oublié. Ce service fait maintenant trois choses à
 * chaque avis :
 *
 *   · il **persiste** une ligne `Notification` par canal, avec le nom du
 *     gabarit et sa version — l'historique reste lisible même quand le gabarit
 *     change (LN-01) ;
 *   · il **dépose une notification in-app** consultable depuis l'espace de
 *     l'utilisateur (LN-04), en plus de l'e-mail ou du SMS ;
 *   · il garde le principe qui tenait déjà : **un envoi raté ne fait jamais
 *     échouer l'action métier**. Une commande acceptée reste acceptée même si
 *     le relais SMTP est tombé.
 *
 * On n'écrit toujours que sur un événement qui appelle un geste ou porte une
 * nouvelle, et le message dit ce qu'il faut faire ensuite, avec le lien direct.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly webOrigin: string;

  constructor(
    private readonly email: EmailService,
    private readonly sms: SmsService,
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.webOrigin = config.get<string>('WEB_ORIGIN', 'http://localhost:3000');
  }

  // ═══════════════════════════════ Commandes

  /** Une commande vient d'être payée : l'atelier a 48 h pour répondre. */
  async subOrderReceived(subOrderId: string): Promise<void> {
    await this.safely('commande reçue', async () => {
      const subOrder = await this.prisma.subOrder.findUnique({
        where: { id: subOrderId },
        include: {
          maker: { include: { user: { select: { id: true, email: true, firstName: true } } } },
          lines: { select: { productName: true, quantity: true } },
          order: { select: { reference: true } },
        },
      });
      if (!subOrder) return;

      const items = subOrder.lines
        .map((line) => `· ${line.productName} × ${line.quantity}`)
        .join('\n');

      await this.deliver({
        userId: subOrder.maker.user.id,
        template: 'sub_order_received',
        data: {
          orderReference: subOrder.order.reference,
          shopName: subOrder.maker.shopName,
          amountXof: subOrder.itemsMakerSubtotalXof,
        },
        email: {
          to: subOrder.maker.user.email,
          subject: `Nouvelle commande ${subOrder.reference} — à accepter sous 48 h`,
          text: [
            `Bonjour ${subOrder.maker.user.firstName},`,
            '',
            `Vous avez une nouvelle commande sur Ojà : ${subOrder.reference}.`,
            '',
            items,
            '',
            `Votre part : ${money(subOrder.itemsMakerSubtotalXof)}.`,
            '',
            "Acceptez-la ou refusez-la dans les 48 heures. Sans réponse, elle est",
            'annulée et le client remboursé.',
            '',
            `${this.webOrigin}/espace-createur/commandes`,
            '',
            "L'équipe Ojà",
          ].join('\n'),
        },
      });
    });
  }

  /**
   * Relance de l'atelier avant l'expiration des 48 h (LN-06).
   *
   * Le silence vaut refus : un artisan qui n'a pas vu la commande passer perd
   * la vente, et le client attend un remboursement dont il ignore la cause.
   * Une seule relance, à quelques heures de l'échéance.
   */
  async subOrderReminder(subOrderId: string, hoursLeft: number): Promise<void> {
    await this.safely('relance atelier', async () => {
      const subOrder = await this.prisma.subOrder.findUnique({
        where: { id: subOrderId },
        include: {
          maker: {
            include: { user: { select: { id: true, email: true, firstName: true, phone: true } } },
          },
          order: { select: { reference: true } },
        },
      });
      if (!subOrder) return;

      await this.deliver({
        userId: subOrder.maker.user.id,
        template: 'sub_order_reminder',
        data: {
          orderReference: subOrder.order.reference,
          shopName: subOrder.maker.shopName,
          hoursLeft,
        },
        email: {
          to: subOrder.maker.user.email,
          subject: `Commande ${subOrder.reference} — il reste ${hoursLeft} h pour répondre`,
          text: [
            `Bonjour ${subOrder.maker.user.firstName},`,
            '',
            `La commande ${subOrder.reference} attend toujours votre réponse.`,
            '',
            `Il vous reste environ ${hoursLeft} heures pour l'accepter ou la refuser.`,
            'Passé ce délai, elle est annulée automatiquement et le client remboursé.',
            '',
            `${this.webOrigin}/espace-createur/commandes`,
            '',
            "L'équipe Ojà",
          ].join('\n'),
        },
        sms: {
          to: subOrder.maker.user.phone,
          body:
            `Ojà — la commande ${subOrder.reference} attend votre réponse. ` +
            `Il reste ~${hoursLeft} h avant annulation automatique.`,
        },
      });
    });
  }

  /** L'atelier a refusé, ou le délai a expiré : le client est remboursé. */
  async subOrderRejected(subOrderId: string, reason: string): Promise<void> {
    await this.safely('commande refusée', async () => {
      const subOrder = await this.prisma.subOrder.findUnique({
        where: { id: subOrderId },
        include: {
          maker: { select: { shopName: true } },
          order: {
            include: { customer: { select: { id: true, email: true, firstName: true } } },
          },
        },
      });
      if (!subOrder) return;

      await this.deliver({
        userId: subOrder.order.customer.id,
        template: 'sub_order_rejected',
        data: {
          orderReference: subOrder.order.reference,
          shopName: subOrder.maker.shopName,
          reason,
        },
        email: {
          to: subOrder.order.customer.email,
          subject: `Commande ${subOrder.order.reference} — une partie annulée`,
          text: [
            `Bonjour ${subOrder.order.customer.firstName},`,
            '',
            `L'atelier ${subOrder.maker.shopName} n'a pas pu honorer votre commande.`,
            '',
            `Motif : ${reason}`,
            '',
            'Le prix des pièces concernées vous est remboursé intégralement. Si votre',
            "commande comportait d'autres ateliers, ils poursuivent normalement.",
            '',
            `${this.webOrigin}/compte/commandes/${subOrder.order.reference}`,
            '',
            "L'équipe Ojà",
          ].join('\n'),
        },
      });
    });
  }

  /**
   * La sous-commande est prête à enlever (LN-07).
   *
   * Le client apprend que son atelier a terminé et qu'un livreur va passer ;
   * il n'a rien à faire, mais il ne doit pas découvrir la livraison en voyant
   * le livreur à sa porte.
   */
  async subOrderReadyForPickup(subOrderId: string): Promise<void> {
    await this.safely('commande prête à enlever', async () => {
      const subOrder = await this.prisma.subOrder.findUnique({
        where: { id: subOrderId },
        include: {
          maker: { select: { shopName: true } },
          order: {
            include: { customer: { select: { id: true, email: true, firstName: true } } },
          },
        },
      });
      if (!subOrder) return;

      await this.deliver({
        userId: subOrder.order.customer.id,
        template: 'sub_order_ready_for_pickup',
        data: {
          orderReference: subOrder.order.reference,
          shopName: subOrder.maker.shopName,
        },
        email: {
          to: subOrder.order.customer.email,
          subject: `Votre commande chez ${subOrder.maker.shopName} est prête`,
          text: [
            `Bonjour ${subOrder.order.customer.firstName},`,
            '',
            `${subOrder.maker.shopName} a terminé votre commande ${subOrder.order.reference}.`,
            '',
            "Un livreur va venir l'enlever à l'atelier, puis vous l'apporter. Vous",
            'recevrez le code de réception à lui communiquer par SMS.',
            '',
            `${this.webOrigin}/compte/commandes/${subOrder.order.reference}`,
            '',
            "L'équipe Ojà",
          ].join('\n'),
        },
      });
    });
  }

  /** Le client a validé : l'atelier sera réglé sous 24 h. */
  async subOrderValidated(subOrderId: string): Promise<void> {
    await this.safely('réception validée', async () => {
      const subOrder = await this.prisma.subOrder.findUnique({
        where: { id: subOrderId },
        include: {
          maker: { include: { user: { select: { id: true, email: true, firstName: true } } } },
          order: { select: { reference: true } },
        },
      });
      if (!subOrder) return;

      await this.deliver({
        userId: subOrder.maker.user.id,
        template: 'sub_order_validated',
        data: {
          orderReference: subOrder.order.reference,
          shopName: subOrder.maker.shopName,
          amountXof: subOrder.itemsMakerSubtotalXof,
        },
        email: {
          to: subOrder.maker.user.email,
          subject: `Commande ${subOrder.reference} validée — versement programmé`,
          text: [
            `Bonjour ${subOrder.maker.user.firstName},`,
            '',
            `Le client a confirmé la réception de la commande ${subOrder.reference}.`,
            '',
            `Votre versement de ${money(subOrder.itemsMakerSubtotalXof)} est programmé`,
            'dans 24 heures.',
            '',
            `${this.webOrigin}/espace-createur/portefeuille`,
            '',
            "L'équipe Ojà",
          ].join('\n'),
        },
      });
    });
  }

  // ═══════════════════════════════ Logistique

  /** Une mission vient d'être affectée à un livreur. */
  async shipmentAssigned(shipmentId: string): Promise<void> {
    await this.safely('mission affectée', async () => {
      const shipment = await this.prisma.shipment.findUnique({
        where: { id: shipmentId },
        include: {
          courier: { include: { user: { select: { id: true, email: true, firstName: true } } } },
          subOrder: { include: { maker: { select: { shopName: true } } } },
        },
      });
      if (!shipment?.courier) return;

      await this.deliver({
        userId: shipment.courier.user.id,
        template: 'shipment_assigned',
        data: {
          shipmentReference: shipment.reference,
          pickupLine1: shipment.pickupLine1,
          distanceKm: shipment.distanceKm,
        },
        email: {
          to: shipment.courier.user.email,
          subject: `Nouvelle course ${shipment.reference}`,
          text: [
            `Bonjour ${shipment.courier.user.firstName},`,
            '',
            `Une course vous est affectée : ${shipment.reference}.`,
            '',
            `Enlèvement chez ${shipment.subOrder.maker.shopName}`,
            `${shipment.pickupLine1}`,
            `Distance estimée : ${shipment.distanceKm.toFixed(1)} km`,
            '',
            `${this.webOrigin}/espace-livreur/missions/${shipment.reference}`,
            '',
            "L'équipe Ojà",
          ].join('\n'),
        },
      });
    });
  }

  /**
   * Diffusion d'une course aux livreurs de la zone (LN-07).
   *
   * L'affectation reste à l'administration (cahier client) : cet avis prévient
   * seulement, sans engager. Canal in-app uniquement — un SMS par livreur à
   * chaque colis serait vite ignoré.
   */
  async courierOffer(shipmentId: string, courierUserIds: string[]): Promise<void> {
    if (courierUserIds.length === 0) return;
    await this.safely('offre de course aux livreurs', async () => {
      const shipment = await this.prisma.shipment.findUnique({
        where: { id: shipmentId },
        select: { reference: true, pickupLine1: true, distanceKm: true },
      });
      if (!shipment) return;

      for (const userId of courierUserIds) {
        await this.deliver({
          userId,
          template: 'courier_offer',
          data: {
            shipmentReference: shipment.reference,
            pickupLine1: shipment.pickupLine1,
            distanceKm: shipment.distanceKm,
          },
        });
      }
    });
  }

  /** Le colis est remis : le client a 72 h pour valider. */
  async subOrderDelivered(subOrderId: string): Promise<void> {
    await this.safely('colis livré', async () => {
      const subOrder = await this.prisma.subOrder.findUnique({
        where: { id: subOrderId },
        include: {
          maker: { select: { shopName: true } },
          order: {
            include: { customer: { select: { id: true, email: true, firstName: true } } },
          },
        },
      });
      if (!subOrder) return;

      await this.deliver({
        userId: subOrder.order.customer.id,
        template: 'sub_order_delivered',
        data: {
          orderReference: subOrder.order.reference,
          shopName: subOrder.maker.shopName,
        },
        email: {
          to: subOrder.order.customer.email,
          subject: `Votre colis de ${subOrder.maker.shopName} est arrivé`,
          text: [
            `Bonjour ${subOrder.order.customer.firstName},`,
            '',
            `Votre commande chez ${subOrder.maker.shopName} vient de vous être remise.`,
            '',
            'Vérifiez la pièce, puis confirmez la réception — ou signalez un problème',
            'si elle ne correspond pas. Sans réponse de votre part, la réception est',
            'confirmée automatiquement dans 72 heures.',
            '',
            `${this.webOrigin}/compte/commandes/${subOrder.order.reference}`,
            '',
            "L'équipe Ojà",
          ].join('\n'),
        },
      });
    });
  }

  // ═══════════════════════════════ Versements

  /**
   * Un versement est arrivé à échéance et va être exécuté (LN-09).
   *
   * L'exécution réelle du virement est le dernier maillon (lot L5) ; cet avis
   * marque le moment où les fonds passent de « programmés » à « prêts ». Le
   * message de virement effectué viendra se brancher au même endroit.
   */
  async payoutReleased(payoutItemId: string): Promise<void> {
    await this.safely('versement prêt', async () => {
      const item = await this.prisma.payoutItem.findUnique({
        where: { id: payoutItemId },
        select: { beneficiaryId: true, beneficiaryRole: true, amountXof: true },
      });
      if (!item) return;
      if (item.beneficiaryRole !== 'MAKER' && item.beneficiaryRole !== 'COURIER') return;

      await this.deliver({
        userId: item.beneficiaryId,
        template: 'payout_released',
        data: { amountXof: item.amountXof, role: item.beneficiaryRole },
      });
    });
  }

  // ═══════════════════════════════ Dossiers

  async kycDecision(
    userId: string,
    approved: boolean,
    role: 'MAKER' | 'COURIER',
    reason?: string | null,
  ): Promise<void> {
    await this.safely('décision de dossier', async () => {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, firstName: true },
      });
      if (!user) return;

      const space = role === 'MAKER' ? '/espace-createur/boutique' : '/espace-livreur/profil';
      const next = role === 'MAKER' ? 'mettre vos pièces en vente' : 'recevoir des courses';

      await this.deliver({
        userId,
        template: 'kyc_decision',
        data: { approved, role, reason },
        email: {
          to: user.email,
          subject: approved
            ? 'Votre dossier Ojà est validé'
            : 'Votre dossier Ojà demande une correction',
          text: approved
            ? [
                `Bonjour ${user.firstName},`,
                '',
                `Votre dossier est validé. Vous pouvez désormais ${next}.`,
                '',
                `${this.webOrigin}${space}`,
                '',
                "L'équipe Ojà",
              ].join('\n')
            : [
                `Bonjour ${user.firstName},`,
                '',
                "Votre dossier n'a pas pu être validé en l'état.",
                '',
                `Motif : ${reason ?? 'non précisé'}`,
                '',
                'Corrigez ce point et redéposez-le : nous le réexaminons sous 48 heures',
                'ouvrées.',
                '',
                `${this.webOrigin}${space}`,
                '',
                "L'équipe Ojà",
              ].join('\n'),
        },
      });
    });
  }

  async productDecision(
    productId: string,
    published: boolean,
    reason?: string | null,
  ): Promise<void> {
    await this.safely('modération de fiche', async () => {
      const product = await this.prisma.product.findUnique({
        where: { id: productId },
        include: {
          maker: { include: { user: { select: { id: true, email: true, firstName: true } } } },
        },
      });
      if (!product) return;

      await this.deliver({
        userId: product.maker.user.id,
        template: 'product_decision',
        data: { productName: product.name, productId: product.id, slug: product.slug, published, reason },
        email: {
          to: product.maker.user.email,
          subject: published
            ? `« ${product.name} » est en ligne`
            : `« ${product.name} » demande une correction`,
          text: published
            ? [
                `Bonjour ${product.maker.user.firstName},`,
                '',
                `Votre pièce « ${product.name} » est publiée au catalogue.`,
                '',
                `${this.webOrigin}/produit/${product.slug}`,
                '',
                "L'équipe Ojà",
              ].join('\n')
            : [
                `Bonjour ${product.maker.user.firstName},`,
                '',
                `Votre pièce « ${product.name} » n'a pas pu être publiée en l'état.`,
                '',
                `Motif : ${reason ?? 'non précisé'}`,
                '',
                'Corrigez la fiche et renvoyez-la en validation.',
                '',
                `${this.webOrigin}/espace-createur/produits/${product.id}`,
                '',
                "L'équipe Ojà",
              ].join('\n'),
        },
      });
    });
  }

  // ═══════════════════════════════ Réclamations

  /** Une réclamation a été tranchée : le client est prévenu. */
  async disputeResolved(disputeId: string): Promise<void> {
    await this.safely('réclamation tranchée', async () => {
      const dispute = await this.prisma.dispute.findUnique({
        where: { id: disputeId },
        include: {
          order: { include: { customer: { select: { id: true, email: true, firstName: true } } } },
        },
      });
      if (!dispute) return;

      await this.deliver({
        userId: dispute.order.customer.id,
        template: 'dispute_resolved',
        data: { reference: dispute.reference, refundXof: dispute.refundXof ?? null },
        email: {
          to: dispute.order.customer.email,
          subject: `Réclamation ${dispute.reference} — notre décision`,
          text: [
            `Bonjour ${dispute.order.customer.firstName},`,
            '',
            `Nous avons examiné votre réclamation ${dispute.reference}.`,
            '',
            dispute.resolution ?? 'Décision consultable depuis votre espace.',
            '',
            dispute.refundXof
              ? `Remboursement : ${money(dispute.refundXof)}. Il parvient sur votre moyen de paiement sous quelques jours ouvrés.`
              : "Aucun remboursement n'a été accordé.",
            '',
            `${this.webOrigin}/compte/reclamations/${dispute.reference}`,
            '',
            "L'équipe Ojà",
          ].join('\n'),
        },
      });
    });
  }

  /**
   * Une réclamation vient d'être ouverte : l'équipe Ojà doit la prendre en
   * charge (LN-10). Un litige non vu, c'est un client qui attend et un
   * versement suspendu sans que personne ne le sache.
   */
  async disputeOpened(disputeId: string): Promise<void> {
    await this.safely('réclamation ouverte', async () => {
      const dispute = await this.prisma.dispute.findUnique({
        where: { id: disputeId },
        include: { order: { select: { reference: true } } },
      });
      if (!dispute) return;

      const admins = await this.adminUsers();
      for (const admin of admins) {
        await this.deliver({
          userId: admin.id,
          template: 'dispute_opened',
          data: {
            reference: dispute.reference,
            orderReference: dispute.order.reference,
            reason: dispute.reason,
          },
          email: {
            to: admin.email,
            subject: `Nouvelle réclamation ${dispute.reference}`,
            text: [
              'Une réclamation vient d’être ouverte.',
              '',
              `Référence : ${dispute.reference}`,
              `Commande : ${dispute.order.reference}`,
              `Motif : ${dispute.reason}`,
              '',
              `${this.webOrigin}/admin/litiges`,
            ].join('\n'),
          },
        });
      }
    });
  }

  /**
   * Alerte de niveau critique pour l'administration (LN-10).
   *
   * Point d'accroche générique : écart de rapprochement, webhook en échec
   * répété, invariant du grand livre rompu. L'appelant fournit le texte ;
   * l'avis part à tous les administrateurs, e-mail et in-app.
   */
  async criticalAdminAlert(subject: string, body: string, href?: string): Promise<void> {
    await this.safely('alerte critique administrateur', async () => {
      const admins = await this.adminUsers();
      for (const admin of admins) {
        await this.deliver({
          userId: admin.id,
          template: 'admin_critical_alert',
          data: { subject, body, href },
          email: {
            to: admin.email,
            subject: `[Ojà — alerte] ${subject}`,
            text: [body, '', href ? `${this.webOrigin}${href}` : `${this.webOrigin}/admin`].join('\n'),
          },
        });
      }
    });
  }

  // ═══════════════════════════════ Service client

  /**
   * Le service client a répondu, ou a changé le statut d'une demande.
   *
   * Un compte reçoit l'avis in-app et par e-mail ; un visiteur non inscrit
   * (formulaire de contact) seulement par e-mail, à l'adresse qu'il a donnée.
   */
  async supportTicketUpdated(
    ticketId: string,
    kind: 'reply' | 'status',
  ): Promise<void> {
    await this.safely('demande au service client mise à jour', async () => {
      const ticket = await this.prisma.supportTicket.findUnique({
        where: { id: ticketId },
        include: { user: { select: { id: true, email: true, firstName: true, role: true } } },
      });
      if (!ticket) return;

      const statusLabel = TICKET_STATUS_LABELS[ticket.status];
      const href =
        ticket.user?.role === 'MAKER'
          ? `/espace-createur/support/${ticket.reference}`
          : `/compte/support/${ticket.reference}`;
      const email = {
        to: ticket.user?.email ?? ticket.guestEmail ?? '',
        subject:
          kind === 'reply'
            ? `${ticket.reference} — le service client vous a répondu`
            : `${ticket.reference} — ${statusLabel}`,
        text: [
          `Bonjour ${ticket.user?.firstName ?? ticket.guestName ?? ''},`.replace(/ ,$/, ','),
          '',
          kind === 'reply'
            ? `Le service client Ojà a répondu à votre demande « ${ticket.subject} ».`
            : `Votre demande « ${ticket.subject} » est désormais : ${statusLabel.toLowerCase()}.`,
          '',
          ticket.user
            ? `Lire et répondre : ${this.webOrigin}${href}`
            : 'Répondez simplement à cet e-mail en rappelant la référence ci-dessus.',
          '',
          "L'équipe Ojà",
        ].join('\n'),
      };
      if (!email.to) return;

      if (!ticket.user) {
        // Visiteur : pas de compte, donc pas d'avis in-app.
        await this.email.send(email);
        return;
      }

      await this.deliver(
        kind === 'reply'
          ? {
              userId: ticket.user.id,
              template: 'support_reply',
              data: { reference: ticket.reference, subject: ticket.subject, href },
              email,
            }
          : {
              userId: ticket.user.id,
              template: 'support_status_changed',
              data: { reference: ticket.reference, statusLabel, href },
              email,
            },
      );
    });
  }

  /**
   * Accusé de réception du formulaire de contact public.
   *
   * Le texte est **fixe** : il ne reprend ni le nom, ni le message saisis.
   * Une route publique qui écrit à l'adresse qu'on lui donne peut servir à
   * envoyer des e-mails au nom d'Ojà à n'importe qui ; sans contenu fourni
   * par le visiteur, elle ne transporte rien d'exploitable. Le piège à robots
   * et la limite d'envois font le reste.
   */
  async contactReceived(ticketId: string): Promise<void> {
    await this.safely('accusé de réception du contact', async () => {
      const ticket = await this.prisma.supportTicket.findUnique({
        where: { id: ticketId },
        select: { reference: true, guestEmail: true },
      });
      if (!ticket?.guestEmail) return;

      await this.email.send({
        to: ticket.guestEmail,
        subject: `Ojà : nous avons bien reçu votre message (${ticket.reference})`,
        text: [
          'Bonjour,',
          '',
          `Nous avons bien reçu votre message. Sa référence : ${ticket.reference}.`,
          'Le service client Ojà vous répond par e-mail, en général sous 24 heures ouvrées.',
          'Rappelez cette référence si vous nous écrivez à nouveau.',
          '',
          "Si vous n'êtes pas à l'origine de ce message, ignorez cet e-mail.",
          '',
          "L'équipe Ojà",
        ].join('\n'),
      });
    });
  }

  /** Une nouvelle demande attend le service client. */
  async supportTicketOpened(ticketId: string): Promise<void> {
    await this.safely('nouvelle demande au service client', async () => {
      const ticket = await this.prisma.supportTicket.findUnique({
        where: { id: ticketId },
        include: { user: { select: { firstName: true, lastName: true } } },
      });
      if (!ticket) return;

      const author = ticket.user
        ? `${ticket.user.firstName} ${ticket.user.lastName}`
        : `${ticket.guestName ?? 'Visiteur'}, non inscrit`;

      for (const admin of await this.adminUsers()) {
        await this.deliver({
          userId: admin.id,
          template: 'support_ticket_opened',
          data: { reference: ticket.reference, subject: ticket.subject, author },
          email: {
            to: admin.email,
            subject: `Nouvelle demande ${ticket.reference} — ${ticket.subject}`,
            text: [
              `Demande de ${author}.`,
              '',
              `${this.webOrigin}/admin/support/${ticket.reference}`,
            ].join('\n'),
          },
        });
      }
    });
  }

  // ═══════════════════════════════ Lecture in-app (LN-04)

  async listForUser(userId: string, query: CursorQuery): Promise<Page<{
    id: string;
    template: string;
    title: string;
    body: string;
    href: string;
    readAt: string | null;
    createdAt: string;
  }>> {
    const rows = await this.prisma.notification.findMany({
      where: { userId, channel: 'inapp' },
      orderBy: { createdAt: 'desc' },
      ...cursorArgs(query),
    });

    const page = toPage(rows, query.limit);
    return {
      nextCursor: page.nextCursor,
      items: page.items.map((row) => {
        const payload = (row.payload ?? {}) as Record<string, unknown>;
        return {
          id: row.id,
          template: row.template,
          title: String(payload['title'] ?? 'Notification'),
          body: String(payload['body'] ?? ''),
          href: String(payload['href'] ?? '/'),
          readAt: row.readAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
        };
      }),
    };
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, channel: 'inapp', readAt: null },
    });
  }

  /** Sans `ids`, marque tout comme lu. */
  async markRead(userId: string, ids?: string[]): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: {
        userId,
        channel: 'inapp',
        readAt: null,
        ...(ids && ids.length > 0 ? { id: { in: ids } } : {}),
      },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  // ═══════════════════════════════ Interne

  /**
   * Rend le gabarit, écrit une ligne `Notification` par canal, envoie ce qui
   * doit l'être. Chaque envoi externe est isolé : son échec renseigne `error`
   * sur la ligne mais ne remonte pas.
   */
  private async deliver(params: {
    userId: string;
    template: NotificationTemplateName;
    data: Record<string, unknown>;
    email?: { to: string; subject: string; text: string };
    sms?: { to: string; body: string };
  }): Promise<void> {
    const tpl = templateOf(params.template);
    const now = new Date();

    for (const channel of tpl.channels) {
      if (channel === 'inapp') {
        const rendered = tpl.inapp(params.data as never);
        await this.write(params.userId, params.template, 'inapp', tpl.version, {
          ...params.data,
          ...rendered,
        }, now);
        continue;
      }

      if (channel === 'email' && params.email) {
        const error = await this.trySend(() => this.email.send(params.email!));
        await this.write(
          params.userId,
          params.template,
          'email',
          tpl.version,
          { to: params.email.to, subject: params.email.subject },
          error ? null : now,
          error,
        );
        continue;
      }

      if (channel === 'sms' && params.sms) {
        const error = await this.trySend(() => this.sms.send(params.sms!));
        await this.write(
          params.userId,
          params.template,
          'sms',
          tpl.version,
          { to: params.sms.to },
          error ? null : now,
          error,
        );
      }
    }
  }

  private async write(
    userId: string,
    template: string,
    channel: string,
    templateVersion: number,
    payload: Record<string, unknown>,
    sentAt: Date | null,
    error?: string | null,
  ): Promise<void> {
    await this.prisma.notification.create({
      data: {
        userId,
        channel,
        template,
        templateVersion,
        payload: payload as Prisma.InputJsonValue,
        sentAt,
        error: error ?? null,
      },
    });
  }

  private async trySend(work: () => Promise<void>): Promise<string | null> {
    try {
      await work();
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Envoi externe échoué : ${message}`);
      return message;
    }
  }

  private async adminUsers(): Promise<{ id: string; email: string }[]> {
    return this.prisma.user.findMany({
      where: { role: 'ADMIN', status: 'ACTIVE', deletedAt: null },
      select: { id: true, email: true },
    });
  }

  private async safely(label: string, work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      this.logger.error(
        `Avis « ${label} » non traité : ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
