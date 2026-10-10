"use client";

import type { MyVisibility, VisibilityPlanView } from "@oja/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/Badge";
import { PageHead, Panel, StatTile, workspaceStyles as styles } from "@/components/dashboard/Workspace";
import { apiFetch } from "@/lib/api";
import { formatFcfa } from "@/lib/format";

import page from "./visibility.module.css";

/**
 * Formule de visibilité du créateur (cahier des évolutions, § 3).
 *
 * Tant que le paiement en ligne du Premium n'existe pas, l'activation passe
 * par l'équipe Ojà : la page dit ce que la formule apporte, et comment la
 * demander. Elle rappelle aussi que la visibilité achetée n'est pas une
 * certification de qualité.
 */
export default function VisibilityPage() {
  const [data, setData] = useState<MyVisibility | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    apiFetch<MyVisibility>("/maker/visibility")
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  if (failed) return <p className={styles.error}>Impossible de charger votre formule.</p>;
  if (!data) return <p className={styles.muted}>Chargement…</p>;

  const { current, activeCount, plans, history } = data;
  const quota =
    current.maxPublications === null
      ? "Illimité"
      : `${activeCount} / ${current.maxPublications}`;

  return (
    <>
      <PageHead
        title="Visibilité"
        subtitle="Votre formule, ce qu’elle permet, et comment en changer."
        action={<Badge type={current.code === "standard" ? "pending" : "success"}>{current.name}</Badge>}
      />

      <div className={styles.statGrid}>
        <StatTile label="Formule en cours" value={current.name} />
        <StatTile
          label="Fiches actives"
          value={quota}
          hint="Brouillons compris. Les fiches archivées ne comptent pas."
        />
        <StatTile
          label="Échéance"
          value={current.endsAt ? new Date(current.endsAt).toLocaleDateString("fr-FR") : "Sans échéance"}
        />
      </div>

      <Panel title="Les formules">
        <p className={styles.muted}>
          Une formule achète de la visibilité commerciale. Elle ne dit rien de la qualité de votre
          travail : un atelier Standard et un atelier Premium sont vérifiés de la même façon.
        </p>
        <div className={page.plans}>
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} current={plan.code === current.code} />
          ))}
        </div>
        <p className={styles.muted}>
          Pour passer à une formule supérieure, écrivez à l’équipe Ojà depuis le{" "}
          <Link href="/espace-createur/support">support créateur</Link>. Elle l’active dès réception
          de votre règlement.
        </p>
      </Panel>

      {history.length > 0 ? (
        <Panel title="Historique">
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Formule</th>
                  <th>Du</th>
                  <th>Au</th>
                  <th>État</th>
                </tr>
              </thead>
              <tbody>
                {history.map((period) => (
                  <tr key={period.id}>
                    <td>{period.plan.name}</td>
                    <td>{new Date(period.startsAt).toLocaleDateString("fr-FR")}</td>
                    <td>
                      {period.endsAt ? new Date(period.endsAt).toLocaleDateString("fr-FR") : "—"}
                    </td>
                    <td>
                      {period.cancelledAt ? (
                        <Badge type="danger">Résiliée</Badge>
                      ) : period.active ? (
                        <Badge type="success">En cours</Badge>
                      ) : (
                        <Badge type="pending">Terminée</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}
    </>
  );
}

function PlanCard({ plan, current }: { plan: VisibilityPlanView; current: boolean }) {
  return (
    <article className={current ? page.planCurrent : page.plan}>
      <div className={page.planHead}>
        <h3 className={page.planName}>{plan.name}</h3>
        {current ? <Badge type="success">Votre formule</Badge> : null}
      </div>
      <p className={page.planPrice}>
        {plan.priceXof > 0
          ? `${formatFcfa(plan.priceXof)}${plan.durationDays ? ` / ${plan.durationDays} jours` : ""}`
          : plan.isDefault
            ? "Inclus"
            : "Tarif sur demande"}
      </p>
      {plan.description ? <p className={styles.muted}>{plan.description}</p> : null}
      <ul className={page.perks}>
        {plan.perks.map((perk) => (
          <li key={perk}>{perk}</li>
        ))}
      </ul>
    </article>
  );
}
