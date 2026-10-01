"use client";

import Link from "next/link";
import { useState } from "react";

import {
  AuthField,
  AuthLayout,
  authStyles as styles,
} from "@/components/AuthLayout";
import { Button } from "@/components/Button";
import { ApiError, apiFetch } from "@/lib/api";

/**
 * Réinitialisation du mot de passe, en deux temps.
 *
 * L'API ne dit jamais si l'identifiant existe (`/auth/forgot-password`
 * répond pareil dans les deux cas) : le front ne peut donc pas conditionner
 * le passage à l'étape suivante sur une réponse de succès distincte d'un
 * échec  il avance dès que la demande part, comme l'API le veut.
 */
export default function MotDePasseOubliePage() {
  const [step, setStep] = useState<"demande" | "code">("demande");
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await apiFetch("/auth/forgot-password", { method: "POST", body: { identifier } });
      setStep("code");
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : "Envoi impossible pour le moment.",
      );
    } finally {
      setPending(false);
    }
  };

  const handleReset = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await apiFetch("/auth/reset-password", {
        method: "POST",
        body: { identifier, code, password },
      });
      setDone(true);
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : "Réinitialisation impossible pour le moment.",
      );
    } finally {
      setPending(false);
    }
  };

  if (done) {
    return (
      <AuthLayout>
        <div className={styles.heading}>
          <h1 className={styles.title}>Mot de passe modifié</h1>
        </div>
        <p className={styles.legal}>
          Toutes les sessions ouvertes ont été fermées. Connectez-vous avec votre
          nouveau mot de passe.
        </p>
        <Button type="button" fullWidth onClick={() => (window.location.href = "/connexion")}>
          Se connecter
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className={styles.heading}>
        <h1 className={styles.title}>Mot de passe oublié</h1>
      </div>

      {step === "demande" ? (
        <form className={styles.group} onSubmit={handleRequest}>
          <p className={styles.groupTitle}>Identifiants</p>
          <p className={styles.legal}>
            Entrez l&apos;e-mail ou le téléphone du compte. Si un compte lui
            correspond, un code à 6 chiffres est envoyé.
          </p>

          <AuthField
            label="E-mail ou téléphone"
            type="text"
            placeholder="jean@email.com ou +229 01 00 00 00 00"
            autoComplete="username"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            required
          />

          {error ? (
            <p className={styles.legal} role="alert">
              {error}
            </p>
          ) : null}

          <Button type="submit" fullWidth disabled={pending}>
            {pending ? "Envoi…" : "Recevoir le code"}
          </Button>
        </form>
      ) : (
        <form className={styles.group} onSubmit={handleReset}>
          <p className={styles.groupTitle}>Nouveau mot de passe</p>
          <p className={styles.legal}>
            Un code a été envoyé à « {identifier} », s&apos;il correspond à un
            compte.
          </p>

          <AuthField
            label="Code à 6 chiffres"
            type="text"
            inputMode="numeric"
            placeholder="000000"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            required
          />
          <AuthField
            label="Nouveau mot de passe"
            type="password"
            placeholder="Au moins 10 caractères"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />

          {error ? (
            <p className={styles.legal} role="alert">
              {error}
            </p>
          ) : null}

          <Button type="submit" fullWidth disabled={pending}>
            {pending ? "Validation…" : "Changer le mot de passe"}
          </Button>
        </form>
      )}

      <p className={styles.switch}>
        <Link href="/connexion">Retour à la connexion</Link>
      </p>
    </AuthLayout>
  );
}
