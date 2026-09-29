import Link from "next/link";
import type { ReactNode } from "react";

import styles from "./AuthLayout.module.css";

/** Visuel de gauche, commun aux écrans Connexion et Inscription. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className={styles.root}>
      <div className={styles.visual}>
        <img src="/images/auth-side.png" alt="" className={styles.visualImage} />
        <Link href="/" aria-label="Ojà — accueil">
          <img
            src="/images/logo-oja-white.svg"
            alt=""
            className={styles.visualLogo}
          />
        </Link>
      </div>
      <div className={styles.panel}>{children}</div>
    </main>
  );
}

/**
 * Bascule Connexion / Inscription.
 *
 * Visible en haut, avant tout champ : sans elle, se tromper de page impose de
 * remplir un formulaire entier avant de trouver, tout en bas, le lien vers
 * l'autre écran.
 */
export function AuthTabs({ active }: { active: "connexion" | "inscription" }) {
  return (
    <div className={styles.tabs} role="tablist" aria-label="Connexion ou inscription">
      <Link
        href="/connexion"
        role="tab"
        aria-selected={active === "connexion"}
        className={`${styles.tab} ${active === "connexion" ? styles.tabActive : ""}`}
      >
        Se connecter
      </Link>
      <Link
        href="/inscription"
        role="tab"
        aria-selected={active === "inscription"}
        className={`${styles.tab} ${active === "inscription" ? styles.tabActive : ""}`}
      >
        Créer un compte
      </Link>
    </div>
  );
}

export function AuthField({
  label,
  error,
  valid,
  ...rest
}: {
  label: string;
  error?: string;
  /** Coche verte une fois le champ confirmé correct, sans erreur posée. */
  valid?: boolean;
} & React.ComponentProps<"input">) {
  const id = `auth-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const showValid = !error && valid === true;

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.fieldLabel}>
        {label}
      </label>
      <div className={styles.inputWrap}>
        <input
          id={id}
          className={`${styles.input} ${error ? styles.inputError : ""} ${
            showValid ? styles.inputValid : ""
          }`}
          aria-invalid={error ? true : undefined}
          {...rest}
        />
        {showValid ? (
          <span className={styles.validMark} aria-hidden="true">
            ✓
          </span>
        ) : null}
      </div>
      {error ? (
        <p className={styles.fieldError} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export { styles as authStyles };
