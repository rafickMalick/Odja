import Link from "next/link";

import { ButtonLink } from "@/components/Button";
import { ForVisitors } from "@/components/ForVisitors";
import { CatalogCard } from "@/components/CatalogCard";
import { fetchProducts } from "@/lib/catalog";

import styles from "./page.module.css";

/* Bandeau de réassurance, juste sous le hero. Les deux premières icônes sont
   déjà à la couleur de marque dans l'export Figma, les deux autres sont des
   tracés noirs : toutes sont posées sur une pastille Primary/Light. */
const ASSURANCES = [
  {
    icon: "/images/icon-secure-payment.svg",
    title: "Paiement sécurisé",
    text: "Mobile Money ou carte. Le montant est conservé par Ojà jusqu’à la livraison.",
  },
  {
    icon: "/images/icon-delivery.svg",
    title: "Livraison suivie",
    text: "Des livreurs partenaires dans les grandes villes de la zone UEMOA.",
  },
  {
    icon: "/images/icon-package.svg",
    title: "Ateliers vérifiés",
    text: "Chaque créateur est identifié et validé avant sa première mise en vente.",
  },
  {
    icon: "/images/icon-return.svg",
    title: "Validation à la réception",
    text: "Vous inspectez la pièce devant le livreur. Rien n’est versé à l’atelier avant votre accord.",
  },
];

/* Ces trois chiffres sont des faits vérifiables, pas des projections : le
   taux de commission, la zone couverte, et le délai de versement. Les
   « 120+ ateliers » qui figuraient ici étaient une valeur d'exemple  mieux
   vaut ne rien annoncer que d'annoncer faux. */
const STATS = [
  { value: "5 %", label: "de commission, affichée au client" },
  { value: "8", label: "pays de la zone UEMOA préparés" },
  { value: "24 h", label: "pour verser à l’atelier après votre validation" },
];

const CATEGORY_TILES = [
  {
    name: "Mobilier",
    text: "Fauteuils, tabourets, buffets",
    image: "/images/bundle-1.png",
  },
  {
    name: "Luminaires",
    text: "Lampes, suspensions, appliques",
    image: "/images/bundle-3.png",
  },
  {
    name: "Textile",
    text: "Nappes, coussins, tentures",
    image: "/images/order-item-2.png",
  },
  {
    name: "Décoration",
    text: "Tapis, vannerie, céramique",
    image: "/images/order-item-3.png",
  },
];

const STEPS = [
  {
    title: "Vous choisissez la pièce",
    text: "Le catalogue affiche l’atelier qui fabrique, la matière employée et le délai réel de façonnage.",
  },
  {
    title: "Vous payez en Mobile Money",
    text: "Mobile Money ou carte bancaire. Ojà conserve le montant : l’atelier n’est payé qu’une fois la pièce entre vos mains.",
  },
  {
    title: "L’atelier fabrique",
    text: "Le créateur reçoit la commande, confirme son délai et prépare la pièce dans son atelier.",
  },
  {
    title: "Vous validez à la réception",
    text: "Un livreur partenaire vous remet la pièce. Vous l’inspectez, puis vous validez : l’atelier est payé 24 h plus tard.",
  },
];

/* Les trois profils ouverts à l'inscription. Le quatrième  l'administrateur
   Ojà  n'est pas un compte que l'on crée soi-même : il est mentionné en note
   sous les cartes plutôt qu'affiché comme une offre. */
const ROLES = [
  {
    icon: "/images/icon-account.svg",
    eyebrow: "Compte client",
    title: "Acheter en confiance",
    text: "Une pièce unique, un atelier identifié, un paiement protégé jusqu’à la livraison.",
    points: [
      "Suivi de commande de l’atelier à votre porte",
      "Paiement Mobile Money en quelques secondes",
      "Support Ojà en cas de litige",
    ],
    cta: "Créer un compte client",
    href: "/inscription",
  },
  {
    icon: "/images/icon-package.svg",
    eyebrow: "Compte créateur",
    title: "Vendre son savoir-faire",
    text: "Votre atelier expose ses pièces à l’échelle du pays, sans boutique à louer ni site à construire.",
    points: [
      "Vitrine gratuite, vous fixez vos prix et les touchez en entier",
      "Versement Mobile Money 24 h après validation du client",
      "Tableau de bord des commandes et des stocks",
    ],
    cta: "Ouvrir ma boutique",
    href: "/inscription?profil=createur",
  },
  {
    icon: "/images/icon-vehicle.svg",
    eyebrow: "Compte livreur",
    title: "Livrer près de chez soi",
    text: "Des courses régulières entre les ateliers partenaires et les clients de votre ville.",
    points: [
      "Missions proposées selon votre zone",
      "Course payée à la preuve de livraison",
      "Preuve de remise directement depuis le téléphone",
    ],
    cta: "Devenir livreur",
    href: "/inscription?profil=livreur",
  },
];

