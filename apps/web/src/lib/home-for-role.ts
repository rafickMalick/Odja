/**
 * Page d'arrivée d'un compte, selon son rôle.
 *
 * Tenue en un seul endroit : la connexion, l'inscription et l'en-tête doivent
 * envoyer au même endroit, sinon un créateur atterrit tantôt sur son atelier,
 * tantôt sur le catalogue, sans comprendre pourquoi.
 */
export function homeForRole(role: string): string {
  switch (role) {
    case "MAKER":
      return "/espace-createur";
    case "COURIER":
      return "/espace-livreur";
    case "ADMIN":
      return "/admin";
    case "CUSTOMER":
      /* « Mon compte », dans l'en-tête, doit mener au compte  pas au
         catalogue. Le bouton affichait le bon libellé et le mauvais lien :
         un client cliquait « Mon compte » et atterrissait sur /catalogue. */
      return "/compte";
    default:
      return "/";
  }
}

export const SPACE_LABEL: Record<string, string> = {
  MAKER: "Mon atelier",
  COURIER: "Mes missions",
  ADMIN: "Administration",
  CUSTOMER: "Mon compte",
};
