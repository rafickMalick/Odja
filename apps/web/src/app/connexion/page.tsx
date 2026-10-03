"use client";

import type { LoginResult, PublicUser } from "@oja/contracts";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import {
  AuthField,
  AuthLayout,
  AuthTabs,
  authStyles as styles,
} from "@/components/AuthLayout";
import { Button } from "@/components/Button";
import { ApiError, apiFetch } from "@/lib/api";
import { homeForRole } from "@/lib/home-for-role";
import { safeReturnPath } from "@/lib/login-redirect";
import { useRedirectSignedIn } from "@/lib/session";

function ConnexionForm() {
  useRedirectSignedIn();
  const router = useRouter();
  const params = useSearchParams();
  /* Une destination explicite l'emporte : c'est celle d'où l'utilisateur a
     été renvoyé vers la connexion. Sinon, on l'envoie chez lui  un créateur
     dans son atelier, un livreur sur ses missions. */
  const requested = safeReturnPath(params.get("suite"));

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  /* Double authentification : le mot de passe a été accepté, l'API attend le
     code de l'application avant d'ouvrir la session. */
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");

  const enter = (user: PublicUser) => {
    /* `refresh()` avant `push()` : les composants serveur doivent refaire
       leurs requêtes avec la nouvelle session, sinon la page d'arrivée
       s'affiche encore comme si personne n'était connecté. */
    router.refresh();
    router.push(requested ?? homeForRole(user.role));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      if (challenge) {
        const session = await apiFetch<{ user: PublicUser }>("/auth/login/mfa", {
          method: "POST",
          body: { challenge, code },
        });
        enter(session.user);
        return;
      }

      const result = await apiFetch<LoginResult>("/auth/login", {
        method: "POST",
        body: { identifier, password },
      });
      if (result.mfaRequired) {
        setChallenge(result.challenge);
        return;
      }
      enter(result.user);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Connexion impossible pour le moment.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthLayout>
      <AuthTabs active="connexion" />

      <div className={styles.heading}>
        <h1 className={styles.title}>Se connecter</h1>
      </div>

      {challenge ? (
        <form className={styles.group} onSubmit={handleSubmit}>
          <p className={styles.groupTitle}>Double authentification</p>
          <p className={styles.legal}>
            Ouvrez votre application d&apos;authentification et saisissez le code à 6
            chiffres affiché pour Ojà. Téléphone perdu ? Saisissez l&apos;un de vos codes
            de secours.
          </p>
          <AuthField
            label="Code"
            type="text"
            inputMode="text"
            placeholder="123 456"
            autoComplete="one-time-code"
            autoFocus
            value={code}
            onChange={(event) => setCode(event.target.value)}
            required
          />

          {error ? (
            <p className={styles.legal} role="alert">
              {error}
            </p>
          ) : null}

          <Button type="submit" fullWidth disabled={pending}>
            {pending ? "Vérification…" : "Valider"}
          </Button>
          <button
            type="button"
            className={styles.forgotLink}
            onClick={() => {
              setChallenge(null);
              setCode("");
              setError(null);
            }}
          >
            Recommencer la connexion
          </button>
        </form>
      ) : (
        <form className={styles.group} onSubmit={handleSubmit}>
          <p className={styles.groupTitle}>Identifiants</p>

          {/* Le téléphone est l'identité sur ce marché : la connexion accepte
              l'un ou l'autre plutôt que d'imposer l'e-mail. */}
          <AuthField
            label="E-mail ou téléphone"
            type="text"
            placeholder="jean@email.com ou +229 01 00 00 00 00"
            autoComplete="username"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            required
          />
          <AuthField
            label="Mot de passe"
            type="password"
            placeholder="Entrez votre mot de passe"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <Link href="/mot-de-passe-oublie" className={styles.forgotLink}>
            Mot de passe oublié ?
          </Link>

          {error ? (
            <p className={styles.legal} role="alert">
              {error}
            </p>
          ) : null}

          <Button type="submit" fullWidth disabled={pending}>
            {pending ? "Connexion…" : "Se connecter"}
          </Button>
        </form>
      )}

      <p className={styles.legal}>
        En cliquant sur « Se connecter », vous acceptez les{" "}
        <Link href="/conditions-generales">conditions générales d&apos;utilisation</Link>{" "}
        d&apos;Ojà et sa <Link href="/confidentialite">politique de confidentialité</Link>.
      </p>

      <p className={styles.switch}>
        Pas encore de compte ? <Link href="/inscription">S&apos;inscrire</Link>
      </p>
    </AuthLayout>
  );
}

/* `useSearchParams` impose une frontière Suspense. */
export default function ConnexionPage() {
  return (
    <Suspense>
      <ConnexionForm />
    </Suspense>
  );
}
