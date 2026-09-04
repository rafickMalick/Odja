import { randomBytes } from 'node:crypto';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UPLOAD_RULES, type RequestUploadInput, type UploadPurpose, type UploadTicket } from '@oja/contracts';

/**
 * Stockage des fichiers.
 *
 * Principe : **le fichier ne traverse jamais l'API**. Elle signe une URL, le
 * navigateur envoie directement au stockage, puis prévient l'API. Faire
 * transiter les octets par le serveur consommerait mémoire et bande passante
 * pour rien — cinq photos de 8 Mo envoyées depuis un téléphone bloqueraient un
 * processus entier.
 *
 * Deux espaces, et la séparation compte :
 *
 *   · **public** — photos de fiches produit, logos. Lisibles par tous, avec
 *     une URL stable qui se met en cache ;
 *   · **privé** — pièces d'identité, preuves de livraison, pièces de litige.
 *     Jamais d'URL stable : chaque lecture passe par une URL signée de courte
 *     durée, délivrée à qui a le droit de la demander.
 *
 * Une pièce d'identité derrière une URL devinable, c'est une fuite qui ne
 * laisse aucune trace.
 */

/** Durée de vie d'une URL d'envoi : le temps de choisir un fichier et de l'envoyer. */
const UPLOAD_TTL_SECONDS = 15 * 60;

