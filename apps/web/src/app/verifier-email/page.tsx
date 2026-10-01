import Link from "next/link";

import { ButtonLink } from "@/components/Button";
import { apiFetch } from "@/lib/api";

import styles from "./page.module.css";

/**
 * Confirmation d'adresse e-mail.
 *
 * La page consomme le jeton du lien côté serveur : le visiteur clique et voit
 * le résultat, sans étape intermédiaire. Un lien déjà utilisé ou expiré donne
 * le même message  la distinction n'aiderait que quelqu'un qui essaie des
 * jetons au hasard.
 */
export default async function VerifierEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ jeton?: string }>;
}) {
  const { jeton } = await searchParams;

  let verified = false;
  if (jeton) {
    try {
      await apiFetch("/auth/verify-email", { method: "POST", body: { token: jeton } });
      verified = true;
    } catch {
      verified = false;
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        {verified ? (
          <>
            <h1 className={styles.title}>Adresse confirmée</h1>
            <p className={styles.text}>
              Merci. Votre adresse e-mail est vérifiée  vous recevrez les
              confirmations de commande et le suivi de vos livraisons.
            </p>
            <ButtonLink href="/catalogue">Découvrir le catalogue</ButtonLink>
          </>
        ) : (
          <>
            <h1 className={styles.title}>Ce lien n&apos;est plus valable</h1>
            <p className={styles.text}>
              Il a peut-être déjà servi, ou dépassé ses 24 heures. Vous pouvez
              en demander un nouveau depuis votre compte.
            </p>
            <ButtonLink href="/connexion">Se connecter</ButtonLink>
            <Link href="/" className={styles.link}>
              Retour à l&apos;accueil
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
