import { type ArgumentsHost, Catch, type ExceptionFilter, HttpStatus } from '@nestjs/common';
import {
  DeliveryError,
  PricingError,
  ProductTransitionError,
  ProofOfDeliveryError,
  TransitionError,
} from '@oja/domain';
import type { Request, Response } from 'express';

/**
 * Traduit les erreurs métier en réponses HTTP correctes.
 *
 * Sans ce filtre, une transition interdite — un atelier qui clique deux fois
 * sur « Prêt », un livreur qui déclare une remise avant l'enlèvement —
 * remonte comme une erreur non maîtrisée : **500**, message opaque, trace dans
 * les journaux. Or ce n'est pas une panne du serveur, c'est une action que le
 * métier refuse, et l'utilisateur a besoin de savoir laquelle.
 *
 * Le message de ces erreurs est écrit pour être lu : « Depuis READY_FOR_PICKUP,
 * seuls IN_DELIVERY, CANCELLED sont possibles ». Il est donc transmis tel
 * quel, contrairement aux erreurs vraiment inattendues.
 */
@Catch(
  TransitionError,
  ProductTransitionError,
  PricingError,
  DeliveryError,
  ProofOfDeliveryError,
)
export class DomainErrorFilter implements ExceptionFilter {
  catch(exception: Error, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    /* 409 pour une transition : la ressource existe et la demande est bien
       formée, c'est son état actuel qui s'y oppose. 400 pour un calcul
       impossible : c'est l'entrée qui est en cause. */
    const isTransition =
      exception instanceof TransitionError || exception instanceof ProductTransitionError;

    const status = isTransition ? HttpStatus.CONFLICT : HttpStatus.BAD_REQUEST;
    const title = isTransition ? 'Action impossible dans cet état' : 'Demande invalide';

    response
      .status(status)
      .type('application/problem+json')
      .send({
        type: `https://oja.market/problems/${isTransition ? 'invalid-transition' : 'invalid-request'}`,
        title,
        status,
        detail: exception.message,
        instance: request.url,
      });
  }
}
