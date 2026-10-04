import { afterEach, describe, expect, it, vi } from 'vitest';

import { cookieDomain } from './cookie-domain';

/**
 * Le domaine des cookies ne doit jamais rendre la connexion impossible : un
 * domaine qui ne couvre pas le site ferait refuser chaque cookie par le
 * navigateur.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

function withEnv(cookieDomainValue: string | undefined, webOrigin: string | undefined) {
  vi.stubEnv('COOKIE_DOMAIN', cookieDomainValue ?? '');
  vi.stubEnv('WEB_ORIGIN', webOrigin ?? '');
}

describe('Domaine des cookies', () => {
  it('absent : pas d’attribut domain', () => {
    withEnv(undefined, 'https://oja.aworix.agency');
    expect(cookieDomain()).toEqual({});
  });

  it('le domaine du site lui-même est appliqué', () => {
    withEnv('oja.aworix.agency', 'https://oja.aworix.agency');
    expect(cookieDomain()).toEqual({ domain: 'oja.aworix.agency' });
  });

  it('un domaine parent du site est appliqué, point initial et casse ignorés', () => {
    withEnv('.Aworix.Agency', 'https://oja.aworix.agency');
    expect(cookieDomain()).toEqual({ domain: 'aworix.agency' });
  });

  it('un domaine qui ne couvre pas le site est ignoré (le cas oja.ox)', () => {
    withEnv('oja.ox', 'https://oja.aworix.agency');
    expect(cookieDomain()).toEqual({});
  });

  it('un domaine qui ressemble seulement au site est ignoré', () => {
    withEnv('aworix.agency', 'https://oja-aworix.agency');
    expect(cookieDomain()).toEqual({});
  });

  it('sans WEB_ORIGIN lisible, aucun domaine n’est imposé', () => {
    withEnv('oja.aworix.agency', 'pas-une-url');
    expect(cookieDomain()).toEqual({});
  });
});