export default async function HomePage() {
  /* Les pièces mises en avant viennent du catalogue réel : ce sont celles que
     des ateliers ont publiées et que l'administration a validées. */
  const featured = await fetchProducts({ limit: 4 });

  return (
    <main className={styles.page}>
      {/* ── Hero (Figma 84:2317) ── */}
      <section className={styles.hero}>
        <h1 className={styles.wordmark}>Ojà</h1>

        <div className={styles.stage}>
          <img
            src="/images/home-hero-fabric.png"
            alt="Tissu à motifs tissé à la main dans un atelier d’Afrique de l’Ouest"
            className={styles.stageImage}
          />
          <div className={styles.stageOverlay} aria-hidden="true" />

          <div className={styles.copy}>
            <div className={styles.copyText}>
              <p className={styles.copyTitle}>FAIT MAIN, ICI</p>
              <p className={styles.copySubtitle}>
                Mobilier, luminaires et décoration façonnés dans les ateliers
                d’Afrique de l’Ouest. Chaque pièce porte le nom de celui qui
                l’a faite.
              </p>
            </div>
            <ButtonLink href="/catalogue">Découvrir le catalogue</ButtonLink>
          </div>

          <div className={styles.ribbon} aria-hidden="true">
            <span className={styles.ribbonInner}>Ojà · pièce de l’année</span>
          </div>

          <div className={styles.thumbs}>
            <img src="/images/home-thumb-1.png" alt="" className={styles.thumb} />
            <img src="/images/home-thumb-2.png" alt="" className={styles.thumb} />
          </div>
        </div>
      </section>

      {/* ── Réassurance ── */}
      <section className={styles.assurance} aria-label="Nos engagements">
        <div className={styles.assuranceRow}>
          {ASSURANCES.map((item) => (
            <div key={item.title} className={styles.assuranceItem}>
              <span className={styles.assuranceIcon}>
                <img src={item.icon} alt="" />
              </span>
              <div>
                <p className={styles.assuranceTitle}>{item.title}</p>
                <p className={styles.assuranceText}>{item.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Manifeste + chiffres ── */}
      <section className={styles.manifesto}>
        <div className={styles.manifestoInner}>
          <div className={styles.manifestoCopy}>
            <p className={styles.eyebrow}>Notre raison d’être</p>
            <h2 className={styles.sectionTitle}>
              Le travail des artisans d’ici mérite mieux qu’un bord de route.
            </h2>
            <p className={styles.lead}>
              Menuisiers, tisserands, potiers, ferronniers : le savoir-faire ne
              manque nulle part, la vitrine si. Ojà réunit ces ateliers sur une
              même place de marché. Ils gardent leur nom sur chaque pièce et
              fixent leurs prix ; nous prenons en charge la vitrine, le
              paiement, la logistique et le service client.
            </p>
          </div>

          <dl className={styles.stats}>
            {STATS.map((stat) => (
              <div key={stat.label} className={styles.stat}>
                <dt className={styles.statValue}>{stat.value}</dt>
                <dd className={styles.statLabel}>{stat.label}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ── Catégories ── */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <p className={styles.eyebrow}>Explorer</p>
            <h2 className={styles.sectionTitle}>Par catégorie</h2>
          </div>
          <ButtonLink href="/catalogue" variant="outline">
            Tout le catalogue
          </ButtonLink>
        </div>

        <div className={styles.categoryGrid}>
          {CATEGORY_TILES.map((tile) => (
            <Link
              key={tile.name}
              href="/catalogue"
              className={styles.categoryTile}
            >
              <img src={tile.image} alt="" className={styles.categoryImage} />
              <span className={styles.categoryBody}>
                <span className={styles.categoryName}>{tile.name}</span>
                <span className={styles.categoryText}>{tile.text}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Sélection ── */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <p className={styles.eyebrow}>Sélection</p>
            <h2 className={styles.sectionTitle}>Les pièces du moment</h2>
          </div>
          <ButtonLink href="/catalogue" variant="outline">
            Voir tout le catalogue
          </ButtonLink>
        </div>

        {featured.items.length > 0 ? (
          <div className={styles.productGrid}>
            {featured.items.map((product) => (
              <CatalogCard key={product.id} product={product} />
            ))}
          </div>
        ) : (
          /* Au lancement, le catalogue est vide. Mieux vaut le dire et inviter
             les artisans que d'afficher une grille fantôme. */
          <p className={styles.lead}>
            Les premiers ateliers rejoignent Ojà en ce moment.
            <ForVisitors>
              {" "}Vous fabriquez ?
              <ButtonLink href="/inscription?profil=createur" variant="secondary">
                Ouvrir votre boutique
              </ButtonLink>
            </ForVisitors>
          </p>
        )}
      </section>

      {/* ── Atelier à l'honneur ── */}
      <section className={styles.spotlight}>
        <div className={styles.spotlightInner}>
          <img
            src="/images/home-thumb-2.png"
            alt="Tisserand au métier à tisser dans son atelier"
            className={styles.spotlightImage}
          />

          <div className={styles.spotlightCopy}>
            <p className={styles.eyebrow}>Atelier à l’honneur</p>
            <h2 className={styles.sectionTitle}>
              Coopérative Fanti, Korhogo
            </h2>
            <p className={styles.lead}>
              Douze tisserandes, un métier à tisser transmis depuis trois
              générations et des motifs qu’on ne trouve nulle part ailleurs.
              Depuis leur arrivée sur Ojà, la coopérative vend dans quatre pays
              sans avoir quitté son atelier.
            </p>
            <blockquote className={styles.quote}>
              <p className={styles.quoteText}>
                « Avant, on vendait au marché le samedi. Aujourd’hui les
                commandes arrivent sur le téléphone, et le paiement aussi. »
              </p>
              <footer className={styles.quoteAuthor}>
                <img
                  src="/images/avatar-review.png"
                  alt=""
                  className={styles.quoteAvatar}
                />
                <span>
                  <span className={styles.quoteName}>Awa K.</span>
                  <span className={styles.quoteRole}>
                    responsable de la coopérative
                  </span>
                </span>
              </footer>
            </blockquote>
          </div>
        </div>
      </section>

      {/* ── Comment ça marche ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeadCentered}>
          <p className={styles.eyebrow}>Comment ça marche</p>
          <h2 className={styles.sectionTitle}>
            De l’atelier à votre salon, en quatre temps
          </h2>
        </div>

        <ol className={styles.steps}>
          {STEPS.map((step, index) => (
            <li key={step.title} className={styles.step}>
              <span className={styles.stepNumber}>{index + 1}</span>
              <p className={styles.stepTitle}>{step.title}</p>
              <p className={styles.stepText}>{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Les trois profils ── appel à s'inscrire, réservé aux visiteurs */}
      <ForVisitors>
      <section className={styles.roles}>
        <div className={styles.rolesInner}>
          <div className={styles.sectionHeadCentered}>
            <p className={styles.eyebrow}>Rejoindre Ojà</p>
            <h2 className={styles.sectionTitle}>
              Trois façons d’entrer dans la place de marché
            </h2>
            <p className={styles.lead}>
              Un seul compte, un rôle à choisir à l’inscription. Rien n’empêche
              un artisan d’acheter chez un confrère.
            </p>
          </div>

          <div className={styles.roleGrid}>
            {ROLES.map((role) => (
              <article key={role.eyebrow} className={styles.roleCard}>
                <span className={styles.roleIcon}>
                  <img src={role.icon} alt="" />
                </span>
                <p className={styles.roleEyebrow}>{role.eyebrow}</p>
                <h3 className={styles.roleTitle}>{role.title}</h3>
                <p className={styles.roleText}>{role.text}</p>

                <ul className={styles.roleList}>
                  {role.points.map((point) => (
                    <li key={point} className={styles.rolePoint}>
                      <img
                        src="/images/icon-check-small.svg"
                        alt=""
                        className={styles.roleCheck}
                      />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>

                <div className={styles.roleCta}>
                  <ButtonLink href={role.href} variant="secondary" fullWidth>
                    {role.cta}
                  </ButtonLink>
                </div>
              </article>
            ))}
          </div>

          <p className={styles.rolesNote}>
            Un quatrième profil veille sur la place de marché : l’administrateur
            Ojà vérifie les ateliers, arbitre les litiges et déclenche les
            versements. Il ne s’ouvre pas à l’inscription.
          </p>
        </div>
      </section>
      </ForVisitors>

      {/* ── Appel final ── */}
      <section className={styles.finalCta}>
        <div className={styles.finalCtaInner}>
          <h2 className={styles.finalCtaTitle}>
            Votre intérieur peut faire vivre un atelier.
          </h2>
          <p className={styles.finalCtaText}>
            <ForVisitors fallback="Parcourez le catalogue des ateliers partenaires.">
              Parcourez le catalogue, ou ouvrez votre boutique si vous fabriquez.
            </ForVisitors>
          </p>
          <div className={styles.finalCtaActions}>
            <ButtonLink href="/catalogue">Découvrir le catalogue</ButtonLink>
            <ForVisitors>
              <ButtonLink href="/inscription?profil=createur" variant="secondary">
                Vendre sur Ojà
              </ButtonLink>
            </ForVisitors>
          </div>
        </div>
      </section>
    </main>
  );
}
