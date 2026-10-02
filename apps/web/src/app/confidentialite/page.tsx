import type { Metadata } from "next";
import Link from "next/link";

import { Legal, LegalPage } from "@/components/legal/LegalPage";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = { title: "Politique de confidentialité · Ojà" };

export default function ConfidentialitePage() {
  return (
    <LegalPage
      title="Politique de confidentialité"
      intro={
        <>
          Cette page explique quelles données Ojà collecte, pourquoi, avec qui elles sont
          partagées et combien de temps elles sont gardées. Le principe qui guide tout le
          reste : <strong>les coordonnées des clients et des créateurs ne sont jamais
          échangées entre eux</strong>. Ojà reste l’intermédiaire.
        </>
      }
    >
      <h2>1. Responsable du traitement</h2>
      <p>
        <Legal value={LEGAL.companyName} label="Raison sociale" />,{" "}
        <Legal value={LEGAL.address} label="Adresse du siège" />. Pour toute question sur vos
        données : <a href={`mailto:${LEGAL.supportEmail}`}>{LEGAL.supportEmail}</a> ou le{" "}
        <Link href="/contact">formulaire de contact</Link>.
      </p>

      <h2>2. Les données collectées</h2>
      <h3>Pour tous les comptes</h3>
      <ul>
        <li>Prénom, nom, adresse e-mail, numéro de téléphone.</li>
        <li>
          Mot de passe : jamais conservé en clair, seulement sous forme chiffrée
          irréversible.
        </li>
        <li>Acceptation des conditions (version et date).</li>
        <li>Messages échangés avec le service client, et pièces jointes éventuelles.</li>
      </ul>

      <h3>Clients</h3>
      <ul>
        <li>Adresses de livraison et points de repère.</li>
        <li>Commandes, réclamations, validations de réception.</li>
        <li>
          Paiements : Ojà connaît le montant et le statut du paiement, jamais votre numéro de
          carte ni vos identifiants Mobile Money, saisis directement chez le prestataire de
          paiement.
        </li>
      </ul>

      <h3>Créateurs</h3>
      <ul>
        <li>Informations de la boutique (nom, présentation, ville).</li>
        <li>
          Dossier de vérification : nom du responsable, coordonnées, adresse du siège et
          d’enlèvement, numéros IFU ou RCCM, pièces justificatives (pièce d’identité,
          registre de commerce…).
        </li>
        <li>Fiches produits et photos.</li>
        <li>Numéro Mobile Money pour les versements.</li>
      </ul>

      <h3>Livreurs</h3>
      <ul>
        <li>Véhicule, immatriculation, permis et carte grise.</li>
        <li>Numéro Mobile Money pour les versements.</li>
        <li>
          Position GPS au moment de l’enlèvement et de la remise d’un colis, comme preuve de
          livraison. Elle n’est pas suivie en continu.
        </li>
      </ul>

      <h3>Données techniques</h3>
      <ul>
        <li>Adresse IP et journaux de connexion, pour la sécurité et la lutte contre la fraude.</li>
        <li>
          Cookies strictement nécessaires (session, panier) : voir la{" "}
          <Link href="/cookies">politique de cookies</Link>.
        </li>
      </ul>

      <h2>3. Pourquoi ces données</h2>
      <table>
        <thead>
          <tr>
            <th>Finalité</th>
            <th>Fondement</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Créer et gérer votre compte, traiter vos commandes et livraisons</td>
            <td>Exécution du contrat</td>
          </tr>
          <tr>
            <td>Encaisser les paiements, verser les créateurs et les livreurs, tenir la comptabilité</td>
            <td>Exécution du contrat, obligations légales</td>
          </tr>
          <tr>
            <td>Vérifier l’identité des créateurs et des livreurs avant toute activité</td>
            <td>Obligations légales, sécurité des transactions</td>
          </tr>
          <tr>
            <td>Répondre à vos demandes au service client et traiter les réclamations</td>
            <td>Exécution du contrat</td>
          </tr>
          <tr>
            <td>Sécuriser la plateforme (connexion, limitation des tentatives, journal d’audit)</td>
            <td>Intérêt légitime</td>
          </tr>
          <tr>
            <td>Vous envoyer les avis liés à vos commandes et à vos demandes</td>
            <td>Exécution du contrat</td>
          </tr>
        </tbody>
      </table>
      <p>Ojà ne vend pas vos données et ne les utilise pas pour de la publicité ciblée.</p>

      <h2>4. Qui y a accès</h2>
      <ul>
        <li>
          <strong>L’équipe Ojà</strong>, selon son rôle (service client, validation des
          dossiers, comptabilité).
        </li>
        <li>
          <strong>Le créateur</strong> reçoit le contenu de la commande à préparer,{" "}
          <strong>jamais</strong> votre nom, votre téléphone ni votre adresse.
        </li>
        <li>
          <strong>Le livreur</strong> chargé de votre colis reçoit le nom du destinataire, son
          téléphone et l’adresse de livraison, le temps de la course.
        </li>
        <li>
          <strong>Les prestataires techniques</strong>, qui agissent sur instruction d’Ojà :
          hébergement (Vercel, Render, Neon), envoi des e-mails (Brevo), paiement (Kadev Pay),
          stockage des fichiers.
        </li>
      </ul>
      <p>
        Certains de ces prestataires sont situés hors du {LEGAL.country}, notamment aux
        États-Unis et dans l’Union européenne. Ojà ne leur confie que ce qui est nécessaire à
        leur service.
      </p>

      <h2>5. Durées de conservation</h2>
      <table>
        <thead>
          <tr>
            <th>Données</th>
            <th>Durée</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Compte et profil</td>
            <td>Tant que le compte est actif</td>
          </tr>
          <tr>
            <td>Commandes, paiements, factures, écritures comptables</td>
            <td>10 ans (obligation comptable)</td>
          </tr>
          <tr>
            <td>Dossiers de vérification des créateurs et livreurs</td>
            <td>5 ans après la fin de la relation</td>
          </tr>
          <tr>
            <td>Journaux techniques et de sécurité</td>
            <td>12 mois</td>
          </tr>
        </tbody>
      </table>
      <p>
        Quand vous demandez la suppression de votre compte, vos données personnelles sont
        effacées ou rendues anonymes. Les pièces comptables liées à vos commandes sont
        conservées sous forme anonymisée, comme la loi l’exige.
      </p>

      <h2>6. Sécurité</h2>
      <p>
        Mots de passe chiffrés, connexion sécurisée (HTTPS), cookies de session inaccessibles
        aux scripts, pièces justificatives et pièces jointes stockées en accès privé et
        consultables seulement par lien temporaire, journal des actions de l’équipe.
      </p>

      <h2>7. Vos droits</h2>
      <p>
        Vous pouvez à tout moment demander l’accès à vos données, leur rectification, leur
        suppression, ou vous opposer à un traitement. Une partie se fait directement depuis
        votre espace (profil, adresses). Pour le reste, écrivez au service client depuis votre
        espace ou le <Link href="/contact">formulaire de contact</Link>. Nous répondons dans un
        délai d’un mois au plus.
      </p>
      <p>
        Si vous estimez que vos droits ne sont pas respectés, vous pouvez saisir l’autorité de
        protection des données personnelles compétente (au {LEGAL.country} : l’Autorité de
        Protection des Données Personnelles, APDP).
      </p>

      <h2>8. Modifications</h2>
      <p>
        Cette politique peut évoluer. La date de la version en vigueur figure en haut de la
        page ; en cas de changement important, vous en êtes informé dans votre espace.
      </p>
    </LegalPage>
  );
}
