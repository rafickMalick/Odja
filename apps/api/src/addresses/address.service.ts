import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AddressInput, PublicAddress } from '@oja/contracts';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AddressService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<PublicAddress[]> {
    const addresses = await this.prisma.address.findMany({
      where: { userId, deletedAt: null },
      include: { city: true },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return addresses.map(toPublic);
  }

  async create(userId: string, input: AddressInput): Promise<PublicAddress> {
    const city = await this.prisma.city.findUnique({ where: { id: input.cityId } });
    if (!city) throw new BadRequestException('Ville inconnue.');

    const count = await this.prisma.address.count({ where: { userId, deletedAt: null } });
    // La première adresse est celle par défaut, sans que le client ait à le
    // demander : il n'en a qu'une, le choix n'existe pas encore.
    const isDefault = input.isDefault || count === 0;

    const address = await this.prisma.$transaction(async (tx) => {
      if (isDefault) {
        await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      }
      return tx.address.create({
        data: {
          userId,
          fullName: input.fullName,
          phone: input.phone,
          cityId: input.cityId,
          line1: input.line1,
          isDefault,
          ...defined(input, ['label', 'landmark', 'latitude', 'longitude']),
        },
        include: { city: true },
      });
    });

    return toPublic(address);
  }

  async update(userId: string, id: string, input: Partial<AddressInput>): Promise<PublicAddress> {
    await this.requireOwn(userId, id);

    const address = await this.prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      }
      return tx.address.update({
        where: { id },
        data: defined(input, [
          'label',
          'fullName',
          'phone',
          'cityId',
          'line1',
          'landmark',
          'latitude',
          'longitude',
          'isDefault',
        ]),
        include: { city: true },
      });
    });

    return toPublic(address);
  }

  /**
   * Suppression **logique** : une adresse peut être référencée par une
   * commande passée. La commande en a certes figé une copie, mais garder la
   * ligne permet de suivre l'historique d'un litige de livraison.
   */
  async remove(userId: string, id: string): Promise<void> {
    const address = await this.requireOwn(userId, id);

    await this.prisma.$transaction(async (tx) => {
      await tx.address.update({ where: { id }, data: { deletedAt: new Date(), isDefault: false } });

      // Ne jamais laisser un carnet sans adresse par défaut : le passage en
      // caisse n'aurait plus rien à présélectionner.
      if (address.isDefault) {
        const next = await tx.address.findFirst({
          where: { userId, deletedAt: null },
          orderBy: { createdAt: 'desc' },
        });
        if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    });
  }

  /** Un client qui demande l'adresse d'un autre reçoit 404, jamais 403. */
  private async requireOwn(userId: string, id: string) {
    const address = await this.prisma.address.findFirst({
      where: { id, userId, deletedAt: null },
    });
    if (!address) throw new NotFoundException();
    return address;
  }
}

function toPublic(address: {
  id: string;
  label: string | null;
  fullName: string;
  phone: string;
  line1: string;
  landmark: string | null;
  latitude: number | null;
  longitude: number | null;
  isDefault: boolean;
  cityId: string;
  city: { name: string };
}): PublicAddress {
  return {
    id: address.id,
    label: address.label,
    fullName: address.fullName,
    phone: address.phone,
    city: address.city.name,
    cityId: address.cityId,
    line1: address.line1,
    landmark: address.landmark,
    latitude: address.latitude,
    longitude: address.longitude,
    isDefault: address.isDefault,
  };
}

type Defined<T, K extends keyof T> = { [P in K]?: Exclude<T[P], undefined> };

function defined<T extends object, K extends keyof T>(
  source: T,
  keys: readonly K[],
): Defined<T, K> {
  const result: Defined<T, K> = {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined) result[key] = value as Exclude<T[K], undefined>;
  }
  return result;
}