/** Durée de vie d'une URL de lecture privée. Volontairement courte. */
const READ_TTL_SECONDS = 5 * 60;

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly publicBucket: string;
  private readonly privateBucket: string;
  private readonly publicBaseUrl: string;

  constructor(config: ConfigService) {
    const endpoint = config.get<string>('S3_ENDPOINT');

    this.client = new S3Client({
      region: config.get<string>('S3_REGION', 'us-east-1'),
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      credentials: {
        accessKeyId: config.getOrThrow<string>('S3_ACCESS_KEY'),
        secretAccessKey: config.getOrThrow<string>('S3_SECRET_KEY'),
      },
    });

    const bucket = config.getOrThrow<string>('S3_BUCKET');
    this.publicBucket = `${bucket}-public`;
    this.privateBucket = `${bucket}-private`;
    this.publicBaseUrl = config.get<string>(
      'S3_PUBLIC_BASE_URL',
      `${endpoint ?? ''}/${this.publicBucket}`,
    );
  }

  /**
   * Signe une autorisation d'envoi.
   *
   * Les contrôles se font **avant** de signer : une fois l'URL délivrée, le
   * stockage ne vérifie plus que ce que la signature a figé.
   */
  async createUploadTicket(
    input: RequestUploadInput,
    owner: { userId: string },
  ): Promise<UploadTicket> {
    const rule = UPLOAD_RULES[input.purpose];

    if (!rule.mimeTypes.includes(input.contentType)) {
      throw new BadRequestException(
        `Format non accepté. Formats attendus : ${rule.mimeTypes
          .map((type) => type.replace(/^\w+\//, ''))
          .join(', ')}.`,
      );
    }

    if (input.sizeBytes > rule.maxBytes) {
      throw new BadRequestException(
        `Fichier trop lourd (${megabytes(input.sizeBytes)} Mo). ` +
          `Maximum ${megabytes(rule.maxBytes)} Mo.`,
      );
    }

    const bucket = rule.public ? this.publicBucket : this.privateBucket;
    const fileKey = this.buildKey(input.purpose, owner.userId, input.contentType);

    /* `ContentLength` entre dans la signature : le stockage refusera un envoi
       dont la taille réelle diffère de celle annoncée. Sans lui, la borne
       ci-dessus serait purement déclarative. */
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: fileKey,
      ContentType: input.contentType,
      ContentLength: input.sizeBytes,
    });

    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: UPLOAD_TTL_SECONDS,
    });

    return {
      uploadUrl,
      headers: {
        'Content-Type': input.contentType,
        'Content-Length': String(input.sizeBytes),
      },
      fileKey,
      publicUrl: rule.public ? this.publicUrlFor(fileKey) : null,
      expiresInSeconds: UPLOAD_TTL_SECONDS,
    };
  }

  /**
   * Vérifie qu'un fichier annoncé existe vraiment.
   *
   * À appeler avant de rattacher une clé à une fiche produit ou à un dossier :
   * sans ce contrôle, on enregistrerait des photos qui n'ont jamais été
   * envoyées, et la fiche partirait en validation avec trois images fantômes.
   */
  async assertExists(fileKey: string): Promise<{ sizeBytes: number; contentType: string }> {
    const bucket = this.bucketFor(fileKey);

    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: fileKey }),
      );
      return {
        sizeBytes: head.ContentLength ?? 0,
        contentType: head.ContentType ?? 'application/octet-stream',
      };
    } catch {
      throw new BadRequestException(
        "Ce fichier n'a pas été reçu. Renvoyez-le avant de valider.",
      );
    }
  }

  /**
   * URL de lecture d'un fichier privé, valable quelques minutes.
   *
   * Volontairement courte : une URL qui traîne dans un historique de
   * navigation ou un journal de serveur ne doit plus rien ouvrir.
   */
  async createReadUrl(fileKey: string, ttlSeconds = READ_TTL_SECONDS): Promise<string> {
    const bucket = this.bucketFor(fileKey);
    if (bucket === this.publicBucket) return this.publicUrlFor(fileKey);

    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: bucket, Key: fileKey }),
      { expiresIn: ttlSeconds },
    );
  }

  /**
   * Dépose un objet **généré par l'API** dans l'espace privé.
   *
   * Contrairement aux photos, une facture PDF est composée sur le serveur : il
   * n'y a pas de navigateur pour l'envoyer via une URL signée. La clé est
   * préfixée `private/` pour que `createReadUrl` la serve toujours signée et de
   * courte durée.
   */
  async putPrivateObject(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<string> {
    const fileKey = key.startsWith('private/') ? key : `private/${key}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.privateBucket,
        Key: fileKey,
        Body: body,
        ContentType: contentType,
      }),
    );
    return fileKey;
  }

  async remove(fileKey: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucketFor(fileKey), Key: fileKey }),
      );
    } catch (cause) {
      // Un fichier déjà absent n'est pas une erreur : la fiche est propre.
      this.logger.warn(`Suppression sans effet pour ${fileKey}`);
      void cause;
    }
  }

  /**
   * Résout une clé en URL affichable.
   *
   * Les fiches de démonstration portent des chemins du front (`/images/…`) et
   * les vraies photos des clés de stockage. On accepte les deux plutôt que de
   * migrer un jeu de démonstration.
   */
  publicUrlFor(fileKey: string): string {
    if (fileKey.startsWith('http://') || fileKey.startsWith('https://')) return fileKey;
    if (fileKey.startsWith('/')) return fileKey;
    return `${this.publicBaseUrl}/${fileKey}`;
  }

  isPrivate(fileKey: string): boolean {
    return fileKey.startsWith('private/');
  }

  /**
   * Chemin du fichier.
   *
   * Le préfixe porte l'espace, l'usage, le propriétaire et la date : on
   * retrouve à l'œil nu à qui appartient un objet, et on purge une période
   * entière sans requête en base.
   */
  private buildKey(purpose: UploadPurpose, userId: string, contentType: string): string {
    const rule = UPLOAD_RULES[purpose];
    const space = rule.public ? 'public' : 'private';
    const day = new Date().toISOString().slice(0, 10);
    // Suffixe aléatoire : deux envois simultanés ne doivent pas se recouvrir.
    const unique = randomBytes(8).toString('hex');

    return `${space}/${purpose}/${day}/${userId}/${unique}.${extensionOf(contentType)}`;
  }

  private bucketFor(fileKey: string): string {
    return this.isPrivate(fileKey) ? this.privateBucket : this.publicBucket;
  }
}

function extensionOf(contentType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'application/pdf': 'pdf',
  };
  return map[contentType] ?? 'bin';
}

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

export { NotFoundException };
