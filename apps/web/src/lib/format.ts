/* Une seule écriture des montants sur tout le site : « 194 250 F CFA ».
   Les maquettes en montraient deux (« 7500 FCFA » sur les cartes), ce qui
   faisait lire deux écritures différentes pour la même pièce d'une page à
   l'autre. */

export function formatFcfa(value: number): string {
  return `${formatNumber(value)} F CFA`;
}

/** Ancien nom de la forme « carte » : même écriture que partout ailleurs. */
export const formatCompactFcfa = formatFcfa;

/**
 * Nombres à la française : virgule décimale, espace pour les milliers
 * (« 1 200 », « 4,1 »). `toFixed()` donnerait « 4.1 », à l'anglaise.
 */
export function formatNumber(value: number, fractionDigits = 0): string {
  return value
    .toLocaleString("fr-FR", {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    })
    .replace(/ | /g, " ");
}
