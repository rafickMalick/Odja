/* Les maquettes affichent les montants sous deux formes :
   « 7500 FCFA » sur les cartes du catalogue, « 194 250 F CFA » sur la fiche
   produit. On garde les deux plutôt que d'uniformiser. */

export function formatFcfa(value: number): string {
  return `${value.toLocaleString("fr-FR").replace(/ | /g, " ")} F CFA`;
}

/* La maquette écrit « 7500 FCFA » sans séparateur, ce qui reste lisible à
   quatre chiffres. Le catalogue réel monte à six chiffres (168 000), où le
   collage devient illisible : on garde la forme courte « FCFA » de la carte
   mais on rétablit le séparateur de milliers. */
export function formatCompactFcfa(value: number): string {
  return `${value.toLocaleString("fr-FR").replace(/ | /g, " ")} FCFA`;
}
