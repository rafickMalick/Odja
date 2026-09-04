import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * Toutes les erreurs sortent au format RFC 9457 (`application/problem+json`),
 * comme l'impose le § 10.6 du cahier.
 *
 * Deux règles :
 *   · un client reçoit de quoi comprendre et corriger, jamais une trace ;
 *   · une erreur inattendue est journalisée en entier côté serveur et rendue
 *     opaque côté client — un message d'exception fuite volontiers un nom de
 *     table, un chemin de fichier ou une contrainte.
 */

interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance: string;
  /** Corrélation avec les journaux serveur, à donner au support. */
  traceId?: string;
  errors?: unknown;
}

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const traceId = (request.headers['x-request-id'] as string | undefined) ?? randomId();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let title = 'Erreur interne';
    let detail: string | undefined;
    let errors: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'string') {
        title = payload;
      } else if (payload && typeof payload === 'object') {
        const body = payload as Record<string, unknown>;
        title = typeof body['error'] === 'string' ? body['error'] : exception.name;
        detail = typeof body['message'] === 'string' ? body['message'] : undefined;

        /* Deux formes de détail par champ coexistent : celle du pipe Zod, qui
           pose un tableau `errors`, et celle de NestJS, qui empile ses messages
           dans `message`. Ne traiter que la seconde faisait disparaître les
           erreurs de validation de nos propres routes — le client recevait
           « certains champs sont invalides » sans savoir lesquels. */
        if (Array.isArray(body['errors'])) {
          errors = body['errors'];
        } else if (Array.isArray(body['message'])) {
          errors = body['message'];
          detail = 'Certains champs sont invalides.';
        }
      }
    } else {
      // Erreur non maîtrisée : tout dans les journaux, rien vers le client.
      this.logger.error(
        `${request.method} ${request.url} — ${traceId}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      detail =
        "Une erreur inattendue est survenue. Communiquez l'identifiant de trace au support.";
    }

    const problem: Problem = {
      type: `https://oja.market/problems/${slugify(title)}`,
      title,
      status,
      instance: request.url,
      traceId,
      ...(detail ? { detail } : {}),
      ...(errors ? { errors } : {}),
    };

    response.status(status).type('application/problem+json').send(problem);
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}
