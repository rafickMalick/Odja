"use client";

import type {
  MfaRecoveryCodes,
  MfaSetup,
  MfaStatus,
  PublicUser,
} from "@oja/contracts";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { AuthField, AuthLayout, authStyles } from "@/components/AuthLayout";
import { Button } from "@/components/Button";
import { ApiError, apiFetch } from "@/lib/api";
import { homeForRole } from "@/lib/home-for-role";
import { loginUrl, safeReturnPath } from "@/lib/login-redirect";

import styles from "./page.module.css";

/**
 * Double authentification du compte connecté (cahier L0-22, L7-16).
 *
 * Obligatoire pour un administrateur : l'espace admin y renvoie tant qu'elle
 * n'est pas activée, puis ramène à la page d'origine (`?suite=`). Facultative
 * pour les autres comptes.
 *
 * L'activation se fait en deux temps — la clé, puis un premier code — pour
 * qu'une clé mal recopiée ne verrouille jamais le compte. Les codes de
 * secours ne s'affichent qu'une fois : l'API n'en garde que l'empreinte.
 */

type Step = "status" | "setup" | "codes";

function DoubleAuthentification() {
  const router = useRouter();
  const params = useSearchParams();
  const suite = safeReturnPath(params.get("suite"));

  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [step, setStep] = useState<Step>("status");
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      apiFetch<MfaStatus>("/auth/mfa"),
      apiFetch<PublicUser>("/auth/me"),
    ])
      .then(([mfa, me]) => {
        setStatus(mfa);
        setUser(me);
      })
      .catch((cause) => {
        if (cause instanceof ApiError && cause.isUnauthorized) {
          router.replace(loginUrl("/double-authentification"));
        } else {
          setError("Chargement impossible. Réessayez dans un instant.");
        }
      });
  }, [router]);

  const run = async (action: () => Promise<void>) => {
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Opération impossible pour le moment.");
    } finally {
      setPending(false);
    }
  };

  const start = () =>
    run(async () => {
      setSetup(await apiFetch<MfaSetup>("/auth/mfa/setup", { method: "POST" }));
      setCode("");
      setStep("setup");
    });

  const confirm = (event: React.FormEvent) => {
    event.preventDefault();
    return run(async () => {
      const result = await apiFetch<MfaRecoveryCodes>("/auth/mfa/enable", {
        method: "POST",
        body: { code },
      });
      setRecoveryCodes(result.recoveryCodes);
      setStatus((current) =>
        current
          ? { ...current, enabled: true, sessionVerified: true, recoveryCodesLeft: 10 }
          : current,
      );
      setCode("");
      setStep("codes");
    });
  };

  const regenerate = () =>
    run(async () => {
      const result = await apiFetch<MfaRecoveryCodes>("/auth/mfa/recovery-codes", {
        method: "POST",
        body: { code },
      });
      setRecoveryCodes(result.recoveryCodes);
      setCode("");
      setStep("codes");
    });

  const disable = () =>
    run(async () => {
      await apiFetch("/auth/mfa/disable", { method: "POST", body: { code } });
      setStatus((current) => (current ? { ...current, enabled: false, recoveryCodesLeft: 0 } : current));
      setCode("");
    });

  const reconnect = () =>
    run(async () => {
      await apiFetch("/auth/logout", { method: "POST" }).catch(() => undefined);
      router.replace(loginUrl(suite ?? "/admin"));
    });

  const done = suite ?? (user ? homeForRole(user.role) : "/");

  return (
    <AuthLayout>
      <div className={authStyles.heading}>
        <h1 className={authStyles.title}>Double authentification</h1>
      </div>

      {!status ? (
        <p className={authStyles.legal} role={error ? "alert" : "status"}>
          {error ?? "Chargement…"}
        </p>
      ) : step === "codes" ? (
        <div className={authStyles.group}>
          <p className={authStyles.groupTitle}>Vos codes de secours</p>
          <p className={authStyles.legal}>
            Chacun ouvre la session <strong>une seule fois</strong> si vous perdez votre
            téléphone. Recopiez-les ou enregistrez-les dans votre gestionnaire de mots de
            passe : ils ne s&apos;afficheront plus.
          </p>
          <ul className={styles.codes}>
            {recoveryCodes.map((recovery) => (
              <li key={recovery}>{recovery}</li>
            ))}
          </ul>
          <Button
            type="button"
            variant="secondary"
            fullWidth
            onClick={() => void navigator.clipboard?.writeText(recoveryCodes.join("\n"))}
          >
            Copier les codes
          </Button>
          <Button type="button" fullWidth onClick={() => router.push(done)}>
            J&apos;ai mis mes codes à l&apos;abri
          </Button>
        </div>
      ) : step === "setup" && setup ? (
        <form className={authStyles.group} onSubmit={confirm}>
          <p className={authStyles.groupTitle}>1. Ajoutez Ojà à votre application</p>
          <p className={authStyles.legal}>
            Dans Google Authenticator, Microsoft Authenticator ou 1Password, choisissez
            « Saisir une clé de configuration » et recopiez cette clé :
          </p>
          <p className={styles.secret} aria-label="Clé de configuration">
            {setup.secret.match(/.{1,4}/g)?.join(" ")}
          </p>
          <a href={setup.otpauthUrl} className={styles.appLink}>
            Sur ce téléphone ? Ouvrir directement dans l&apos;application
          </a>

          <p className={authStyles.groupTitle}>2. Saisissez le code affiché</p>
          <AuthField
            label="Code à 6 chiffres"
            type="text"
            inputMode="numeric"
            placeholder="123456"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            required
          />
          {error ? (
            <p className={authStyles.legal} role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" fullWidth disabled={pending}>
            {pending ? "Vérification…" : "Activer la double authentification"}
          </Button>
        </form>
      ) : !status.enabled ? (
        <div className={authStyles.group}>
          <p className={authStyles.legal}>
            {status.required
              ? "L’espace administrateur l’exige : un mot de passe volé ne doit pas suffire à ouvrir le grand livre ni à arbitrer un litige."
              : "Facultative pour votre compte, elle le protège même si votre mot de passe fuit."}{" "}
            À chaque connexion, vous saisirez en plus un code à 6 chiffres donné par une
            application sur votre téléphone.
          </p>
          {error ? (
            <p className={authStyles.legal} role="alert">
              {error}
            </p>
          ) : null}
          <Button type="button" fullWidth disabled={pending} onClick={() => void start()}>
            {pending ? "Préparation…" : "Activer la double authentification"}
          </Button>
        </div>
      ) : status.required && !status.sessionVerified ? (
        <div className={authStyles.group}>
          <p className={authStyles.legal}>
            Votre double authentification est activée, mais cette session a été ouverte
            sans code. Reconnectez-vous en saisissant le code de votre application.
          </p>
          <Button type="button" fullWidth disabled={pending} onClick={() => void reconnect()}>
            Me reconnecter
          </Button>
        </div>
      ) : (
        <div className={authStyles.group}>
          <p className={authStyles.groupTitle}>Activée</p>
          <p className={authStyles.legal}>
            {status.recoveryCodesLeft} code{status.recoveryCodesLeft > 1 ? "s" : ""} de
            secours restant{status.recoveryCodesLeft > 1 ? "s" : ""}. Pour en générer de
            nouveaux{status.required ? "" : " ou désactiver la protection"}, saisissez un
            code de votre application.
          </p>
          <AuthField
            label="Code à 6 chiffres"
            type="text"
            inputMode="numeric"
            placeholder="123456"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          {error ? (
            <p className={authStyles.legal} role="alert">
              {error}
            </p>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            fullWidth
            disabled={pending || !code}
            onClick={() => void regenerate()}
          >
            Nouveaux codes de secours
          </Button>
          {status.required ? null : (
            <Button
              type="button"
              variant="secondary"
              fullWidth
              disabled={pending || !code}
              onClick={() => void disable()}
            >
              Désactiver
            </Button>
          )}
          <Link href={done} className={authStyles.forgotLink}>
            Retour
          </Link>
        </div>
      )}
    </AuthLayout>
  );
}

/* `useSearchParams` impose une frontière Suspense. */
export default function DoubleAuthentificationPage() {
  return (
    <Suspense>
      <DoubleAuthentification />
    </Suspense>
  );
}
