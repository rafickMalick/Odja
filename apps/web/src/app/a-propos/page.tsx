import Link from "next/link";

import { ButtonLink } from "@/components/Button";

import styles from "./page.module.css";

/* Trois chiffres vérifiables, pas des projections — les mêmes que ceux
   affichés à l'accueil : le taux de commission, la zone couverte, le délai
   de versement. */
const STATS = [
  { value: "5 %", label: "de commission, affichée au client" },
  { value: "8", label: "pays de la zone UEMOA préparés" },
  { value: "24 h", label: "pour verser au fabricant après votre validation" },
];

const STEPS = [
  {
    title: "Un catalogue de pièces uniques",
    text: "Chaque fiche indique l’atelier qui fabrique, la matière employée et le délai réel de façonnage — jamais un stock anonyme.",
  },
  {
    title: "Un paiement protégé",
    text: "Mobile Money ou carte. Ojà conserve le montant : le fabricant n’est réglé qu’une fois la pièce entre vos mains.",
  },
  {
    title: "Une livraison suivie",
    text: "Un livreur partenaire enlève la pièce à l’atelier et vous la remet, avec un code de réception à votre nom.",
  },
  {
    title: "Une validation qui compte",
    text: "Vous inspectez la pièce à la remise. C’est votre validation qui déclenche le versement au fabricant, 24 h plus tard.",
  },
];

const VALUES = [
  {
    icon: "/images/icon-package.svg",
    title: "Des ateliers vérifiés",
    text: "Chaque fabricant dépose un dossier — identité, savoir-faire, adresse d’atelier — vérifié avant sa première mise en vente.",
  },
  {
    icon: "/images/icon-secure-payment.svg",
    title: "L’argent ne circule qu’au bon moment",
    text: "Le client paie à la commande, le fabricant est payé à la validation. Ojà ne prend jamais de commission sur ce qui n’a pas été livré.",
  },
  {
    icon: "/images/icon-delivery.svg",
    title: "Une seule intermédiation",
    text: "Le téléphone du client et celui du fabricant ne se croisent jamais. Toute question passe par le Support Ojà.",
  },
];

export default function AboutPage() {
  return (
    <main className={styles.page}>
      <div className={styles.hero}>
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>À propos</p>
          <h1 className={styles.title}>
            Donner aux artisans locaux l’accès qu’ils méritent
          </h1>
          <p className={styles.lead}>
            Ojà est une place de marché pour le mobilier, la décoration et
            l’artisanat fabriqués localement. Nous existons pour une raison
            simple : un savoir-faire réel a souvent moins de visibilité qu’il
            ne le mérite, et un acheteur qui cherche une pièce authentique n’a
            pas toujours de moyen simple de la trouver, ni de garantie sur ce
            qu’il paie.
          </p>
        </div>
      </div>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Ce que nous faisons</h2>
        <p className={styles.paragraph}>
          Ojà met en relation des ateliers identifiés et des acheteurs, et
          reste l’intermédiaire du début à la fin : le paiement, la livraison,
          et le service après-vente passent par la plateforme. Le fabricant
          touche le prix qu’il a fixé, en entier — la commission d’Ojà
          s’ajoute au prix affiché, elle ne le rogne jamais.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Comment ça marche</h2>
        <div className={styles.steps}>
          {STEPS.map((step, index) => (
            <div key={step.title} className={styles.step}>
              <span className={styles.stepNumber}>{index + 1}</span>
              <div>
                <p className={styles.stepTitle}>{step.title}</p>
                <p className={styles.stepText}>{step.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.statsSection}>
        <div className={styles.statsInner}>
          {STATS.map((stat) => (
            <div key={stat.label} className={styles.stat}>
              <p className={styles.statValue}>{stat.value}</p>
              <p className={styles.statLabel}>{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Ce à quoi nous tenons</h2>
        <div className={styles.values}>
          {VALUES.map((value) => (
            <div key={value.title} className={styles.valueCard}>
              <span className={styles.valueIcon}>
                <img src={value.icon} alt="" />
              </span>
              <p className={styles.valueTitle}>{value.title}</p>
              <p className={styles.valueText}>{value.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.cta}>
        <div className={styles.ctaInner}>
          <div>
            <p className={styles.ctaTitle}>Vous cherchez une pièce ?</p>
            <p className={styles.ctaText}>
              Parcourez le catalogue, filtré par atelier, ville ou matière.
            </p>
          </div>
          <ButtonLink href="/catalogue">Découvrir le catalogue</ButtonLink>
        </div>
        <div className={styles.ctaInner}>
          <div>
            <p className={styles.ctaTitle}>Vous êtes un fabricant ?</p>
            <p className={styles.ctaText}>
              Ouvrez votre boutique et mettez vos pièces en vente.
            </p>
          </div>
          <ButtonLink href="/inscription" variant="outline">
            Devenir fabricant
          </ButtonLink>
        </div>
      </section>

      <p className={styles.footNote}>
        Une question avant de vous lancer ?{" "}
        <Link href="/contact">Écrivez au Support Ojà</Link>.
      </p>
    </main>
  );
}
