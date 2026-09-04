"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Field, FieldRow } from "@/components/Field";
import { PageHead, Panel, workspaceStyles as styles } from "@/components/dashboard/Workspace";
import { ApiError, apiFetch } from "@/lib/api";

import profile from "./profil.module.css";

/**
 * Mon profil.
 *
 * L'e-mail et le téléphone sont affichés mais non modifiables : ce sont les
 * identifiants de connexion, et les changer suppose de vérifier le nouveau
 * canal avant d'abandonner l'ancien. Laisser un champ libre ici, c'est
 * fabriquer des comptes sans porte d'entrée.
 */

interface User {
  id: string;
  role: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  emailVerified: boolean;
  phoneVerified: boolean;
}

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const me = await apiFetch<User>("/auth/me").catch(() => null);
    if (!me) return;
    setUser(me);
    setFirstName(me.firstName);
    setLastName(me.lastName);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await apiFetch("/auth/me", { method: "PATCH", body: { firstName, lastName } });
      setMessage("Profil enregistré.");
      await load();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  };

  if (!user) return <p className={styles.muted}>Chargement…</p>;

  return (
    <>
      <PageHead title="Mon profil" subtitle="Vos informations de compte." />

      <Panel title="Identité">
        <form onSubmit={save} className={profile.form} noValidate>
          <FieldRow>
            <Field
              label="Nom"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
            />
            <Field
              label="Prénom"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
            />
          </FieldRow>

          {message ? <p className={styles.muted}>{message}</p> : null}

          <div className={styles.rowActions}>
            <Button type="submit" disabled={busy}>
              {busy ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </div>
        </form>
      </Panel>

      <Panel title="Identifiants de connexion">
        <div className={profile.rows}>
          <div>
            <span>E-mail</span>
            <strong>
              {user.email}{" "}
              {user.emailVerified ? (
                <Badge type="success">Vérifié</Badge>
              ) : (
                <Badge type="warning">Non vérifié</Badge>
              )}
            </strong>
          </div>
          <div>
            <span>Téléphone</span>
            <strong>{user.phone}</strong>
          </div>
        </div>
        <p className={styles.muted}>
          Pour changer d’e-mail ou de numéro, écrivez-nous : nous vérifions le nouveau canal
          avant de retirer l’ancien, pour ne jamais vous laisser sans accès.
        </p>
      </Panel>

      <PasswordPanel />
    </>
  );
}

function PasswordPanel() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setDone(false);

    if (password !== confirm) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }

    setBusy(true);
    try {
      await apiFetch("/auth/change-password", {
        method: "POST",
        body: { currentPassword, password },
      });
      setCurrentPassword("");
      setPassword("");
      setConfirm("");
      setDone(true);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Changement impossible.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Mot de passe">
      <form onSubmit={submit} className={profile.form} noValidate>
        <Field
          label="Mot de passe actuel"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
        <FieldRow>
          <Field
            label="Nouveau mot de passe"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <Field
            label="Confirmer"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </FieldRow>

        {error ? <p className={styles.error}>{error}</p> : null}
        {done ? (
          <p className={styles.muted}>
            Mot de passe modifié. Vos autres appareils ont été déconnectés.
          </p>
        ) : null}

        <div className={styles.rowActions}>
          <Button type="submit" disabled={busy || !currentPassword || !password}>
            {busy ? "…" : "Changer le mot de passe"}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
