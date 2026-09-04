import { Controller, Get, Query } from '@nestjs/common';

import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Référentiel géographique.
 *
 * Le formulaire d'adresse a besoin de la liste des villes livrables : sans
 * elle, le client saisit un nom libre, et le calcul de distance n'a plus de
 * point de départ.
 *
 * Seuls les pays **actifs** sont exposés. Un pays préparé mais non ouvert ne
 * doit pas apparaître dans une liste déroulante — le client le choisirait, et
 * sa commande serait refusée au chiffrage.
 */
@Controller('geo')
export class GeoController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('countries')
  async countries() {
    const countries = await this.prisma.country.findMany({
      where: { isActive: true },
      select: { id: true, iso2: true, name: true, callingCode: true, currency: true },
      orderBy: { name: 'asc' },
    });
    return countries;
  }

  @Public()
  @Get('cities')
  async cities(@Query('country') iso2?: string) {
    const cities = await this.prisma.city.findMany({
      where: {
        country: { isActive: true, ...(iso2 ? { iso2: iso2.toUpperCase() } : {}) },
      },
      select: {
        id: true,
        name: true,
        country: { select: { iso2: true, name: true } },
      },
      orderBy: { name: 'asc' },
    });

    return cities.map((city) => ({
      id: city.id,
      name: city.name,
      countryIso2: city.country.iso2,
      countryName: city.country.name,
    }));
  }
}
