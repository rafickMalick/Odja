"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  PageHead,
  Panel,
  StatTile,
  workspaceStyles as styles,
} from "@/components/dashboard/Workspace";
import type { CreativeOverview } from "@oja/contracts";

import { apiFetch } from "@/lib/api";

/**
 * Vue d'ensemble.
 *
 * Elle ne compte pas l'activité  chiffre d'affaires, visites  mais **les
 * files d'attente**. Ce qui intéresse une équipe de back-office à l'ouverture,
 * c'est ce qui bloque quelqu'un d'autre.
 */
export default function AdminHomePage() {
  const [makers, setMakers] = useState(0);
  const [couriers, setCouriers] = useState(0);
  const [products, setProducts] = useState(0);
  const [shipments, setShipments] = useState(0);
  const [disputes, setDisputes] = useState(0);
  const [creative, setCreative] = useState<CreativeOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [m, c, p, s, d, o] = await Promise.all([
        apiFetch<unknown[]>("/admin/makers?status=PENDING").catch(() => []),
        apiFetch<unknown[]>("/admin/couriers?status=PENDING").catch(() => []),
        apiFetch<unknown[]>("/admin/catalog/products/pending").catch(() => []),
        apiFetch<unknown[]>("/admin/logistics/unassigned").catch(() => []),
        apiFetch<unknown[]>("/admin/disputes?open=true").catch(() => []),
        apiFetch<CreativeOverview>("/admin/creative-overview").catch(() => null),
      ]);
      if (cancelled) return;
      setMakers(m.length);
      setCouriers(c.length);
      setProducts(p.length);
      setShipments(s.length);
      setDisputes(d.length);
      setCreative(o);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <p className={styles.muted}>Chargement…</p>;

  const total =
    makers +
    couriers +
    products +
    shipments +
    disputes +
    (creative ? creative.exhibitionsToReview + creative.reportsOpen : 0);

  return (
    <>
      <PageHead
        title="Vue d’ensemble"
        subtitle={
          total === 0
            ? "Rien n’attend l’équipe. Toutes les files sont vides."
            : `${total} élément${total > 1 ? "s attendent" : " attend"} une décision.`
        }
      />

      <div className={styles.statGrid}>
        <StatTile label="Dossiers créateurs" value={String(makers)} hint="à valider" />
        <StatTile label="Dossiers livreurs" value={String(couriers)} hint="à valider" />
        <StatTile label="Fiches produit" value={String(products)} hint="à modérer" />
        <StatTile label="Expéditions" value={String(shipments)} hint="sans livreur" />
        <StatTile label="Réclamations" value={String(disputes)} hint="ouvertes" />
      </div>

      {/* Profils créatifs, expositions et signalements (cahier des
          évolutions, § 11). */}
      {creative ? (
        <>
          <h2 className={styles.panelTitle}>Profils créatifs et expositions</h2>
          <div className={styles.statGrid}>
            <StatTile
              label="Apprentis"
              value={String(creative.apprenticesPending)}
              hint={`à valider · ${creative.professionalsPending} professionnel(s)`}
            />
            <StatTile label="Expositions" value={String(creative.exhibitionsToReview)} hint="à examiner" />
            <StatTile
              label="Contrats et paiements"
              value={String(creative.exhibitionsAwaitingContract)}
              hint={`${creative.exhibitionsLive} exposition(s) en ligne`}
            />
            <StatTile label="Signalements" value={String(creative.reportsOpen)} hint="à traiter" />
            <StatTile
              label="Formules payantes"
              value={String(creative.premiumActive)}
              hint={`${creative.suspendedMakers} profil(s) suspendu(s)`}
            />
            <StatTile label="Billets et inscriptions" value={String(creative.passesConfirmedThisMonth)} hint="ce mois-ci" />
          </div>
        </>
      ) : null}

      <Panel title="Où aller">
        <ul className={styles.muted}>
          <li>
            <Link href="/admin/ateliers">Dossiers créateurs</Link> : un dossier en attente,
            c’est un atelier qui ne peut rien vendre.
          </li>
          <li>
            <Link href="/admin/livreurs">Dossiers livreurs</Link> : sans livreur validé,
            aucune commande ne quitte l’atelier.
          </li>
          <li>
            <Link href="/admin/catalogue">Fiches à valider</Link> : refuser demande un motif,
            il part au créateur.
          </li>
          <li>
            <Link href="/admin/expositions">Expositions</Link> : examen des dossiers, contrats,
            paiements et programmation.
          </li>
          <li>
            <Link href="/admin/signalements">Signalements</Link> : contenus publiés sans
            autorisation, à masquer ou à écarter.
          </li>
          <li>
            <Link href="/admin/litiges">Réclamations</Link> : trois décisions distinctes
            (rembourser, rendre la livraison, imputer la perte).
          </li>
          <li>
            <Link href="/admin/finances">Grand livre</Link> : soldes, écritures, contrôle des
            invariants.
          </li>
          <li>
            <Link href="/admin/commandes">Expéditions</Link> : une expédition par atelier,
            affectée à la main.
          </li>
          <li>
            <Link href="/admin/outils">Outils</Link> : tâches périodiques et paiement simulé,
            tant que l’agrégateur n’est pas branché.
          </li>
        </ul>
      </Panel>
    </>
  );
}
