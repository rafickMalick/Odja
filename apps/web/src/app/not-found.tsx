import { ButtonLink } from "@/components/Button";

import styles from "./not-found.module.css";

/**
 * 404 générale du site.
 *
 * Sans elle, Next affiche sa page par défaut  fond noir, texte en anglais,
 * hors charte. Celle-ci reprend le même gabarit que la confirmation
 * d'e-mail : une carte centrée, sur fond de page normal.
 */
export default function NotFound() {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>404</p>
        <h1 className={styles.title}>Cette page n&apos;existe pas</h1>
        <p className={styles.text}>
          Le lien est peut-être ancien, ou l&apos;adresse mal orthographiée.
          Le catalogue et l&apos;accueil, eux, sont toujours à leur place.
        </p>
        <div className={styles.actions}>
          <ButtonLink href="/">Retour à l&apos;accueil</ButtonLink>
          <ButtonLink href="/catalogue" variant="outline">
            Découvrir le catalogue
          </ButtonLink>
        </div>
      </div>
    </main>
  );
}
