"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Field, fieldStyles } from "@/components/Field";
import {
  EmptyState,
  PageHead,
  Panel,
  workspaceStyles as styles,
} from "@/components/dashboard/Workspace";
import { ApiError, apiFetch } from "@/lib/api";

/**
 * Équipe d'administration (cahier L7-16).
 *
 * Nommer un admin se fait ici, sans accès à la base : la personne s'inscrit
 * d'abord sur le site comme client, puis un admin la nomme par son adresse.
 * Les garde-fous (pas de retrait de soi-même, jamais zéro admin, sessions
 * fermées à chaque changement) sont tenus par l'API : l'écran les annonce,
 * il ne les remplace pas.
 */

interface AdminMember {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  createdAt: string;
  isYou: boolean;
  mfaEnabled: boolean;
}

export default function AdminTeamPage() {
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    try {
      setMembers(await apiFetch<AdminMember[]>("/admin/team"));
    } catch {
      setError("Chargement impossible.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const grant = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy("grant");
    setError(null);
    setNotice(null);
    try {
      const added = await apiFetch<AdminMember>("/admin/team", {
        method: "POST",
        body: { email: email.trim() },
      });
      setEmail("");
      setNotice(
        `${added.firstName} ${added.lastName} est maintenant administrateur. ` +
          "Ses sessions ont été fermées : à sa prochaine connexion, l'espace admin s'ouvrira.",
      );
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Nomination refusée.");
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (member: AdminMember) => {
    const confirmed = window.confirm(
      `Retirer les droits d'administrateur de ${member.firstName} ${member.lastName} ?\n` +
        "Le compte redevient un compte client et ses sessions sont fermées immédiatement.",
    );
    if (!confirmed) return;

    setBusy(member.id);
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/admin/team/${member.id}`, { method: "DELETE" });
      setNotice(`${member.firstName} ${member.lastName} n'est plus administrateur.`);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Retrait refusé.");
    } finally {
      setBusy(null);
    }
  };

  /* Téléphone perdu : un collègue efface la double authentification. Jamais
     la sienne — l'API le refuse, l'écran n'en propose pas le geste. */
  const resetMfa = async (member: AdminMember) => {
    const confirmed = window.confirm(
      `Réinitialiser la double authentification de ${member.firstName} ${member.lastName} ?
` +
        "Ses sessions sont fermées ; à sa prochaine connexion, il ou elle la réactivera.",
    );
    if (!confirmed) return;

    setBusy(`mfa:${member.id}`);
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/admin/team/${member.id}/mfa/reset`, { method: "POST" });
      setNotice(
        `Double authentification de ${member.firstName} ${member.lastName} réinitialisée.`,
      );
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Réinitialisation refusée.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHead
        title="Administrateurs"
        subtitle="Nommez ou retirez les personnes qui ont accès à cet espace."
      />

      <Panel title="Nommer un administrateur">
        <p className={styles.muted}>
          La personne doit d’abord s’inscrire sur le site avec un compte client. Saisissez
          ensuite son adresse e-mail : elle devra se reconnecter pour accéder à l’administration.
        </p>
        <form onSubmit={grant} className={styles.form}>
          <Field label="Adresse e-mail du compte">
            <input
              className={fieldStyles.control}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="prenom.nom@exemple.com"
              autoComplete="off"
              required
            />
          </Field>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className={styles.muted} role="status">
              {notice}
            </p>
          ) : null}
          <Button type="submit" disabled={busy !== null || !email.trim()}>
            {busy === "grant" ? "Nomination…" : "Nommer administrateur"}
          </Button>
        </form>
      </Panel>

      <Panel title={`Équipe actuelle (${members.length})`}>
        {loading ? (
          <p className={styles.muted}>Chargement…</p>
        ) : members.length === 0 ? (
          <EmptyState title="Aucun administrateur" text="Nommez-en un ci-dessus." />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>E-mail</th>
                  <th>Compte créé le</th>
                  <th>Double authentification</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id}>
                    <td>
                      <strong>
                        {member.firstName} {member.lastName}
                      </strong>{" "}
                      {member.isYou ? <Badge type="info">Vous</Badge> : null}
                    </td>
                    <td>{member.email}</td>
                    <td>{new Date(member.createdAt).toLocaleDateString("fr-FR")}</td>
                    <td>
                      {member.mfaEnabled ? (
                        <Badge type="success">Activée</Badge>
                      ) : (
                        <Badge type="pending">À activer</Badge>
                      )}
                    </td>
                    <td className={styles.rowActions}>
                      {!member.isYou && member.mfaEnabled ? (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busy !== null}
                          onClick={() => void resetMfa(member)}
                        >
                          {busy === `mfa:${member.id}` ? "Réinitialisation…" : "Réinitialiser la 2FA"}
                        </Button>
                      ) : null}
                      {/* Ni retrait de soi-même, ni retrait du dernier admin :
                          l'API les refuse, l'écran n'en propose pas le geste. */}
                      {!member.isYou && members.length > 1 ? (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busy !== null}
                          onClick={() => void revoke(member)}
                        >
                          {busy === member.id ? "Retrait…" : "Retirer"}
                        </Button>
                      ) : null}
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
