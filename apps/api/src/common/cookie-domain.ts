import { Logger } from '@nestjs/common';

/**
 * Domaine des cookies de session et de panier.
 *
 * Sans attribut `domain`, un cookie posé par `api.oja.aworix.agency`
 * n'appartient qu'à ce sous-domaine : le serveur du front
 * (`oja.aworix.agency`) ne le reçoit jamais, et une page rendue côté serveur
 * ne sait pas qui la demande. `COOKIE_DOMAIN=oja.aworix.agency` le partage
 * entre le front et l'API — et seulement eux : le viser plus large
 * (`aworix.agency`) l'enverrait à tous les autres sites du domaine.
 *
 * Absent en développement : tout tourne sur `localhost`, le cookie y est déjà
 * partagé entre les ports. Absent aussi en production depuis que le site
 * relaie l'API : les cookies appartiennent déjà au site.
 *
 * Toute pose **et tout effacement** de cookie doivent l'utiliser : un
 * `clearCookie` sans le même domaine que la pose n'efface rien, et la
 * déconnexion laisserait la session ouverte.
 *
 * **Garde-fou.** Un domaine qui ne couvre pas le site (`WEB_ORIGIN`) est
 * ignoré : le navigateur refuserait chaque cookie, et la connexion
 * semblerait réussir avant de retomber aussitôt sur la page de connexion.
 * C'est arrivé : `COOKIE_DOMAIN=oja.ox` sur Render. Mieux vaut des cookies
 * sans domaine, qui fonctionnent avec le relais, qu'un site où personne ne
 * peut se connecter.
 */

const logger = new Logger('CookieDomain');
let warned: string | null = null;

export function cookieDomain(): { domain?: string } {
  const domain = process.env['COOKIE_DOMAIN']?.trim().replace(/^\./, '').toLowerCase();
  if (!domain) return {};

  const site = siteHost(process.env['WEB_ORIGIN']);
  if (site && (site === domain || site.endsWith(`.${domain}`))) return { domain };

  if (warned !== domain) {
    warned = domain;
    logger.warn(
      `COOKIE_DOMAIN="${domain}" ne couvre pas le site (${site ?? 'WEB_ORIGIN absent'}) : ` +
        'ignoré, les cookies sont posés sans domaine. Videz cette variable.',
    );
  }
  return {};
}

function siteHost(origin: string | undefined): string | null {
  if (!origin) return null;
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
}
