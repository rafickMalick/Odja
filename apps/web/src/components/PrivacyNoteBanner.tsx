import styles from "./PrivacyNoteBanner.module.css";

/* Texte imposé par les notes d'implémentation e-commerce du dev handoff. */
export function PrivacyNoteBanner() {
  return (
    <aside className={styles.root}>
      <img src="/images/icon-info.svg" alt="" className={styles.icon} />
      <p className={styles.text}>
        Ojà gère l&apos;ensemble des paiements et la coordination. Les
        coordonnées des créateurs et des clients restent strictement masquées.
        Toute demande passe par le Support.
      </p>
    </aside>
  );
}
