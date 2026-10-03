"use client";

import type { AdminReviewView, ReviewStatus } from "@oja/contracts";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import {
  EmptyState,
  PageHead,
  Panel,
  workspaceStyles as styles,
} from "@/components/dashboard/Workspace";
import { Stars } from "@/components/Stars";
import { ApiError, apiFetch } from "@/lib/api";

/**
 * Modération des avis clients (cahier L6-12).
 *
 * Chaque avis vient d'un achat réel, noté après réception. On le publie, ou
 * on le refuse avec un motif que l'auteur verra. Une décision peut être
 * revue depuis les onglets « Publiés » et « Refusés » ; les notes moyennes de
 * la pièce et de l'atelier suivent à chaque fois.
 */

const TABS: { status: ReviewStatus; label: string }[] = [
  { status: "PENDING", label: "À relire" },
  { status: "PUBLISHED", label: "Publiés" },
  { status: "REJECTED", label: "Refusés" },
];

export default function AdminReviewsPage() {
  const [status, setStatus] = useState<ReviewStatus>("PENDING");
  const [reviews, setReviews] = useState<AdminReviewView[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReviews(await apiFetch<AdminReviewView[]>(`/admin/reviews?status=${status}`));
    } catch {
      setReviews([]);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const moderate = async (review: AdminReviewView, decision: "PUBLISH" | "REJECT") => {
    let reason: string | undefined;
    if (decision === "REJECT") {
      const answer = window.prompt(
        "Motif du refus, montré à l’auteur (ex. : propos injurieux, hors sujet, coordonnées personnelles) :",
      );
      if (!answer?.trim()) return;
      reason = answer.trim();
    }

    setBusy(review.id);
    setError(null);
    try {
      await apiFetch(`/admin/reviews/${review.id}/moderate`, {
        method: "POST",
        body: { decision, ...(reason ? { reason } : {}) },
      });
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Décision non enregistrée.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHead
        title="Avis clients"
        subtitle="Relisez les avis avant publication. Chacun vient d’un achat réel, noté après réception."
      />

      <div className={styles.rowActions} role="tablist" aria-label="Statut des avis">
        {TABS.map((tab) => (
          <Button
            key={tab.status}
            type="button"
            role="tab"
            aria-selected={status === tab.status}
            variant={status === tab.status ? "primary" : "outline"}
            onClick={() => setStatus(tab.status)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className={styles.muted}>Chargement…</p>
      ) : reviews.length === 0 ? (
        <EmptyState
          title={status === "PENDING" ? "Aucun avis à relire" : "Aucun avis"}
          text={status === "PENDING" ? "Les nouveaux avis apparaîtront ici." : "Rien dans cet onglet."}
        />
      ) : (
        reviews.map((review) => (
          <Panel
            key={review.id}
            title={review.productName}
            action={<Stars value={review.rating} />}
          >
            <p className={styles.muted}>
              {review.authorName} ·{" "}
              {new Date(review.createdAt).toLocaleDateString("fr-FR")} · atelier{" "}
              {review.shopName} ·{" "}
              <Link href={`/produit/${review.productSlug}`} target="_blank">
                voir la fiche
              </Link>
            </p>
            <p>{review.body ?? <em className={styles.muted}>Note sans commentaire.</em>}</p>
            {review.rejectReason ? (
              <p>
                <Badge type="danger">Refusé</Badge> {review.rejectReason}
              </p>
            ) : null}
            <div className={styles.rowActions}>
              {review.status !== "REJECTED" ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => void moderate(review, "REJECT")}
                >
                  {review.status === "PUBLISHED" ? "Retirer" : "Refuser"}
                </Button>
              ) : null}
              {review.status !== "PUBLISHED" ? (
                <Button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void moderate(review, "PUBLISH")}
                >
                  {busy === review.id ? "…" : "Publier"}
                </Button>
              ) : null}
            </div>
          </Panel>
        ))
      )}
    </>
  );
}
