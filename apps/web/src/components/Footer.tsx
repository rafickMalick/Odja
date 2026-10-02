"use client";

import Link from "next/link";

import styles from "./Footer.module.css";

/* Les libellés du frame Figma étaient restés en anglais et sans destination
   (« Home / About / Service… », « Privacy Policy… »). Ils sont traduits et
   raccordés aux routes qui existent réellement, pages légales comprises. */
const MARKETPLACE_LINKS = [
  { label: "Tous les produits", href: "/catalogue" },
  { label: "Nouveautés", href: "/catalogue" },
  { label: "Rechercher", href: "/recherche" },
];

const COMPANY_LINKS = [
  { label: "Accueil", href: "/" },
  { label: "Vendre sur Ojà", href: "/inscription?profil=createur" },
  { label: "Devenir livreur", href: "/inscription?profil=livreur" },
  { label: "Contact", href: "/contact" },
];

const LEGAL_LINKS = [
  { label: "Politique de confidentialité", href: "/confidentialite" },
  { label: "Politique de cookies", href: "/cookies" },
  { label: "Conditions de vente", href: "/conditions-de-vente" },
  { label: "Mentions légales", href: "/mentions-legales" },
];

export function Footer() {
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

            <div className={styles.social}>
              <a href="#" aria-label="Twitter">
                <img
                  src="/images/social-twitter.svg"
                  alt=""
                  className={styles.socialPlain}
                />
              </a>
              <a href="#" aria-label="Facebook" className={styles.socialFramed}>
                <img
                  src="/images/social-facebook.svg"
                  alt=""
                  className={styles.socialIcon}
                />
              </a>
              <a href="#" aria-label="Instagram" className={styles.socialFramed}>
                <img
                  src="/images/social-instagram.svg"
                  alt=""
                  className={styles.socialIcon}
                />
              </a>
              <a href="#" aria-label="LinkedIn" className={styles.socialFramed}>
                <img
                  src="/images/social-linkedin.svg"
                  alt=""
                  className={styles.socialIconSmall}
                />
              </a>
            </div>

            <div className={styles.newsletter}>
              <p className={styles.newsletterLabel}>Recevoir la newsletter</p>
              <form
                className={styles.inputBar}
                onSubmit={(event) => event.preventDefault()}
              >
                <label htmlFor="newsletter-email" className="srOnly">
                  Adresse e-mail
                </label>
                <input
                  id="newsletter-email"
                  type="email"
                  placeholder="Adresse e-mail"
                />
                <button type="submit" className={styles.inputButton}>
                  Je m’inscris
                </button>
              </form>
            </div>
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
                {COMPANY_LINKS.map((link) => (
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
          <div className={styles.bottomLinks}>
            <Link href="/conditions-generales">Conditions générales</Link>
            <Link href="/confidentialite">Politique de confidentialité</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
