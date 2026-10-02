import type { Metadata } from "next";
import Link from "next/link";

import { Legal, LegalPage } from "@/components/legal/LegalPage";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = { title: "Conditions générales d’utilisation · Ojà" };

export default function ConditionsGeneralesPage() {
  return (
    <LegalPage
      title="Conditions générales d’utilisation"
      intro={
        <>
          Ces conditions s’appliquent à toute personne qui utilise Ojà : visiteurs, clients,
          créateurs et livreurs. Les règles propres aux achats (prix, paiement, livraison,
          réception, remboursement) figurent dans les{" "}
          <Link href="/conditions-de-vente">conditions de vente</Link>.
        </>
      }
    >
      <h2>1. Ce qu’est Ojà</h2>
      <p>
        Ojà, édité par <Legal value={LEGAL.companyName} label="Raison sociale" />, est une place
        de marché qui met en relation des ateliers indépendants (les <strong>créateurs</strong>)
        et des acheteurs (les <strong>clients</strong>), avec des <strong>livreurs</strong>{" "}
        partenaires. Ojà est l’intermédiaire unique : il encaisse les paiements, organise la
        livraison, assure le service client et verse aux créateurs et aux livreurs ce qui leur
        revient.
      </p>
      <p>
        Les coordonnées des clients et des créateurs ne sont jamais échangées entre eux. Toute
        demande passe par le service client d’Ojà.
      </p>

      <h2>2. Compte</h2>
      <ul>
        <li>
          L’inscription est gratuite. Vous choisissez un profil : client, créateur ou livreur.
        </li>
        <li>
          Les informations fournies doivent être exactes et tenues à jour. Une adresse e-mail
          et un numéro de téléphone valides sont nécessaires.
        </li>
        <li>
          Vous êtes responsable de la confidentialité de votre mot de passe. Signalez sans
          délai au service client toute utilisation que vous n’avez pas autorisée.
        </li>
        <li>
          Un compte est personnel. Un même compte ne peut pas être à la fois client et créateur.
        </li>
      </ul>

      <h2>3. Créateurs</h2>
      <ul>
        <li>
          Avant toute vente, le créateur dépose un dossier (identité, coordonnées, numéro IFU
          ou RCCM, pièces justificatives). Ojà le vérifie et peut le refuser en motivant sa
          décision.
        </li>
        <li>
          Chaque fiche décrit fidèlement la pièce : photos réelles (trois au minimum), matière,
          dimensions, poids, délai de fabrication. Ojà peut refuser ou retirer une fiche non
          conforme.
        </li>
        <li>
          Le créateur fixe son prix. La commission d’Ojà s’y ajoute ; elle n’est jamais retenue
          sur le prix du créateur.
        </li>
        <li>
          Le créateur répond à chaque commande dans les 48 heures ; sans réponse, la commande
          est annulée et le client remboursé. Il prépare la pièce dans le délai annoncé et la
          remet au livreur mandaté par Ojà.
        </li>
        <li>
          Le créateur est payé une fois la réception validée par le client, selon les
          modalités des <Link href="/conditions-de-vente">conditions de vente</Link>.
        </li>
      </ul>

      <h2>4. Livreurs</h2>
      <ul>
        <li>
          Le livreur dépose un dossier (identité, permis, carte grise, véhicule) vérifié par
          Ojà avant toute course.
        </li>
        <li>
          Les courses lui sont attribuées par Ojà. Il enlève le colis à l’atelier et le remet
          au client contre le code de réception, avec une preuve de remise (position, photo).
        </li>
        <li>
          Il n’utilise les coordonnées du destinataire que pour la course en cours.
        </li>
      </ul>

      <h2>5. Ce qui est interdit</h2>
      <ul>
        <li>Vendre une pièce contrefaite, illicite ou différente de sa description.</li>
        <li>
          Contourner la plateforme : proposer une vente directe, échanger des coordonnées pour
          conclure en dehors d’Ojà.
        </li>
        <li>Publier un contenu injurieux, trompeur ou portant atteinte aux droits d’autrui.</li>
        <li>Tenter d’accéder au compte d’autrui ou de perturber le fonctionnement du site.</li>
      </ul>
      <p>
        Pour signaler un contenu ou un comportement : <Link href="/contact">formulaire de
        contact</Link>, sujet « Signalement ».
      </p>

      <h2>6. Suspension et fermeture</h2>
      <p>
        Ojà peut suspendre ou fermer un compte qui ne respecte pas ces conditions, après en
        avoir informé son titulaire, sauf urgence (fraude, sécurité). Les commandes en cours
        sont menées à terme ou remboursées. Vous pouvez demander la fermeture de votre compte
        à tout moment auprès du service client.
      </p>

      <h2>7. Responsabilité</h2>
      <p>
        Chaque créateur est responsable des pièces qu’il fabrique et de leur conformité à leur
        description. Ojà est responsable de l’encaissement, de l’organisation de la livraison
        et du traitement des réclamations, dans les conditions prévues par les{" "}
        <Link href="/conditions-de-vente">conditions de vente</Link>. Ojà met tout en œuvre pour
        que le site reste disponible, sans pouvoir garantir une absence totale d’interruption.
      </p>

      <h2>8. Données personnelles</h2>
      <p>
        Voir la <Link href="/confidentialite">politique de confidentialité</Link> et la{" "}
        <Link href="/cookies">politique de cookies</Link>.
      </p>

      <h2>9. Modifications</h2>
      <p>
        Ces conditions peuvent évoluer. La version en vigueur est datée en haut de cette page.
        En cas de changement important, vous en êtes informé et invité à les accepter de
        nouveau.
      </p>

      <h2>10. Droit applicable et litiges</h2>
      <p>
        Ces conditions sont soumises au droit du {LEGAL.country}. En cas de désaccord,
        écrivez d’abord au service client : la plupart des situations se règlent ainsi. À
        défaut d’accord amiable, le litige est porté devant les juridictions compétentes du{" "}
        {LEGAL.country}.
      </p>
    </LegalPage>
  );
}
