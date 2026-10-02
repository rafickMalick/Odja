import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CONTACT_TICKET_CATEGORIES,
  CUSTOMER_TICKET_CATEGORIES,
  MAKER_TICKET_CATEGORIES,
  TICKET_CATEGORY_LABELS,
  TICKET_STATUS_LABELS,
  type AdminTicketMessageInput,
  type AdminTicketSummaryView,
  type AdminTicketView,
  type AdminTicketsQuery,
  type ContactMessageInput,
  type ContactReceipt,
  type ContactTicketCategory,
  type CreateTicketInput,
  type TicketMessageInput,
  type TicketMessageView,
  type TicketStatus,
  type TicketSummaryView,
  type TicketView,
  type UpdateTicketInput,
} from '@oja/contracts';
import type { Prisma, UserRole } from '@oja/db';

import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

/**
 * Service client : demandes (tickets) et fil de discussion.
 *
 * Règles qui tiennent ensemble tout le module :
 *
 *   · **chacun ne voit que ses demandes**. Une référence d'autrui répond
 *     « introuvable », jamais « interdit » : un refus confirmerait qu'elle
 *     existe (règle du § 2.1) ;
 *   · **les notes internes ne sortent jamais** des routes du client : elles
 *     sont filtrées dans la requête, pas à l'affichage ;
 *   · les types de problème dépendent de l'espace : un acheteur et un
 *     créateur n'ont pas les mêmes ennuis ;
 *   · les avis (réponse, changement de statut) partent **sans être attendus** :
 *     un relais d'e-mail lent ne doit pas faire patienter le service client.
 */

const CATEGORIES_BY_ROLE: Partial<Record<UserRole, Record<string, string>>> = {
  CUSTOMER: CUSTOMER_TICKET_CATEGORIES,
  MAKER: MAKER_TICKET_CATEGORIES,
};

type TicketWithRelations = Prisma.SupportTicketGetPayload<{
  include: {
    order: { select: { reference: true } };
    user: { select: { firstName: true; lastName: true; email: true } };
  };
}>;

const SUMMARY_INCLUDE = {
  order: { select: { reference: true } },
  user: { select: { firstName: true, lastName: true, email: true } },
} as const;

