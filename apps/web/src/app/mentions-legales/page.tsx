import type { Metadata } from "next";
import Link from "next/link";

import { Legal, LegalPage } from "@/components/legal/LegalPage";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = { title: "Mentions légales · Ojà" };

export default function MentionsLegalesPage() {
  return (
    <LegalPage title="Mentions légales">
      <h2>Éditeur du site</h2>
      <p>
        Le site Ojà, place de marché du mobilier, du design, de la décoration et de
        l’artisanat africain, est édité par :
      </p>
      <ul>
        <li>
          Raison sociale : <Legal value={LEGAL.companyName} label="Raison sociale" />
        </li>
        <li>
          Forme juridique et capital : <Legal value={LEGAL.legalForm} label="Forme juridique" />
        </li>
        <li>
          Siège : <Legal value={LEGAL.address} label="Adresse du siège" />
        </li>
        <li>
          RCCM : <Legal value={LEGAL.rccm} label="Numéro RCCM" />
        </li>
        <li>
          IFU : <Legal value={LEGAL.ifu} label="Numéro IFU" />
        </li>
        <li>
          Contact : <a href={`mailto:${LEGAL.supportEmail}`}>{LEGAL.supportEmail}</a>, ou le{" "}
          <Link href="/contact">formulaire de contact</Link>
        </li>
      </ul>

      <h2>Directeur de la publication</h2>
      <p>
        <Legal value={LEGAL.publicationDirector} label="Nom du directeur de la publication" />
      </p>

      <h2>Hébergement</h2>
      <p>Le site et ses données sont hébergés par les prestataires suivants :</p>
      <ul>
        <li>
          <strong>Vercel Inc.</strong> (États-Unis) : pages du site. vercel.com
        </li>
        <li>
          <strong>Render Services, Inc.</strong> (États-Unis) : serveur applicatif (API).
          render.com
        </li>
        <li>
          <strong>Neon Inc.</strong> : base de données. neon.tech
        </li>
        <li>
          <strong>Brevo (Sendinblue SAS)</strong> (France) : envoi des e-mails. brevo.com
        </li>
      </ul>

      <h2>Rôle d’Ojà</h2>
      <p>
        Ojà est une plateforme d’intermédiation. Les pièces vendues sont fabriquées par des
        ateliers indépendants (les créateurs), vérifiés par Ojà avant leur première mise en
        vente. Ojà encaisse les paiements, organise la livraison et assure le service client ;
        les coordonnées des créateurs et des clients ne sont jamais échangées entre eux. Le
        détail figure dans les <Link href="/conditions-generales">conditions générales
        d’utilisation</Link> et les <Link href="/conditions-de-vente">conditions de
        vente</Link>.
      </p>

      <h2>Propriété intellectuelle</h2>
      <p>
        La marque Ojà, son logo, la structure et les textes du site appartiennent à l’éditeur.
        Les photographies et descriptions des pièces appartiennent à leurs créateurs, qui
        autorisent Ojà à les publier pour la vente. Toute reproduction sans autorisation est
        interdite.
      </p>

      <h2>Signaler un contenu</h2>
      <p>
        Pour signaler une fiche, un contenu illicite ou un comportement contraire aux règles
        de la plateforme, écrivez-nous depuis le <Link href="/contact">formulaire de
        contact</Link> en choisissant le sujet « Signalement ».
      </p>

      <h2>Données personnelles et cookies</h2>
      <p>
        Voir la <Link href="/confidentialite">politique de confidentialité</Link> et la{" "}
        <Link href="/cookies">politique de cookies</Link>.
      </p>
    </LegalPage>
  );
}
