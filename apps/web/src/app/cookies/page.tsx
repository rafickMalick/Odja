import type { Metadata } from "next";
import Link from "next/link";

import { LegalPage } from "@/components/legal/LegalPage";

export const metadata: Metadata = { title: "Politique de cookies · Ojà" };

export default function CookiesPage() {
  return (
    <LegalPage
      title="Politique de cookies"
      intro={
        <>
          En bref : Ojà n’utilise <strong>que des cookies strictement nécessaires</strong> au
          fonctionnement du site. Aucun cookie publicitaire, aucun outil de mesure d’audience,
          aucun pistage. C’est pourquoi aucun bandeau ne vous demande votre accord.
        </>
      }
    >
      <h2>Qu’est-ce qu’un cookie ?</h2>
      <p>
        Un petit fichier déposé par le site dans votre navigateur. Il permet par exemple de
        rester connecté d’une page à l’autre, ou de retrouver son panier.
      </p>

      <h2>Les cookies utilisés par Ojà</h2>
      <table>
        <thead>
          <tr>
            <th>Nom</th>
            <th>À quoi il sert</th>
            <th>Durée</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>oja_access</code>
            </td>
            <td>Vous garder connecté pendant votre visite.</td>
            <td>15 minutes, renouvelé automatiquement</td>
          </tr>
          <tr>
            <td>
              <code>oja_refresh</code>
            </td>
            <td>Renouveler votre session sans vous redemander votre mot de passe.</td>
            <td>30 jours, supprimé à la déconnexion</td>
          </tr>
          <tr>
            <td>
              <code>oja_cart</code>
            </td>
            <td>Retrouver votre panier, même sans être connecté.</td>
            <td>30 jours</td>
          </tr>
        </tbody>
      </table>
      <p>
        Ces trois cookies ne contiennent aucune information lisible sur vous, et ne sont pas
        accessibles aux scripts de la page. Ils sont indispensables : sans eux, vous ne
        pourriez ni vous connecter ni garder un panier.
      </p>

      <h2>Au moment du paiement</h2>
      <p>
        Le paiement s’effectue dans le module de notre prestataire de paiement (Kadev Pay),
        qui peut déposer ses propres cookies, nécessaires à la sécurité de la transaction. Ils
        relèvent de sa propre politique.
      </p>

      <h2>Les refuser ou les supprimer</h2>
      <p>
        Vous pouvez supprimer les cookies à tout moment depuis les réglages de votre
        navigateur. Si vous bloquez ceux d’Ojà, vous pourrez toujours parcourir le catalogue,
        mais pas vous connecter ni conserver un panier.
      </p>

      <h2>Pour en savoir plus</h2>
      <p>
        Voir la <Link href="/confidentialite">politique de confidentialité</Link>, ou écrivez-nous
        depuis le <Link href="/contact">formulaire de contact</Link>.
      </p>
    </LegalPage>
  );
}
