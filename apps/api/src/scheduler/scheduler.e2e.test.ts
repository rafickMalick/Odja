import { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { SchedulerService } from './scheduler.service';

/**
 * L'ordonnanceur, vérifié pour ce qu'il est censé garantir.
 *
 * Deux propriétés seulement, mais ce sont celles dont dépend l'argent :
 * **les quatre échéances du cahier client sont bien programmées**, et
 * **rejouer une tâche ne produit rien en double**. Le reste — la logique de
 * chaque tâche — est déjà couvert par les tests de leurs services.
 */
describe('Ordonnanceur', () => {
  let app: INestApplication;
  let scheduler: SchedulerService;
  let registry: SchedulerRegistry;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();

    scheduler = app.get(SchedulerService);
    registry = app.get(SchedulerRegistry);
    prisma = app.get(PrismaService);
  }, 90_000);

  afterAll(async () => {
    await app.close();
  });

  it('programme les quatre échéances du cahier client', () => {
    const names = [...registry.getCronJobs().keys()];

    // Nommer chaque tâche n'est pas cosmétique : sans nom, une tâche perdue
    // dans un renommage disparaît sans que rien ne le signale.
    expect(names).toContain('auto-validate');
    expect(names).toContain('release-payouts');
    expect(names).toContain('expire-unanswered');
    expect(names).toContain('expire-stale-payments');
  });

  it('ne double rien quand on rejoue les tâches', async () => {
    const before = await snapshot();

    // Deux passages consécutifs. Si une tâche n'était pas idempotente, le
    // second créerait des versements ou des écritures en double.
    await Promise.all([
      scheduler.autoValidate(),
      scheduler.releasePayouts(),
      scheduler.expireUnanswered(),
      scheduler.expireStalePayments(),
    ]);
    const middle = await snapshot();

    await Promise.all([
      scheduler.autoValidate(),
      scheduler.releasePayouts(),
      scheduler.expireUnanswered(),
      scheduler.expireStalePayments(),
    ]);
    const after = await snapshot();

    expect(after).toEqual(middle);
    void before;
  });

  it('avale l’échec d’une tâche sans abattre les suivantes', async () => {
    /* Une exception qui remonte d'un `@Cron` tue le processus Node. On vérifie
       que la couche d'exécution la retient — c'est la différence entre une
       tâche en échec et une plateforme à terre. */
    const broken = scheduler as unknown as {
      run: (label: string, work: () => Promise<number>) => Promise<void>;
    };

    await expect(
      broken.run('tâche de test', async () => {
        throw new Error('panne simulée');
      }),
    ).resolves.toBeUndefined();
  });

  async function snapshot() {
    const [payouts, entries, subOrders] = await Promise.all([
      prisma.payoutItem.count(),
      prisma.ledgerEntry.count(),
      prisma.subOrder.count({ where: { status: 'REJECTED' } }),
    ]);
    return { payouts, entries, subOrders };
  }
});
