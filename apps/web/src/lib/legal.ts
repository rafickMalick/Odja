/**
 * Identité légale d'Ojà, en un seul endroit.
 *
 * Les pages légales (mentions, confidentialité, conditions) lisent tout ici :
 * le jour où la société est immatriculée, on remplit ce fichier et toutes les
 * pages sont à jour. Une valeur `null` n'est pas affichée du tout (la raison
 * sociale est alors remplacée par « Ojà ») : jamais d'information inventée,
 * ni de mention provisoire visible sur le site.
 */
export const LEGAL = {
  brand: "Ojà",
  /** Raison sociale, ex. « Ojà SARL ». */
  companyName: null as string | null,
  /** Forme juridique et capital, ex. « SARL au capital de 1 000 000 F CFA ». */
  legalForm: null as string | null,
  /** Adresse du siège. */
  address: null as string | null,
  /** Numéro RCCM. */
  rccm: null as string | null,
  /** Identifiant fiscal unique (IFU). */
  ifu: null as string | null,
  /** Directeur ou directrice de la publication. */
  publicationDirector: null as string | null,
  /** Adresse du service client, affichée partout sur le site. */
  supportEmail: "support@oja.market",
  /** Pays dont le droit s'applique. */
  country: "Bénin",
  /** Date de la version en vigueur des documents légaux. */
  updatedAt: "2 octobre 2026",
} as const;
