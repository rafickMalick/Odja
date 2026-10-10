"use client";

import type { PublicProduct } from "@oja/contracts";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { Button, ButtonLink } from "@/components/Button";
import { StepperQuantity } from "@/components/StepperQuantity";
import { useCart } from "@/lib/cart";
import { formatFcfa, formatNumber } from "@/lib/format";

import styles from "./page.module.css";

/* Le trait actif sous chaque titre a une largeur figée dans la maquette. */
const PANELS = [
  { id: "description", title: "Description", ruleWidth: 163 },
  { id: "specs", title: "Fiche technique", ruleWidth: 300 },
  { id: "reviews", title: "Avis", ruleWidth: 106 },
] as const;

export function ProductDetail({
  product,
  children,
}: {
  product: PublicProduct;
  /** Sections rendues côté serveur sous la fiche (les avis). */
  children?: ReactNode;
}) {
  const { add } = useCart();
  const [quantity, setQuantity] = useState(1);
  const [activeImage, setActiveImage] = useState(0);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({
    description: true,
    specs: true,
    reviews: true,
  });

  const toggle = (id: string) =>
    setOpen((current) => ({ ...current, [id]: !current[id] }));

  const handleAdd = async () => {
    setAdding(true);
    try {
      await add(product.id, quantity);
    } finally {
      setAdding(false);
    }
  };

  const images = product.images.length > 0 ? product.images : [{ url: "", alt: null }];
  const main = images[Math.min(activeImage, images.length - 1)];

  /* La fiche technique se compose des données réelles du produit. Elle ne
     montre que ce qui est renseigné : une ligne vide vaut moins que pas de
     ligne du tout. */
  /* Une réalisation de portfolio n'a ni colis ni prix : ses dimensions
     valent 0 en base, et une ligne « 0 cm » ne dit rien d'utile. */
  const hasParcel = product.dimensions.lengthMm > 0 && product.dimensions.weightGrams > 0;

  const specs: [string, string][] = [
    ["Atelier", `${product.maker.shopName} · ${product.maker.city}`],
    ...(product.material ? ([["Matière", product.material]] as [string, string][]) : []),
    ...(hasParcel
      ? ([
          [
            "Dimensions",
            `L ${cm(product.dimensions.lengthMm)} × l ${cm(product.dimensions.widthMm)} × H ${cm(
              product.dimensions.heightMm,
            )} cm`,
          ],
          ["Poids", `${formatNumber(product.dimensions.weightGrams / 1000, 1)} kg`],
        ] as [string, string][])
      : []),
    ["Catégorie", product.category.name],
    ["Disponibilité", availabilityText(product)],
  ];

  return (
    <main className={styles.page}>
      <div className={styles.section}>
        <div className={styles.container}>
          <nav className={styles.breadcrumbs} aria-label="Fil d'Ariane">
            <Link href="/">Accueil</Link>
            <img src="/images/icon-chevron-right.svg" alt="" className={styles.chevron} />
            <Link href={`/catalogue?categorie=${product.category.slug}`}>
              {product.category.name}
            </Link>
            <img src="/images/icon-chevron-right.svg" alt="" className={styles.chevron} />
            <span className={styles.breadcrumbCurrent}>{product.name}</span>
          </nav>

          <div className={styles.columns}>
            <div className={styles.pictures}>
              {images.length > 1 ? (
                <div className={styles.thumbs}>
                  {images.map((image, index) => (
                    <button
                      key={image.url}
                      type="button"
                      onClick={() => setActiveImage(index)}
                      aria-label={`Voir la photo ${index + 1}`}
                      aria-pressed={activeImage === index}
                    >
                      <img
                        src={image.url}
                        alt=""
                        className={`${styles.thumb} ${
                          activeImage === index ? styles.thumbActive : ""
                        }`}
                      />
                    </button>
                  ))}
                </div>
              ) : null}

              <div className={styles.mainImageWrap}>
                <img
                  src={main?.url ?? ""}
                  alt={main?.alt ?? product.name}
                  className={styles.mainImage}
                />
              </div>
            </div>

            <div className={styles.buy}>
              <div className={styles.identity}>
                <Link href={`/atelier/${product.maker.slug}`} className={styles.atelier}>
                  {product.maker.shopName} · {product.maker.city}
                </Link>

                <h1 className={styles.title}>{product.name}</h1>

                {product.ratingCount > 0 ? (
                  <p className={styles.rating}>
                    <span className={styles.stars}>★★★★★</span>{" "}
                    {formatNumber(product.ratingAvg, 1)} / 5 · {product.ratingCount} avis
                  </p>
                ) : null}

                {/* Un seul prix : celui que le client paie. Le détail part
                    créateur / commission Ojà ne lui est pas montré. */}
                {product.isForSale ? (
                  <div className={styles.priceBlock}>
                    <p className={styles.price}>{formatFcfa(product.finalPriceXof)}</p>
                  </div>
                ) : null}
              </div>

              {product.purchasable ? (
              <div className={styles.actions}>
                <div className={styles.actionRow}>
                  <StepperQuantity
                    value={quantity}
                    onChange={setQuantity}
                    label={product.name}
                  />
                  <Button variant="outline" onClick={handleAdd} disabled={adding}>
                    Ajouter au panier
                  </Button>
                  <button type="button" aria-label="Ajouter aux favoris">
                    <img
                      src="/images/btn-favorite.svg"
                      alt=""
                      className={styles.favorite}
                    />
                  </button>
                </div>

                <ButtonLink href="/panier" fullWidth onClick={handleAdd}>
                  Commander
                </ButtonLink>

                <div className={styles.reassurance}>
                  <p className={styles.reassuranceItem}>
                    <img
                      src="/images/icon-delivery.svg"
                      alt=""
                      className={styles.reassuranceIcon}
                    />
                    Livraison depuis {product.maker.city}, frais calculés à
                    l&apos;adresse au moment de commander.
                  </p>
                  <p className={styles.reassuranceItem}>
                    <img
                      src="/images/icon-secure-payment.svg"
                      alt=""
                      className={styles.reassuranceIcon}
                    />
                    Ojà conserve le montant : l&apos;atelier n&apos;est payé
                    qu&apos;une fois la pièce entre vos mains.
                  </p>
                </div>
              </div>
              ) : (
                /* Pièce vendue, indisponible ou présentée en portfolio : on le
                   dit, et on renvoie vers l'atelier plutôt que vers un bouton
                   grisé qui ne mène nulle part. */
                <div className={styles.actions}>
                  <p className={styles.unavailable}>{unavailableText(product)}</p>
                  <ButtonLink href={`/atelier/${product.maker.slug}`} variant="outline" fullWidth>
                    Voir l&apos;atelier {product.maker.shopName}
                  </ButtonLink>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.panels}>
          {PANELS.map((panel) => (
            <section key={panel.id} className={styles.panel}>
              <div className={styles.panelHeader}>
                <button
                  type="button"
                  className={styles.panelToggle}
                  onClick={() => toggle(panel.id)}
                  aria-expanded={open[panel.id]}
                >
                  <span className={styles.panelTitle}>{panel.title}</span>
                  <img
                    src="/images/icon-chevron-down.svg"
                    alt=""
                    className={`${styles.panelChevron} ${
                      open[panel.id] ? styles.panelChevronOpen : ""
                    }`}
                  />
                </button>
                <div className={styles.panelRule}>
                  <span className={styles.panelRuleTrack} />
                  <span
                    className={styles.panelRuleActive}
                    style={{ width: panel.ruleWidth }}
                  />
                </div>
              </div>

              {open[panel.id] ? (
                <div className={styles.panelBody}>
                  {panel.id === "description" ? <p>{product.description}</p> : null}

                  {panel.id === "specs" ? (
                    <dl className={styles.specs}>
                      {specs.map(([key, value]) => (
                        <div key={key} className={styles.specRow}>
                          <dt className={styles.specKey}>{key}</dt>
                          <dd className={styles.specValue}>{value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}

                  {panel.id === "reviews" ? (
                    product.ratingCount > 0 ? (
                      <p>
                        {product.ratingCount} avis, note moyenne{" "}
                        {formatNumber(product.ratingAvg, 1)} sur 5.
                      </p>
                    ) : (
                      /* Un avis exige un achat réellement livré et validé :
                         c'est ce qui les rend crédibles, et ce qui explique
                         qu'il n'y en ait aucun au lancement. */
                      <p className={styles.emptyReviews}>
                        Aucun avis pour l&apos;instant. Seuls les clients ayant
                        reçu cette pièce peuvent en laisser un.
                      </p>
                    )
                  ) : null}
                </div>
              ) : null}
            </section>
          ))}
        </div>
      </div>
      {children}
    </main>
  );
}

function cm(millimetres: number): number {
  return Math.round(millimetres / 10);
}

function availabilityText(product: PublicProduct): string {
  switch (product.availability) {
    case "PORTFOLIO":
      return "Réalisation présentée, non proposée à la vente";
    case "SOLD":
      return "Vendue";
    case "RESERVED":
      return "Réservée par une commande en cours";
    case "UNAVAILABLE":
      return "Momentanément indisponible";
    case "MADE_TO_ORDER":
      return `Fabriquée sur commande (${product.leadTimeDays ?? "?"} jours)`;
    default:
      return `${product.quantityAvailable} pièce(s) disponible(s)`;
  }
}

function unavailableText(product: PublicProduct): string {
  switch (product.availability) {
    case "PORTFOLIO":
      return "Cette réalisation fait partie du portfolio de l’atelier. Elle n’est pas à vendre, mais l’atelier réalise des pièces sur demande.";
    case "SOLD":
      return "Cette pièce a trouvé preneur. D’autres créations de l’atelier sont peut-être disponibles.";
    default:
      return "Cette pièce n’est pas disponible pour le moment.";
  }
}