@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Pièces jointes : seulement les fichiers que l'auteur a lui-même envoyés.
   *
   * La clé porte l'usage et le propriétaire (`private/support-attachment/
   * <jour>/<userId>/…`, voir StorageService). Sans ce contrôle, n'importe qui
   * pourrait joindre à sa demande la clé d'un fichier d'autrui (une pièce
   * d'identité, par exemple) et en obtenir ensuite un lien de lecture.
   */
  private async assertOwnAttachments(fileKeys: string[] | undefined, userId: string) {
    for (const key of fileKeys ?? []) {
      const parts = key.split('/');
      const valid =
        parts.length === 5 &&
        parts[0] === 'private' &&
        parts[1] === 'support-attachment' &&
        parts[3] === userId &&
        !key.includes('..');
      if (!valid) throw new BadRequestException('Pièce jointe invalide.');
      // Le fichier doit être réellement arrivé sur le stockage.
      await this.storage.assertExists(key);
    }
  }

  /** Lien de lecture à durée courte, pour une pièce jointe de la demande. */
  private async attachmentUrl(
    ticketWhere: Prisma.SupportTicketWhereInput,
    fileKey: string,
    includeInternal: boolean,
  ): Promise<{ url: string }> {
    const message = await this.prisma.supportMessage.findFirst({
      where: {
        fileKeys: { has: fileKey },
        ticket: ticketWhere,
        ...(includeInternal ? {} : { internal: false }),
      },
      select: { id: true },
    });
    // Même réponse qu'une demande inconnue : rien ne confirme l'existence.
    if (!message) throw new NotFoundException('Pièce jointe introuvable.');
    return { url: await this.storage.createReadUrl(fileKey) };
  }

  async myAttachmentUrl(userId: string, reference: string, fileKey: string) {
    return this.attachmentUrl({ reference, userId }, fileKey, false);
  }

  async adminAttachmentUrl(reference: string, fileKey: string) {
    return this.attachmentUrl({ reference }, fileKey, true);
  }

  /** Types de problème proposés à un rôle. Les autres rôles n'ont pas d'espace support. */
  categoriesFor(role: string): Record<string, string> {
    const categories = CATEGORIES_BY_ROLE[role as UserRole];
    if (!categories) throw new NotFoundException();
    return categories;
  }

  // ═══════════════════════════════ Côté client (acheteur, créateur)

  async create(user: AuthenticatedUser, input: CreateTicketInput): Promise<TicketView> {
    const categories = this.categoriesFor(user.role);
    if (!(input.category in categories)) {
      throw new BadRequestException('Type de problème inconnu pour votre espace.');
    }
    await this.assertOwnAttachments(input.fileKeys, user.id);

    let orderId: string | undefined;
    if (input.orderReference) {
      // Seul l'acheteur rattache une commande, et seulement l'une des siennes.
      const order =
        user.role === 'CUSTOMER'
          ? await this.prisma.order.findFirst({
              where: { reference: input.orderReference, customerId: user.id },
              select: { id: true },
            })
          : null;
      if (!order) throw new BadRequestException('Commande introuvable dans votre compte.');
      orderId = order.id;
    }

    const now = new Date();
    const ticket = await this.prisma.$transaction(async (tx) => {
      const reference = await nextReference(tx);
      return tx.supportTicket.create({
        data: {
          reference,
          channel: 'ACCOUNT',
          userId: user.id,
          authorRole: user.role as UserRole,
          category: input.category,
          subject: input.subject!,
          ...(orderId ? { orderId } : {}),
          lastMessageAt: now,
          messages: {
            create: {
              authorId: user.id,
              body: input.message!,
              fileKeys: input.fileKeys ?? [],
              createdAt: now,
            },
          },
        },
      });
    });

    void this.notifications.supportTicketOpened(ticket.id);
    return this.mine(user, ticket.reference);
  }

  async listMine(userId: string, status?: TicketStatus): Promise<TicketSummaryView[]> {
    const tickets = await this.prisma.supportTicket.findMany({
      where: { userId, ...(status ? { status } : {}) },
      include: SUMMARY_INCLUDE,
      orderBy: { lastMessageAt: 'desc' },
      take: 200,
    });
    return tickets.map(toSummary);
  }

  async mine(user: AuthenticatedUser, reference: string): Promise<TicketView> {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { reference, userId: user.id },
      include: {
        ...SUMMARY_INCLUDE,
        // Filtrées ici, dans la requête : une note interne n'atteint jamais
        // la réponse envoyée au client.
        messages: { where: { internal: false }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!ticket) throw new NotFoundException('Demande introuvable.');
    return { ...toSummary(ticket), messages: ticket.messages.map(toMessage) };
  }

  async reply(
    user: AuthenticatedUser,
    reference: string,
    input: TicketMessageInput,
  ): Promise<TicketView> {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { reference, userId: user.id },
      select: { id: true, status: true },
    });
    if (!ticket) throw new NotFoundException('Demande introuvable.');
    if (ticket.status === 'CLOSED') {
      throw new BadRequestException(
        'Cette demande est fermée. Ouvrez-en une nouvelle si le problème persiste.',
      );
    }
    await this.assertOwnAttachments(input.fileKeys, user.id);

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.supportMessage.create({
        data: {
          ticketId: ticket.id,
          authorId: user.id,
          body: input.body!,
          fileKeys: input.fileKeys ?? [],
          createdAt: now,
        },
      }),
      this.prisma.supportTicket.update({
        where: { id: ticket.id },
        data: {
          lastMessageAt: now,
          /* Le client répond : la balle revient au service client. Une demande
             « résolue » qui reçoit un message est rouverte, plutôt que de
             laisser ce message sans lecteur. */
          ...(ticket.status === 'WAITING_CUSTOMER' || ticket.status === 'RESOLVED'
            ? { status: 'OPEN' as const, resolvedAt: null }
            : {}),
        },
      }),
    ]);

    return this.mine(user, reference);
  }

  // ═══════════════════════════════ Formulaire de contact public

  /**
   * Message d'un visiteur, inscrit ou non.
   *
   * Il arrive dans la même file que les demandes des espaces connectés,
   * marqué « formulaire de contact ». Si l'adresse correspond à un compte, la
   * demande lui est rattachée : elle apparaît dans ses « Mes demandes » et les
   * réponses lui parviennent aussi dans son espace.
   */
  async createFromContact(input: ContactMessageInput): Promise<ContactReceipt> {
    const email = input.email!.trim().toLowerCase();
    const account = await this.prisma.user.findFirst({
      where: { email, deletedAt: null },
      select: { id: true, role: true },
    });

    const label = CONTACT_TICKET_CATEGORIES[input.category as ContactTicketCategory];
    const now = new Date();
    const ticket = await this.prisma.$transaction(async (tx) => {
      const reference = await nextReference(tx);
      return tx.supportTicket.create({
        data: {
          reference,
          channel: 'CONTACT_FORM',
          ...(account ? { userId: account.id, authorRole: account.role } : {}),
          guestName: input.name!.trim(),
          guestEmail: email,
          category: input.category!,
          subject: label,
          lastMessageAt: now,
          messages: {
            create: { authorId: account?.id ?? null, body: input.message!, createdAt: now },
          },
        },
      });
    });

    void this.notifications.supportTicketOpened(ticket.id);
    void this.notifications.contactReceived(ticket.id);
    return { reference: ticket.reference };
  }

  // ═══════════════════════════════ Côté administration

  async adminList(query: AdminTicketsQuery): Promise<AdminTicketSummaryView[]> {
    const q = query.q?.trim();
    const where: Prisma.SupportTicketWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.role === 'GUEST'
        ? { authorRole: null }
        : query.role
          ? { authorRole: query.role }
          : {}),
      ...(q
        ? {
            OR: [
              { reference: { contains: q, mode: 'insensitive' } },
              { subject: { contains: q, mode: 'insensitive' } },
              { guestEmail: { contains: q, mode: 'insensitive' } },
              { guestName: { contains: q, mode: 'insensitive' } },
              { user: { email: { contains: q, mode: 'insensitive' } } },
              { user: { lastName: { contains: q, mode: 'insensitive' } } },
              { user: { firstName: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const tickets = await this.prisma.supportTicket.findMany({
      where,
      include: SUMMARY_INCLUDE,
      orderBy: { lastMessageAt: 'desc' },
      take: 200,
    });
    return tickets.map(toAdminSummary);
  }

  /** Demandes qui attendent l'équipe : ouvertes ou en cours. Sert au badge du menu. */
  async adminPendingCount(): Promise<{ count: number }> {
    return {
      count: await this.prisma.supportTicket.count({
        where: { status: { in: ['OPEN', 'IN_PROGRESS'] } },
      }),
    };
  }

  async adminGet(reference: string): Promise<AdminTicketView> {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { reference },
      include: { ...SUMMARY_INCLUDE, messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!ticket) throw new NotFoundException('Demande introuvable.');
    return {
      ...toAdminSummary(ticket),
      userId: ticket.userId,
      messages: ticket.messages.map(toMessage),
    };
  }

  async adminReply(
    adminId: string,
    reference: string,
    input: AdminTicketMessageInput,
  ): Promise<AdminTicketView> {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { reference },
      select: { id: true, status: true },
    });
    if (!ticket) throw new NotFoundException('Demande introuvable.');
    await this.assertOwnAttachments(input.fileKeys, adminId);

    const internal = input.internal ?? false;
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.supportMessage.create({
        data: {
          ticketId: ticket.id,
          authorId: adminId,
          fromStaff: true,
          internal,
          body: input.body!,
          fileKeys: input.fileKeys ?? [],
          createdAt: now,
        },
      }),
      this.prisma.supportTicket.update({
        where: { id: ticket.id },
        data: {
          lastMessageAt: now,
          /* Une réponse publique à une demande ouverte la fait passer en
             « en attente de réponse » : c'est au client de jouer. Une note
             interne ne change rien pour lui. */
          ...(!internal && (ticket.status === 'OPEN' || ticket.status === 'IN_PROGRESS')
            ? { status: 'WAITING_CUSTOMER' as const }
            : {}),
        },
      }),
    ]);

    if (!internal) void this.notifications.supportTicketUpdated(ticket.id, 'reply');
    return this.adminGet(reference);
  }

  async adminUpdate(reference: string, input: UpdateTicketInput): Promise<AdminTicketView> {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { reference },
      select: { id: true, status: true },
    });
    if (!ticket) throw new NotFoundException('Demande introuvable.');

    const nextStatus = input.status !== ticket.status ? input.status : undefined;
    const now = new Date();
    await this.prisma.supportTicket.update({
      where: { id: ticket.id },
      data: {
        ...(input.priority ? { priority: input.priority } : {}),
        ...(nextStatus
          ? {
              status: nextStatus,
              resolvedAt: nextStatus === 'RESOLVED' ? now : null,
              closedAt: nextStatus === 'CLOSED' ? now : null,
            }
          : {}),
      },
    });
    const statusChanged = nextStatus !== undefined;

    if (statusChanged) void this.notifications.supportTicketUpdated(ticket.id, 'status');
    return this.adminGet(reference);
  }
}

async function nextReference(tx: Prisma.TransactionClient): Promise<string> {
  const year = new Date().getFullYear();
  const counter = await tx.referenceCounter.upsert({
    where: { scope_year: { scope: 'support', year } },
    update: { value: { increment: 1 } },
    create: { scope: 'support', year, value: 1 },
  });
  return `SUP-${year}-${String(counter.value).padStart(6, '0')}`;
}

function toSummary(ticket: TicketWithRelations): TicketSummaryView {
  return {
    reference: ticket.reference,
    category: ticket.category,
    categoryLabel: TICKET_CATEGORY_LABELS[ticket.category] ?? ticket.category,
    subject: ticket.subject,
    status: ticket.status,
    statusLabel: TICKET_STATUS_LABELS[ticket.status],
    priority: ticket.priority,
    orderReference: ticket.order?.reference ?? null,
    createdAt: ticket.createdAt.toISOString(),
    lastMessageAt: ticket.lastMessageAt.toISOString(),
  };
}

function toAdminSummary(ticket: TicketWithRelations): AdminTicketSummaryView {
  return {
    ...toSummary(ticket),
    channel: ticket.channel,
    authorRole: ticket.authorRole,
    authorName: ticket.user
      ? `${ticket.user.firstName} ${ticket.user.lastName}`
      : (ticket.guestName ?? 'Visiteur'),
    authorEmail: ticket.user?.email ?? ticket.guestEmail ?? '',
    isGuest: ticket.channel === 'CONTACT_FORM',
  };
}

function toMessage(message: {
  id: string;
  fromStaff: boolean;
  internal: boolean;
  body: string;
  fileKeys: string[];
  createdAt: Date;
}): TicketMessageView {
  return {
    id: message.id,
    fromStaff: message.fromStaff,
    internal: message.internal,
    body: message.body,
    fileKeys: message.fileKeys,
    createdAt: message.createdAt.toISOString(),
  };
}
