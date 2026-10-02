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
 * partagé entre les ports.
 *
 * Toute pose **et tout effacement** de cookie doivent l'utiliser : un
 * `clearCookie` sans le même domaine que la pose n'efface rien, et la
 * déconnexion laisserait la session ouverte.
 */
export function cookieDomain(): { domain?: string } {
  const domain = process.env['COOKIE_DOMAIN']?.trim();
  return domain ? { domain } : {};
}
