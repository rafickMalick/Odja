import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AttachKycDocumentInput, KycDocumentView } from '@oja/contracts';

import { TRAINING_PROOF_TYPE } from '@oja/domain';

import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

/**
 * Pièces justificatives.
 *
 * Elles ne sont **jamais** accessibles par une URL stable : chaque lecture
 * passe par une URL signée de quelques minutes, délivrée à qui a le droit de
 * la demander. Une pièce d'identité derrière une adresse devinable, c'est une
 * fuite qui ne laisse aucune trace.
 *
 * Le déposant lui-même ne relit pas ses pièces : il sait ce qu'il a envoyé, et
 * chaque URL délivrée est une occasion de fuite en plus. Il voit le type et le
 * statut, pas le fichier.
 */
@Injectable()
export class KycDocumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationService,
  ) {}

  async attachForMaker(
    userId: string,
    input: AttachKycDocumentInput,
  ): Promise<KycDocumentView[]> {
    const maker = await this.prisma.makerProfile.findUnique({ where: { userId } });
    if (!maker) throw new NotFoundException('Aucune boutique pour ce compte.');

    await this.storage.assertExists(input.fileKey);

    if (!this.storage.isPrivate(input.fileKey)) {
      /* Une pièce d'identité déposée dans l'espace public serait lisible de
         tous. On refuse plutôt que de la déplacer en silence : le client
         devrait comprendre ce qui s'est passé. */
      throw new BadRequestException(
        'Cette pièce a été envoyée dans le mauvais espace. Recommencez le dépôt.',
      );
    }

    // Un même type remplace le précédent : on ne veut pas trois CNI recto.
    await this.prisma.kycDocument.deleteMany({
      where: { makerId: maker.id, type: input.type },
    });

    await this.prisma.kycDocument.create({
      data: { makerId: maker.id, type: input.type, fileKey: input.fileKey },
    });

    /* Le cahier demande d'accuser réception du justificatif d'un apprenti
       (§ 12) : sans cela, il ne sait pas si son envoi est bien arrivé. */
    if (input.type === TRAINING_PROOF_TYPE) {
      await this.notifications.notice('creator_notice', userId, {
        title: 'Justificatif de formation reçu',
        body: 'Votre justificatif est bien arrivé. Déposez votre dossier pour qu’il soit examiné.',
        href: '/espace-createur/boutique',
      });
    }

    return this.listForMaker(userId);
  }

  async attachForCourier(
    userId: string,
    input: AttachKycDocumentInput,
  ): Promise<KycDocumentView[]> {
    const courier = await this.prisma.courierProfile.findUnique({ where: { userId } });
    if (!courier) throw new NotFoundException('Aucun profil livreur pour ce compte.');

    await this.storage.assertExists(input.fileKey);
    if (!this.storage.isPrivate(input.fileKey)) {
      throw new BadRequestException(
        'Cette pièce a été envoyée dans le mauvais espace. Recommencez le dépôt.',
      );
    }

    await this.prisma.kycDocument.deleteMany({
      where: { courierId: courier.id, type: input.type },
    });

    await this.prisma.kycDocument.create({
      data: { courierId: courier.id, type: input.type, fileKey: input.fileKey },
    });

    return this.listForCourier(userId);
  }

  /** Vue du déposant : type et statut, jamais le fichier. */
  async listForMaker(userId: string): Promise<KycDocumentView[]> {
    const maker = await this.prisma.makerProfile.findUnique({ where: { userId } });
    if (!maker) throw new NotFoundException();

    const documents = await this.prisma.kycDocument.findMany({
      where: { makerId: maker.id },
      orderBy: { createdAt: 'asc' },
    });
    return documents.map(toView);
  }

  async listForCourier(userId: string): Promise<KycDocumentView[]> {
    const courier = await this.prisma.courierProfile.findUnique({ where: { userId } });
    if (!courier) throw new NotFoundException();

    const documents = await this.prisma.kycDocument.findMany({
      where: { courierId: courier.id },
      orderBy: { createdAt: 'asc' },
    });
    return documents.map(toView);
  }

  /**
   * Vue de l'administration : avec une URL de lecture à durée courte.
   *
   * C'est le seul endroit du système qui délivre ces URL, et il est réservé
   * aux administrateurs par le garde de rôle.
   */
  async listForReview(target: {
    makerId?: string;
    courierId?: string;
  }): Promise<KycDocumentView[]> {
    if (!target.makerId && !target.courierId) {
      throw new BadRequestException('Précisez un créateur ou un livreur.');
    }

    const documents = await this.prisma.kycDocument.findMany({
      where: {
        ...(target.makerId ? { makerId: target.makerId } : {}),
        ...(target.courierId ? { courierId: target.courierId } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });

    return Promise.all(
      documents.map(async (document) => ({
        ...toView(document),
        url: await this.storage.createReadUrl(document.fileKey),
      })),
    );
  }
}

function toView(document: {
  id: string;
  type: string;
  status: string;
  note: string | null;
  createdAt: Date;
}): KycDocumentView {
  return {
    id: document.id,
    type: document.type,
    status: document.status,
    note: document.note,
    createdAt: document.createdAt.toISOString(),
  };
}
