import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodType, ZodTypeDef } from 'zod';

/**
 * Valide une entrée avec un schéma Zod issu de `@oja/contracts`.
 *
 * Le même schéma sert au front : les deux côtés ne peuvent donc pas diverger,
 * ce qui est tout l'intérêt du paquet partagé (cahier § 10.6).
 *
 * Les erreurs sortent champ par champ. Un formulaire d'inscription qui répond
 * « données invalides » sans dire lequel des sept champs pose problème est
 * inutilisable.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  /* Le type d'entrée est `unknown`, pas `T` : un schéma qui transforme —
     `?inStock=false` en booléen, un numéro en E.164 — produit une sortie
     différente de son entrée, et `ZodSchema<T>` refuserait alors le schéma. */
  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      throw new BadRequestException({
        error: 'Validation',
        message: 'Certains champs sont invalides.',
        errors: result.error.issues.map((issue) => ({
          field: issue.path.join('.') || '(racine)',
          message: issue.message,
        })),
      });
    }

    return result.data;
  }
}

/** Raccourci : `@Body(zodBody(registerSchema))`. */
export function zodBody<T>(
  schema: ZodType<T, ZodTypeDef, unknown>,
): ZodValidationPipe<T> {
  return new ZodValidationPipe(schema);
}
