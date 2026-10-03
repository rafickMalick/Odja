import { ConsoleLogger } from '@nestjs/common';

import { redactText, redactValue } from './redact';

/**
 * Journaliseur de l'API : celui de NestJS, secrets masqués (backlog L0-30).
 *
 * Posé une fois au démarrage (`app.useLogger`), il couvre **tous** les
 * journaux — ceux des services, ceux de NestJS, et les traces d'erreur que
 * ProblemFilter écrit en entier. Un secret glissé par mégarde dans un message
 * d'erreur ou une pile d'appels ne sort plus en clair.
 */
export class RedactingLogger extends ConsoleLogger {
  override log(message: unknown, ...rest: unknown[]): void {
    super.log(clean(message), ...rest.map(clean));
  }

  override error(message: unknown, ...rest: unknown[]): void {
    super.error(clean(message), ...rest.map(clean));
  }

  override warn(message: unknown, ...rest: unknown[]): void {
    super.warn(clean(message), ...rest.map(clean));
  }

  override debug(message: unknown, ...rest: unknown[]): void {
    super.debug(clean(message), ...rest.map(clean));
  }

  override verbose(message: unknown, ...rest: unknown[]): void {
    super.verbose(clean(message), ...rest.map(clean));
  }

  override fatal(message: unknown, ...rest: unknown[]): void {
    super.fatal(clean(message), ...rest.map(clean));
  }
}

function clean(value: unknown): unknown {
  return typeof value === 'string' ? redactText(value) : redactValue(value);
}
