import { Controller, Get, Param, Sse, type MessageEvent } from '@nestjs/common';
import type { ShipmentTrackView } from '@oja/contracts';
import { concat, from, interval, map, merge, Observable } from 'rxjs';

import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { ShipmentEventsBus } from './shipment-events.bus';
import { ShipmentService } from './shipment.service';

const CLOSING_STATUSES = new Set(['DELIVERED', 'RETURNED', 'FAILED']);

/**
 * Suivi de livraison côté client (cahier § 9.4, F1-07).
 *
 * Deux entrées pour la même donnée : un instantané pour l'affichage initial et
 * le repli, et un flux **SSE** — pas un WebSocket — poussé à chaque étape et à
 * chaque position. La propriété est vérifiée dans `ShipmentService.trackFor`
 * (le client de la commande, sinon 404), y compris pour le flux : si
 * l'instantané échoue, le flux se ferme sur cette erreur sans jamais s'ouvrir.
 */
@Controller('shipments')
export class TrackingController {
  constructor(
    private readonly shipments: ShipmentService,
    private readonly bus: ShipmentEventsBus,
  ) {}

  @Get(':reference/track')
  async track(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reference') reference: string,
  ): Promise<ShipmentTrackView> {
    return this.shipments.trackFor(reference, user.id);
  }

  @Sse(':reference/stream')
  stream(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reference') reference: string,
  ): Observable<MessageEvent> {
    const snapshot$ = from(this.shipments.trackFor(reference, user.id)).pipe(
      map((view) => ({ type: 'snapshot', data: view }) satisfies MessageEvent),
    );

    const live$ = new Observable<MessageEvent>((subscriber) => {
      const unsubscribe = this.bus.subscribe(reference, (event) => {
        subscriber.next({ type: 'event', data: event } satisfies MessageEvent);
        if (CLOSING_STATUSES.has(event.status)) subscriber.complete();
      });
      return unsubscribe;
    });

    /* Battement toutes les 25 s : certains relais ferment une connexion SSE
       restée silencieuse trop longtemps. */
    const heartbeat$ = interval(25_000).pipe(
      map(() => ({ type: 'ping', data: { at: new Date().toISOString() } }) satisfies MessageEvent),
    );

    return concat(snapshot$, merge(live$, heartbeat$));
  }
}
