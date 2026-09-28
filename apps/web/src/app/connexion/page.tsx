"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import {
  AuthField,
  AuthLayout,
  authStyles as styles,
} from "@/components/AuthLayout";
import { Button } from "@/components/Button";
import { ApiError, apiFetch } from "@/lib/api";
import { homeForRole } from "@/lib/home-for-role";

function ConnexionForm() {
  const router = useRouter();
  const params = useSearchParams();
  /* Une destination explicite l'emporte : c'est celle d'où l'utilisateur a
     été renvoyé vers la connexion. Sinon, on l'envoie chez lui — un créateur
     dans son atelier, un livreur sur ses missions. */
  const requested = params.get("suite");

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const session = await apiFetch<{ user: { role: string } }>("/auth/login", {
        method: "POST",
        body: { identifier, password },
      });
      /* `refresh()` avant `push()` : les composants serveur doivent refaire
         leurs requêtes avec la nouvelle session, sinon la page d'arrivée
         s'affiche encore comme si personne n'était connecté. */
      router.refresh();
      router.push(requested ?? homeForRole(session.user.role));
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
      <div className={styles.heading}>
        <h1 className={styles.title}>Se connecter</h1>
        <Link href="/mot-de-passe-oublie" className={styles.subtitleLink}>
          Mot de passe oublié ?
        </Link>
      </div>

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

        {error ? (
          <p className={styles.legal} role="alert">
            {error}
          </p>
        ) : null}

        <Button type="submit" fullWidth disabled={pending}>
          {pending ? "Connexion…" : "Se connecter"}
        </Button>
      </form>

      <p className={styles.legal}>
        En cliquant sur « Se connecter », vous acceptez les Conditions Générales
        d&apos;Ojà, la Politique de Confidentialité et les Conditions
        d&apos;Utilisation.
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
