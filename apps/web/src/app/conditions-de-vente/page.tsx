import type { Metadata } from "next";
import Link from "next/link";

import { LegalPage } from "@/components/legal/LegalPage";

export const metadata: Metadata = { title: "Conditions de vente · Ojà" };

export default function ConditionsDeVentePage() {
  return (
    <LegalPage
      title="Conditions de vente"
      intro={
        <>
          Ces conditions encadrent chaque achat sur Ojà, du panier jusqu’au versement au
          créateur. Elles complètent les{" "}
          <Link href="/conditions-generales">conditions générales d’utilisation</Link>.
        </>
      }
    >
      <h2>1. Prix</h2>
      <ul>
        <li>Les prix sont affichés en francs CFA (F CFA), toutes taxes comprises.</li>
        <li>
          Le prix affiché comprend le prix fixé par le créateur et la commission d’Ojà (5 %),
          qui s’y ajoute. Le créateur touche son prix en entier.
        </li>
        <li>
          Les frais de livraison s’ajoutent au prix des pièces. Ils sont calculés au moment de
          commander, selon la distance entre l’atelier et votre adresse, le poids et le volume
          des pièces. Chaque atelier fait l’objet d’une livraison distincte.
        </li>
        <li>
          Le montant total est affiché avant la confirmation ; c’est ce montant que vous payez.
        </li>
      </ul>

      <h2>2. Commande et paiement</h2>
      <ul>
        <li>
          La commande est confirmée une fois le paiement accepté, par Mobile Money ou carte
          bancaire, via notre prestataire de paiement. Le prestataire peut appliquer des frais
          propres au moyen de paiement choisi ; ils sont affichés avant le paiement.
        </li>
        <li>
          <strong>Ojà conserve le montant payé</strong> jusqu’à la validation de la réception :
          le créateur n’est pas payé avant que la pièce soit entre vos mains.
        </li>
        <li>
          Un paiement qui n’aboutit pas dans le délai prévu est abandonné, et les pièces
          réservées sont remises en vente.
        </li>
      </ul>

      <h2>3. Acceptation par le créateur</h2>
      <ul>
        <li>
          Chaque créateur dispose de <strong>48 heures</strong> pour accepter la commande qui
          le concerne.
        </li>
        <li>
          S’il la refuse ou ne répond pas, cette partie de la commande est annulée et vous êtes{" "}
          <strong>remboursé intégralement</strong> (pièces et livraison correspondantes).
        </li>
      </ul>

      <h2>4. Fabrication et livraison</h2>
      <ul>
        <li>
          Les pièces fabriquées sur commande ont un délai de fabrication indiqué sur leur
          fiche ; il s’ajoute au délai de livraison.
        </li>
        <li>
          Une fois la pièce prête, un livreur partenaire mandaté par Ojà l’enlève à l’atelier
          et vous la remet. Vous recevez un <strong>code de réception</strong>, à communiquer
          au livreur au moment de la remise.
        </li>
        <li>
          Vous suivez chaque étape depuis votre espace, rubrique « Mes commandes ».
        </li>
      </ul>

      <h2>5. Réception : valider ou signaler un problème</h2>
      <ul>
        <li>
          À la réception, inspectez la pièce. Depuis votre espace, deux choix :{" "}
          <strong>« Valider la réception »</strong> ou <strong>« Signaler un problème »</strong>.
        </li>
        <li>
          Sans action de votre part, la réception est validée automatiquement{" "}
          <strong>72 heures</strong> après la livraison.
        </li>
        <li>
          Les retours ne sont possibles qu’à ce moment-là, avant la validation. Une fois la
          réception validée, la vente est définitive.
        </li>
      </ul>

      <h2>6. Réclamation et remboursement</h2>
      <ul>
        <li>
          Pièce cassée, non conforme à sa description, incomplète ou jamais reçue : signalez-le
          depuis la commande concernée. Joindre des photos accélère le traitement.
        </li>
        <li>
          Ojà examine chaque réclamation et vous répond dans votre espace. Pendant l’examen, le
          versement au créateur est suspendu.
        </li>
        <li>
          Si la réclamation est fondée, vous êtes remboursé de <strong>100 % du prix de la
          pièce</strong>, sur votre moyen de paiement. Les frais de livraison et la commission
          restent acquis, sauf décision contraire d’Ojà au cas par cas.
        </li>
      </ul>

      <h2>7. Versement au créateur et au livreur</h2>
      <p>
        Le créateur reçoit son prix <strong>24 heures après la validation</strong> de la
        réception, sur son compte Mobile Money. Le livreur est rémunéré pour les courses
        effectuées selon les modalités convenues avec Ojà.
      </p>

      <h2>8. Service client</h2>
      <p>
        Pour toute question sur une commande, écrivez depuis votre espace, rubrique{" "}
        <Link href="/compte/support">Service client</Link> : la commande y est jointe et vous
        suivez la réponse. Sans compte, utilisez le{" "}
        <Link href="/contact">formulaire de contact</Link>.
      </p>
    </LegalPage>
  );
}
