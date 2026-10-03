import { describe, expect, it } from 'vitest';

import { publicName } from './review.service';

/** Un avis public ne doit jamais exposer le nom complet de son auteur. */
describe('Nom affiché sous un avis', () => {
  it('garde le prénom et l’initiale du nom', () => {
    expect(publicName({ firstName: 'Awa', lastName: 'Koné' })).toBe('Awa K.');
  });

  it('nettoie les espaces et met l’initiale en capitale', () => {
    expect(publicName({ firstName: ' Jean ', lastName: ' dossou' })).toBe('Jean D.');
  });

  it('se contente du prénom sans nom', () => {
    expect(publicName({ firstName: 'Awa', lastName: '' })).toBe('Awa');
  });
});
