import { EventEmitter } from 'node:events';

import { Injectable } from '@nestjs/common';

/**
 * Bus d'événements de livraison, en mémoire du processus.
 *
 * Le suivi client (cahier § 9.4) passe par **SSE**, pas par WebSocket. Le flux
 * a besoin d'être poussé dès qu'une étape ou une position change : plutôt que
 * de faire relire la table `shipment_events` toutes les secondes à chaque
 * client connecté, `ShipmentService` publie ici et le flux s'y abonne.
 *
 * À un seul conteneur — la cible au lancement — c'est suffisant. À plusieurs,
 * le flux garde un repli par relecture périodique de la table : un abonné sur
 * une autre instance verra les mises à jour avec quelques secondes de retard,
 * jamais rien perdre.
 */
export interface LiveShipmentEvent {
  status: string;
  note?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  at: string;
}

@Injectable()
export class ShipmentEventsBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Un colis peut avoir plusieurs onglets ouverts dessus : on relève la
    // limite par défaut (10) pour ne pas voir passer d'avertissement de fuite.
    this.emitter.setMaxListeners(0);
  }

  publish(shipmentReference: string, event: LiveShipmentEvent): void {
    this.emitter.emit(shipmentReference, event);
  }

  subscribe(shipmentReference: string, listener: (event: LiveShipmentEvent) => void): () => void {
    this.emitter.on(shipmentReference, listener);
    return () => this.emitter.off(shipmentReference, listener);
  }
}
