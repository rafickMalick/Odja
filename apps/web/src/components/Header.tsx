"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { apiFetchOrNull } from "@/lib/api";
import { useCart } from "@/lib/cart";
import { SPACE_LABEL, homeForRole } from "@/lib/home-for-role";

import { NotificationsBell } from "./NotificationsBell";
import styles from "./Header.module.css";

const NAV_LINKS = [
  { label: "Marketplace", href: "/catalogue" },
  { label: "Vendre sur Ojà", href: "/inscription" },
  { label: "À propos", href: "/a-propos" },
  { label: "Contact", href: "/contact" },
];

/* Raccourcis proposés uniquement dans le panneau mobile : sur desktop ils
   vivent déjà dans la barre d'actions ou dans le corps des pages. */
const DRAWER_ANONYMOUS = [
  { label: "Se connecter", href: "/connexion" },
  { label: "Créer un compte", href: "/inscription" },
];

/**
 * Session courante, pour l'en-tête seulement.
 *
 * Sans elle, un artisan connecté voit « Se connecter » et n'a aucun chemin
 * vers son atelier  l'espace existe, mais rien n'y mène. La requête est
 * tolérante : un en-tête ne doit pas casser parce que l'API tarde.
 */
function useSession() {
  const [user, setUser] = useState<{ role: string; firstName: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void apiFetchOrNull<{ role: string; firstName: string }>("/auth/me").then((me) => {
      if (!cancelled) setUser(me);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return user;
}

function BurgerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M4 7h16M4 12h16M4 17h10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* Chevron tracé en ligne plutôt que l'export Figma en <img> : il hérite ainsi
   de `currentColor` et passe à l'orange sur la ligne active. */
function ChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M6 3.5L10.5 8L6 12.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Header() {
  const pathname = usePathname();
  const { itemCount, ready } = useCart();
  const user = useSession();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const isActive = (href: string) =>
    href !== "/" && pathname.startsWith(href);

  /* Le panneau se referme à chaque navigation : sans cela, cliquer un lien
     laisse l'ombrage en place par-dessus la page d'arrivée. */
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  /* Panneau ouvert : on gèle le défilement de la page, on écoute Échap et on
     porte le focus sur le bouton de fermeture. À la fermeture, le focus
     revient au bouton qui a ouvert  sinon il repart en tête de document. */
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        burgerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  /* Le filet de séparation ne se justifie qu'une fois la page défilée ;
     en haut, la barre se fond dans le hero. */
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const cartBadge =
    ready && itemCount > 0 ? (
      <span className={styles.count}>{itemCount}</span>
    ) : null;

  return (
    <>
      <header className={styles.root} data-scrolled={scrolled || undefined}>
        <div className={styles.container}>
          <Link href="/" className={styles.logo} aria-label="Ojà, accueil">
            <img
              src="/images/logo-oja-dark.svg"
              alt=""
              className={styles.logoImage}
            />
          </Link>

          <nav className={styles.nav} aria-label="Navigation principale">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className={`${styles.navLink} ${
                  isActive(link.href) ? styles.navLinkActive : ""
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Barre d'actions desktop : libellés visibles.
              Pas d'icône de recherche ici : elle vit désormais sur la page
              Marketplace elle-même, pas derrière un clic supplémentaire. */}
          <div className={styles.actions}>
            {user ? <NotificationsBell /> : null}
            <Link
              href={user ? homeForRole(user.role) : "/connexion"}
              className={styles.action}
            >
              <img
                src="/images/icon-account.svg"
                alt=""
                className={styles.actionIcon}
              />
              <span>{user ? (SPACE_LABEL[user.role] ?? "Mon compte") : "Se connecter"}</span>
            </Link>

            {/* Ajout hors maquette : accès au panier, indispensable au parcours.
                Icône noire, comme « Mon compte » : la version blanche est celle
                du bouton orange des cartes produits, invisible sur ce fond. */}
            <Link href="/panier" className={styles.action}>
              <img
                src="/images/icon-basket-dark.svg"
                alt=""
                className={styles.actionIcon}
              />
              <span>Panier</span>
              {cartBadge}
            </Link>
          </div>

          {/* Barre d'actions mobile : deux cibles tactiles carrées + menu.
              Les libellés partent dans le panneau plutôt que d'être tronqués. */}
          <div className={styles.mobileActions}>
            <Link
              href="/panier"
              className={styles.iconButton}
              aria-label={
                ready && itemCount > 0
                  ? `Panier, ${itemCount} article${itemCount > 1 ? "s" : ""}`
                  : "Panier"
              }
            >
              <img src="/images/icon-basket-dark.svg" alt="" />
              {cartBadge}
            </Link>

            <button
              ref={burgerRef}
              type="button"
              className={styles.iconButton}
              aria-label="Ouvrir le menu"
              aria-expanded={open}
              aria-controls="menu-mobile"
              onClick={() => setOpen(true)}
            >
              <BurgerIcon />
            </button>
          </div>
        </div>
      </header>

      {/* Le panneau vit hors du <header> : `backdrop-filter` sur celui-ci crée
          un bloc conteneur, un enfant `position: fixed` s'y trouverait ancré
          au lieu de couvrir la fenêtre. */}
      <div className={styles.drawerRoot} data-open={open || undefined}>
        <button
          type="button"
          className={styles.scrim}
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => setOpen(false)}
        />

        <div
          id="menu-mobile"
          className={styles.drawer}
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
        >
          <div className={styles.drawerHead}>
            <span className={styles.drawerTitle}>Menu</span>
            <button
              ref={closeRef}
              type="button"
              className={styles.iconButton}
              aria-label="Fermer le menu"
              onClick={() => {
                setOpen(false);
                burgerRef.current?.focus();
              }}
            >
              <CloseIcon />
            </button>
          </div>

          <nav className={styles.drawerNav} aria-label="Navigation">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className={`${styles.drawerLink} ${
                  isActive(link.href) ? styles.drawerLinkActive : ""
                }`}
              >
                <span>{link.label}</span>
                <span className={styles.drawerChevron}>
                  <ChevronIcon />
                </span>
              </Link>
            ))}
          </nav>

          <div className={styles.drawerDivider} />

          <div className={styles.drawerAccount}>
            <p className={styles.drawerLabel}>Compte</p>
            {(user
              ? [
                  {
                    label: SPACE_LABEL[user.role] ?? "Mon compte",
                    href: homeForRole(user.role),
                  },
                  ...(user.role === "CUSTOMER"
                    ? []
                    : [{ label: "Mon compte", href: "/compte" }]),
                ]
              : DRAWER_ANONYMOUS
            ).map((link) => (
              <Link key={link.label} href={link.href} className={styles.drawerSmall}>
                {link.label}
              </Link>
            ))}
          </div>

          {/* L'appel à ouvrir une boutique ne s'adresse pas à qui en a déjà une. */}
          {user?.role === "MAKER" ? null : (
            <Link href="/inscription" className={styles.drawerCta}>
              Ouvrir ma boutique d’artisan
            </Link>
          )}
        </div>
      </div>
    </>
  );
}
