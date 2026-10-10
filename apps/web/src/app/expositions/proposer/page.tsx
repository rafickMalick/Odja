import type { Metadata } from "next";
import Link from "next/link";

import { fetchExhibitionPlans } from "@/lib/exhibitions";
import { formatFcfa } from "@/lib/format";

import styles from "../expositions.module.css";

export const metadata: Metadata = {
  title: "Proposer une exposition · Ojà",
  description:
    "Artistes, créateurs, galeries et organisateurs : présentez votre exposition sur Ojà, sur place, en ligne ou les deux.",
};

/**
 * Présentation du service d'exposition (§ 6.2, parcours B).
 *
 * Un organisateur qui ne connaît pas Ojà doit comprendre en une page ce qu'il
 * obtient, ce que coûtent les formules, et par quelles étapes passe sa
 * demande — avant de créer le moindre compte.
 */
export default async function ProposePage() {
  const plans = await fetchExhibitionPlans();

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>Exposer sur Ojà</p>
          <h1 className={styles.title}>Votre exposition, visible d’ici et d’ailleurs</h1>
          <p className={styles.lead}>
            Sur place, en ligne ou les deux : Ojà publie votre exposition, gère l’accès des visiteurs et
            permet d’acheter les œuvres à distance. Pas besoin d’être déjà vendeur sur Ojà pour déposer
            une demande.
          </p>
          <Link href="/expositions/mes-expositions" className={styles.heroLink}>
            Déposer une demande
          </Link>
        </div>
      </header>

      <section className={styles.section}>
        <h2 className={styles.heading}>Comment ça se passe</h2>
        <ol className={styles.steps}>
          <li>
            <strong>1. Vous déposez votre projet</strong>
            Présentation, dates, lieu, œuvres et photos, formule choisie. Un compte Ojà suffit.
          </li>
          <li>
            <strong>2. L’équipe Ojà l’examine</strong>
            Elle vérifie les œuvres et leur existence, peut demander des précisions, puis accepte ou
            refuse.
          </li>
          <li>
            <strong>3. Contrat et mise en ligne</strong>
            Une fois le contrat signé et la formule réglée, l’exposition est programmée et publiée à
            la date convenue.
          </li>
        </ol>

        <h2 className={styles.heading}>Les formules</h2>
        <div className={styles.plans}>
          {plans.map((plan) => (
            <article key={plan.id} className={styles.plan}>
              <h3 className={styles.planName}>{plan.name}</h3>
              <p className={styles.planPrice}>
                {plan.priceXof > 0 ? formatFcfa(plan.priceXof) : "Tarif communiqué sur demande"}
              </p>
              {plan.description ? <p className={styles.body}>{plan.description}</p> : null}
              <ul className={styles.perks}>
                {plan.perks.map((perk) => (
                  <li key={perk}>{perk}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>

        <p className={styles.notice}>
          Seuls les créateurs dont la boutique est validée sur Ojà peuvent vendre les œuvres
          exposées : le paiement, la livraison et le versement passent par leur boutique. Un
          organisateur externe expose ; pour vendre, il ouvre une boutique créateur.
        </p>
      </section>
    </main>
  );
}
