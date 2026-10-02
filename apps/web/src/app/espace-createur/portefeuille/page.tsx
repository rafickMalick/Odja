"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/Badge";
import {
  EmptyState,
  PageHead,
  Panel,
  StatTile,
  workspaceStyles as styles,
} from "@/components/dashboard/Workspace";
import { apiFetch } from "@/lib/api";
import { formatFcfa } from "@/lib/format";

/**
 * Portefeuille du créateur.
 *
 * Le calendrier compte autant que le montant : le versement part 24 h après
 * que le client a validé la réception, pas à la livraison. C'est écrit à
 * l'écran plutôt que dans les conditions générales.
 */

interface PayoutItem {
  id: string;
  amountXof: number;
  status: string;
  method: string;
  subOrderReference: string | null;
  releaseAt: string | null;
  paidAt: string | null;
  failureReason: string | null;
  createdAt: string;
}

interface Wallet {
  owedXof: number;
  scheduledXof: number;
  readyXof: number;
  paidXof: number;
  items: PayoutItem[];
}

const STATUS: Record<string, { type: "pending" | "success" | "info" | "warning" | "danger"; label: string }> = {
  SCHEDULED: { type: "pending", label: "Programmé" },
  READY: { type: "info", label: "Prêt à verser" },
  PROCESSING: { type: "info", label: "En cours" },
  PAID: { type: "success", label: "Versé" },
  FAILED: { type: "danger", label: "Échoué" },
  CANCELLED: { type: "warning", label: "Annulé" },
};

export default function MakerWalletPage() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void apiFetch<Wallet>("/maker/wallet")
      .then(setWallet)
      .catch(() => setWallet(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className={styles.muted}>Chargement…</p>;

  return (
    <>
      <PageHead
        title="Portefeuille"
        subtitle="Vous touchez votre prix en entier. La commission Ojà est ajoutée au prix affiché, elle n’est pas retenue sur le vôtre."
      />

      <div className={styles.statGrid}>
        <StatTile
          label="À venir"
          value={formatFcfa(wallet?.scheduledXof ?? 0)}
          hint="24 h après validation du client"
        />
        <StatTile label="Prêt à verser" value={formatFcfa(wallet?.readyXof ?? 0)} />
        <StatTile label="Déjà versé" value={formatFcfa(wallet?.paidXof ?? 0)} />
        <StatTile
          label="Solde comptable"
          value={formatFcfa(wallet?.owedXof ?? 0)}
          hint="total dû par Ojà"
        />
      </div>

      <Panel title="Versements">
        {!wallet || wallet.items.length === 0 ? (
          <EmptyState
            title="Aucun versement pour l’instant"
            text="Dès qu’un client valide la réception d’une de vos pièces, le versement est programmé et apparaît ici."
          />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Commande</th>
                  <th className={styles.numeric}>Montant</th>
                  <th>État</th>
                  <th>Échéance</th>
                  <th>Moyen</th>
                </tr>
              </thead>
              <tbody>
                {wallet.items.map((item) => {
                  const state = STATUS[item.status] ?? {
                    type: "pending" as const,
                    label: item.status,
                  };
                  return (
                    <tr key={item.id}>
                      <td>{item.subOrderReference ?? "Aucune"}</td>
                      <td className={styles.numeric}>{formatFcfa(item.amountXof)}</td>
                      <td>
                        <Badge type={state.type}>{state.label}</Badge>
                        {item.failureReason ? (
                          <p className={styles.muted}>{item.failureReason}</p>
                        ) : null}
                      </td>
                      <td>{formatDate(item.paidAt ?? item.releaseAt)}</td>
                      <td>{item.method === "MOBILE_MONEY" ? "Mobile Money" : item.method}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Comment ça marche">
        <ol className={styles.muted}>
          <li>Le client paie au moment de la commande. Ojà garde la somme.</li>
          <li>Vous préparez la pièce, le livreur l’enlève et la remet.</li>
          <li>
            Le client valide la réception. Sans réponse de sa part, la validation est
            automatique au bout de 72 h.
          </li>
          <li>Votre versement est programmé 24 h après cette validation.</li>
          <li>
            En cas de refus à la livraison, le client est remboursé du prix de la pièce et vous
            ne touchez rien pour cette commande.
          </li>
        </ol>
      </Panel>
    </>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "Non programmé";
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
