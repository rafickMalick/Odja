"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  PageHead,
  Panel,
  StatTile,
  workspaceStyles as styles,
} from "@/components/dashboard/Workspace";
import { apiFetch } from "@/lib/api";
import { formatFcfa } from "@/lib/format";

import admin from "../admin.module.css";

/**
 * Grand livre, en lecture seule.
 *
 * Aucune écriture n'est modifiable : la base l'interdit par trigger, et une
 * correction se fait par contre-passation. L'écran ne propose donc aucun
 * bouton de retouche  offrir une action que la base refuse serait un
 * mensonge d'interface.
 *
 * La vérification des invariants est affichée en tête. Un écart y apparaît
 * avant qu'un comptable ne le découvre en fin de mois.
 */

interface Balance {
  type: string;
  label: string;
  balanceXof: number;
  accountCount: number;
}

interface Transaction {
  id: string;
  kind: string;
  refType: string;
  refId: string;
  /** Référence métier (CMD-2026-000123…), quand l'API sait la retrouver. */
  reference: string | null;
  memo: string | null;
  createdAt: string;
  entries: { account: string; label: string; amountXof: number }[];
}

const KINDS: Record<string, string> = {
  order_paid: "Commande payée",
  psp_fee: "Frais agrégateur",
  sub_order_cancelled: "Sous-commande annulée",
  dispute_refund: "Remboursement litige",
  payout_released: "Versement libéré",
  payout_paid: "Versement exécuté",
};

export default function AdminLedgerPage() {
  const [balances, setBalances] = useState<Balance[]>([]);
  const [invariants, setInvariants] = useState<{ ok: boolean; problems: string[] } | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [ledger, list] = await Promise.all([
        apiFetch<{ accounts: Balance[]; invariants: { ok: boolean; problems: string[] } }>(
          "/admin/ledger",
        ).catch(() => null),
        apiFetch<Transaction[]>("/admin/ledger/transactions?limit=40").catch(() => []),
      ]);
      if (cancelled) return;
      setBalances(ledger?.accounts ?? []);
      setInvariants(ledger?.invariants ?? null);
      setTransactions(list);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <p className={styles.muted}>Chargement…</p>;

  return (
    <>
      <PageHead
        title="Grand livre"
        subtitle="Partie double stricte. Rien n’est modifiable : on contre-passe."
      />

      {invariants ? (
        invariants.ok ? (
          <p className={admin.invariantOk}>
            Invariants vérifiés : toutes les transactions sont équilibrées.
          </p>
        ) : (
          <Panel title="Écarts détectés">
            <ul className={styles.muted}>
              {invariants.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </Panel>
        )
      ) : null}

      <div className={styles.statGrid}>
        {balances.map((balance) => (
          <StatTile
            key={balance.type}
            label={balance.label}
            /* Les crédits sont stockés en négatif : on les présente en positif,
               en disant lequel est un dû. */
            value={formatFcfa(Math.abs(balance.balanceXof))}
            hint={
              balance.accountCount > 1
                ? `${balance.accountCount} comptes`
                : balance.balanceXof < 0
                  ? "au crédit"
                  : "au débit"
            }
          />
        ))}
      </div>

      <Panel title="Dernières écritures">
        {transactions.length === 0 ? (
          <p className={styles.muted}>Aucune écriture pour l’instant.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Nature</th>
                  <th>Référence</th>
                  <th>Écritures</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td>
                      {new Date(transaction.createdAt).toLocaleString("fr-FR", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td>{KINDS[transaction.kind] ?? transaction.kind}</td>
                    <td className={styles.muted}>
                      {transaction.reference && transaction.refType === "dispute" ? (
                        transaction.reference
                      ) : transaction.reference ? (
                        /* La sous-commande (…-A) se retrouve par sa commande. */
                        <Link
                          href={`/admin/commandes/recherche?q=${encodeURIComponent(
                            transaction.reference.replace(/-[A-Z]$/, ""),
                          )}`}
                        >
                          {transaction.reference}
                        </Link>
                      ) : (
                        `${transaction.refType} · ${transaction.refId.slice(-8)}`
                      )}
                    </td>
                    <td>
                      {transaction.entries.map((entry, index) => (
                        <div key={index}>
                          {entry.label}{" "}
                          <strong
                            className={entry.amountXof < 0 ? admin.credit : admin.debit}
                          >
                            {entry.amountXof < 0 ? "−" : "+"}
                            {formatFcfa(Math.abs(entry.amountXof))}
                          </strong>
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
