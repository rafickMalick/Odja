import { Controller, Get } from '@nestjs/common';

import { Public } from '../auth/decorators/public.decorator';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Sonde de vie. Elle interroge réellement la base : un service qui répond
 * « ok » alors que Postgres est tombé fait basculer un déploiement en
 * production sans que personne ne s'en aperçoive.
 *
 * **Publique, obligatoirement.** L'orchestrateur qui l'interroge n'a pas de
 * session : une sonde protégée répond 401, le service est déclaré en panne, et
 * le déploiement ne démarre jamais. Le garde global ferme tout par défaut —
 * c'est le bon réglage, mais il faut ouvrir ici explicitement.
 */
@Controller('health')
@Public()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<{
    status: 'ok' | 'degraded';
    database: 'up' | 'down';
    uptimeSeconds: number;
  }> {
    let database: 'up' | 'down' = 'down';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = 'up';
    } catch {
      database = 'down';
    }

    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      uptimeSeconds: Math.round(process.uptime()),
    };
  }

  /** Données de référence chargées : de quoi vérifier qu'un environnement
   *  neuf a bien été semé avant qu'un client n'y arrive. */
  @Get('reference-data')
  async referenceData(): Promise<Record<string, number>> {
    const [countries, cities, categories, vehicleRates, paymentMethods] = await Promise.all([
      this.prisma.country.count({ where: { isActive: true } }),
      this.prisma.city.count(),
      this.prisma.category.count(),
      this.prisma.vehicleRate.count({ where: { isActive: true } }),
      this.prisma.paymentMethodConfig.count({ where: { isActive: true } }),
    ]);

    return { countries, cities, categories, vehicleRates, paymentMethods };
  }
}
