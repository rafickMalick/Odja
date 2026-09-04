import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'oja:isPublic';

/**
 * Marque une route accessible sans jeton.
 *
 * Le garde d'authentification est global : par défaut **tout est fermé**, et
 * l'ouverture est explicite. L'inverse — tout ouvert, à fermer route par
 * route — laisse fuir la première route qu'on oublie de protéger.
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);
