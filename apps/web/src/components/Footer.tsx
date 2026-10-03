"use client";

import type { NewsletterSubscribeInput } from "@oja/contracts";
import Link from "next/link";
import { useState } from "react";

import { ApiError, apiFetch } from "@/lib/api";
import { seesSignupCalls, useSession } from "@/lib/session";

import styles from "./Footer.module.css";

/* Les libellés du frame Figma étaient restés en anglais et sans destination
   (« Home / About / Service… », « Privacy Policy… »). Ils sont traduits et
   raccordés aux routes qui existent réellement, pages légales comprises. */
const MARKETPLACE_LINKS = [
  { label: "Tous les produits", href: "/catalogue" },
  { label: "Nouveautés", href: "/catalogue" },
  { label: "Rechercher", href: "/recherche" },
];

/* `signup` : appel à créer un compte, retiré pour un compte connecté. */
const COMPANY_LINKS = [
  { label: "Accueil", href: "/" },
  { label: "Vendre sur Ojà", href: "/inscription?profil=createur", signup: true },
  { label: "Devenir livreur", href: "/inscription?profil=livreur", signup: true },
  { label: "Contact", href: "/contact" },
];

/* Pages officielles d'Ojà. LinkedIn : la page de l'entreprise, pas une
   publication. */
const SOCIAL_LINKS = {
  instagram: "https://www.instagram.com/oja.bj",
  linkedin: "https://www.linkedin.com/company/%E1%BB%8Dj%C3%A0",
};

const LEGAL_LINKS = [
  { label: "Conditions générales", href: "/conditions-generales" },
  { label: "Politique de confidentialité", href: "/confidentialite" },
  { label: "Politique de cookies", href: "/cookies" },
  { label: "Conditions de vente", href: "/conditions-de-vente" },
  { label: "Mentions légales", href: "/mentions-legales" },
];

export function Footer() {
  const { user } = useSession();
  const companyLinks = COMPANY_LINKS.filter(
    (link) => !link.signup || seesSignupCalls(user),
  );

  return (
    <footer className={styles.root}>
      <div className={styles.callout}>
        <div className={styles.calloutInner}>
          <p className={styles.calloutTitle}>
            Inscrivez-vous pour profiter des soldes !
          </p>
          <p className={styles.calloutText}>
            Soyez les premiers informés des offres exclusives, des nouveautés et
            des promotions spéciales, le tout conçu pour apporter style, confort
            et économies à votre intérieur.
          </p>
        </div>
      </div>

      <div className={styles.links}>
        <div className={styles.top}>
          <div className={styles.brand}>
            <Link href="/" className={styles.logo} aria-label="Ojà, accueil">
              <img
                src="/images/logo-oja.svg"
                alt=""
                className={styles.logoImage}
              />
            </Link>

            {/* Seuls les comptes qui existent : X et Facebook pointaient vers
                `#`. Liens externes ouverts dans un nouvel onglet, sans transmettre
                la page d'origine (`noopener noreferrer`). */}
            <div className={styles.social}>
              <a
                href={SOCIAL_LINKS.instagram}
                aria-label="Instagram d’Ojà"
                className={styles.socialFramed}
                target="_blank"
                rel="noopener noreferrer"
              >
                <img
                  src="/images/social-instagram.svg"
                  alt=""
                  className={styles.socialIcon}
                />
              </a>
              <a
                href={SOCIAL_LINKS.linkedin}
                aria-label="LinkedIn d’Ojà"
                className={styles.socialFramed}
                target="_blank"
                rel="noopener noreferrer"
              >
                <img
                  src="/images/social-linkedin.svg"
                  alt=""
                  className={styles.socialIconSmall}
                />
              </a>
            </div>

            <NewsletterForm />
          </div>

          <nav className={styles.menu} aria-label="Pied de page">
            <div className={styles.column}>
              <p className={styles.columnLabelSmall}>Marketplace</p>
              <div className={styles.listSmall}>
                {MARKETPLACE_LINKS.map((link) => (
                  <Link key={link.label} href={link.href}>
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>

            <div className={`${styles.column} ${styles.columnNarrow}`}>
              <p className={styles.columnLabel}>Ojà</p>
              <div className={styles.list}>
                {companyLinks.map((link) => (
                  <Link key={link.label} href={link.href}>
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>

            <div className={`${styles.column} ${styles.columnNarrow}`}>
              <p className={styles.columnLabel}>Informations légales</p>
              <div className={styles.list}>
                {LEGAL_LINKS.map((link) => (
                  <Link key={link.label} href={link.href}>
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>
          </nav>
        </div>

        <div className={styles.divider} />

        <div className={styles.bottom}>
          <p>Copyright © 2026 Ojà. Tous droits réservés.</p>
        </div>
      </div>
    </footer>
  );
}

/* L'accusé ne s'affiche qu'une fois l'adresse réellement enregistrée, comme
   sur le formulaire de contact. */
function NewsletterForm() {
  const [status, setStatus] = useState<"idle" | "pending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: NewsletterSubscribeInput = {
      email: String(form.get("email") ?? ""),
      website: String(form.get("website") ?? ""),
    };

    setStatus("pending");
    setError(null);
    try {
      await apiFetch("/newsletter", { method: "POST", body });
      setStatus("done");
    } catch (cause) {
      setStatus("idle");
      setError(
        cause instanceof ApiError
          ? (cause.fieldError("email") ?? cause.message)
          : "Inscription impossible pour le moment. Réessayez.",
      );
    }
  };

  return (
    <div className={styles.newsletter}>
      <p className={styles.newsletterLabel}>Recevoir la newsletter</p>
      {status === "done" ? (
        <p className={styles.newsletterNote} role="status">
          C’est noté : vous recevrez nos prochaines offres et nouveautés.
        </p>
      ) : (
        <>
          <form className={styles.inputBar} onSubmit={handleSubmit}>
            <label htmlFor="newsletter-email" className="srOnly">
              Adresse e-mail
            </label>
            <input
              id="newsletter-email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="Adresse e-mail"
              maxLength={180}
              required
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "newsletter-error" : undefined}
            />
            <div className={styles.trap} aria-hidden="true">
              <label>
                Site web
                <input type="text" name="website" tabIndex={-1} autoComplete="off" />
              </label>
            </div>
            <button
              type="submit"
              className={styles.inputButton}
              disabled={status === "pending"}
            >
              {status === "pending" ? "Envoi…" : "Je m’inscris"}
            </button>
          </form>
          {error ? (
            <p id="newsletter-error" className={styles.newsletterError} role="alert">
              {error}
            </p>
          ) : (
            <p className={styles.newsletterNote}>
              Désinscription en un clic dans chaque e-mail.{" "}
              <Link href="/confidentialite">Vos données</Link>
            </p>
          )}
        </>
      )}
    </div>
  );
}
