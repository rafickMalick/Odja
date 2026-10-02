/**
 * Retour à la page demandée après connexion.
 *
 * Un espace qui renvoie vers la connexion y passe l'adresse **exacte** où
 * l'on se trouvait (`/admin/equipe?…`), pas seulement la racine de l'espace :
 * sinon, une session expirée ramène sur l'accueil de l'espace et l'on perd
 * sa page.
 */
export function loginUrl(fallback: string): string {
  const here =
    typeof window === "undefined"
      ? fallback
      : `${window.location.pathname}${window.location.search}`;
  return `/connexion?suite=${encodeURIComponent(here || fallback)}`;
}

/**
 * Destination de retour, seulement si elle reste sur Ojà.
 *
 * `?suite=https://ailleurs.example` ou `//ailleurs.example` ferait de la page
 * de connexion un tremplin vers un site tiers, sous l'apparence d'Ojà : on
 * n'accepte qu'un chemin interne.
 */
export function safeReturnPath(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  return value;
}
