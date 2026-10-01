# Ojà  Design System v1.0

Marketplace d'artisanat africain  Furniture · Design · Décoration · Artisanat.

Ce document transcrit le dev handoff Figma (fichier `dfkhsBYiS9gXHDP5vj4i9U`, page **Doc**).
Il sert de référence unique pour l'implémentation front. Les valeurs viennent
directement des frames Figma  ne rien inventer, ne rien arrondir.

- Tokens CSS → [`styles/tokens.css`](styles/tokens.css)
- Échelle typographique → [`styles/typography.css`](styles/typography.css)

---

## Couleurs

### Marque
| Token | Hex | Usage |
|---|---|---|
| `Brand/Primary` | `#E35619` | CTAs, liens actifs, icônes, mise en avant des prix |
| `Brand/Primary Dark` | `#B94410` | État hover des boutons |
| `Brand/Primary Light` | `#FFF3ED` | Fond clair des badges, onglets actifs |

### Neutres
| Token | Hex | Usage |
|---|---|---|
| `Neutral/Black` | `#232526` | Titres, corps de texte, fond du footer |
| `Neutral/White` | `#FFFFFF` | Fonds, cartes, champs |
| `Gray/100` | `#F8F9FA` | Fonds de page, séparateurs de section |
| `Gray/300` | `#E9ECEF` | Bordures de champs et de cartes, séparateurs |
| `Gray/500` | `#ADB5BD` | Texte désactivé, placeholders |
| `Gray/700` | `#6B6B6B` | Sous-titres, légendes, métadonnées |

### États / feedback
Chaque état a une variante de fond clair pour les badges.

| Token | Texte | Fond badge | Usage |
|---|---|---|---|
| `Success` | `#2E7D32` | `#E8F5E9` | Confirmé, validé, payé |
| `Info` | `#1565C0` | `#E3F2FD` | En transit, en livraison |
| `Warning` | `#F57C00` | `#FFF3ED` | En attente, en fabrication |
| `Danger` | `#C62828` | `#FFEBEE` | Erreurs, annulé, bloqué |

---

## Typographie

**Fredoka One** pour les titres, **Rethink Sans** pour l'UI et le corps.
Format : `taille / line-height / letter-spacing`.

| Style | Police | Specs | Usage |
|---|---|---|---|
| H1/Desktop | Fredoka One Regular | 56px / 120% / -2% | Bannières hero |
| H1/Mobile | Fredoka One Regular | 32px / 120% / -2% | Bannières hero (mobile) |
| H2/Desktop | Fredoka One Regular | 40px / 130% / -1% | Titres de section |
| H2/Mobile | Fredoka One Regular | 26px / 130% / -1% | Titres de section (mobile) |
| H3/Desktop | Fredoka One Regular | 28px / 130% / -1% | Titres produit, en-têtes de modale |
| H3/Mobile | Fredoka One Regular | 20px / 130% / 0% | Titres produit (mobile) |
| Heading-Small | Rethink Sans SemiBold | 18px / 140% / 0% | En-têtes dashboard, sous-titres de carte |
| Body/Large | Rethink Sans Regular | 18px / 150% / 0% | Descriptions produit, chapô |
| Body/Regular | Rethink Sans Regular | 16px / 150% / 0% | Corps de texte, labels de formulaire |
| Body/Small | Rethink Sans Regular | 14px / 140% / 0% | Légendes, métadonnées, liens de footer |
| Button-Label | Rethink Sans SemiBold | 16px / 100% / +1% | Tous les boutons (Primary/Secondary) |
| Button-Label-Small | Rethink Sans Bold | 14px / 140% / 0% | Petits boutons, CTAs de carte |
| Caption/Tiny | Rethink Sans Medium | 12px / 140% / 0% | Badges, étiquettes de prix, mentions légales |

---

## Spacing & Radius

Système à base **8px**. Les radius sont sémantiques  nommés par rôle de composant.

**Échelle de spacing** : 4, 8, 12, 16 (gutter), 20 (marge mobile), 24, 32, 40, 48, 56, 64, 80, 96, 120.

| Radius | Valeur |
|---|---|
| `--radius-input` | 12px |
| `--radius-card-mobile` | 12px |
| `--radius-card` | 16px |
| `--radius-banner` | 24px |
| `--radius-pill` | 999px |

**Ombres**
- `--shadow-card` : `0px 4px 12px rgba(35, 37, 38, 0.06)`
- `--shadow-modal` : `0px 8px 32px rgba(35, 37, 38, 0.12)`

---

## Grille & Layout

### Breakpoints
- **Desktop** : 1440px de large, hauteur auto
- **Mobile** : 390px de large, hauteur auto

### Grilles colonnes
- **Desktop** : 12 colonnes · marge 60px · gouttière 16px · colonne 94.66px · conteneur max 1320px
- **Mobile** : 4 colonnes · marge 20px · gouttière 16px · colonne 79.5px · conteneur 350px

### Grille produit
`display: flex` + `flex-wrap: wrap` (auto-layout Horizontal Wrap dans Figma).

- **Desktop (1440px)** : 4 cartes par ligne · carte 318px · gap 16px (h) + 24px (v)
  → `(1320 - 3×16) / 4 = 318px`
- **Mobile (390px)** : 2 cartes par ligne · carte 167px fixe · gap 16px
  → `167 + 16 + 167 = 350px` = largeur du conteneur

---

## Inventaire des composants

| Composant | États / variantes | Specs |
|---|---|---|
| **Btn / Primary** | Default, Hover, Disabled | Padding 16px 32px · radius 999px · fill `Brand/Primary` · texte `Neutral/White` |
| **Btn / Secondary** | Default, Hover | Padding 16px 32px · radius 999px · pas de fill · bordure 1px `Brand/Primary` · texte `Brand/Primary` |
| **Btn / Outline** | Default, Hover | Padding 16px 32px · radius 999px · bordure 1px `Gray/300` · fond blanc · texte noir |
| **Btn / Icon** | variante unique | 48×48 · radius 50% · padding 12px · fond blanc · bordure 1px `Gray/300` |
| **Input / Text** | Default, Focus, Error | Hauteur 52px desktop / 48px mobile · padding 14px 16px · radius 12px · bordure 1px `Gray/300`<br>Focus : bordure `Brand/Primary` + inner glow 3px `Primary-Light`<br>Error : bordure `State/Danger` |
| **Stepper / Quantity** | variante unique | Hauteur 44px · radius 999px · bordure 1px `Gray/300` · interne : Btn(−) + Count + Btn(+) |
| **Badge** | Pending, Success, Info, Danger, Warning | Padding 4px 12px · radius 999px · `Caption/Tiny`<br>Pending `#FFF3ED`/`#B94410` · Success `#E8F5E9`/`#2E7D32` · Info `#E3F2FD`/`#1565C0` · Danger `#FFEBEE`/`#C62828` |
| **Catalog Card** | Desktop, Mobile | 318px / 167px de large · radius 16px / 12px · `--shadow-card` · ratio image 4:5 |
| **Cart Card** | Desktop, Mobile | Layout horizontal : miniature + infos produit + stepper qté + prix · bordure 1px `Gray/300` |
| **Modal / Container** | variante unique | Max-width 560px · radius 24px · padding 32px · `--shadow-modal` |
| **Privacy Note Banner** | variante unique | Fond `Gray/100` · radius 12px · padding 16px · texte de mention légale obligatoire |
| **Link - OJA** | Default, Black, White | Logo/lien de marque, variantes de couleur selon le fond |

---

## Notes d'implémentation e-commerce

**Affichage des prix**  `H3/Mobile` pour l'entier (`$64`), `Body/Small` pour les décimales (`.00`) et le symbole monétaire. Anciens prix : `Body/Small` + `Gray/500` + barré.

**Ligne commission**  « Oja Commission (5%) » dans le récapitulatif panier : `Body/Regular` noir à gauche, `Body/Regular` `Gray/700` à droite. Inclure une icône info avec tooltip.

**Frais de livraison**  Afficher « Calculated based on location » initialement. Champ code postal/adresse + bouton « Update ». Passe à `$X.XX` à la soumission.

**Bannière vie privée**  Légalement obligatoire, utilise le composant *Privacy Note Banner*. Texte :
> « Oja handles all payments and coordinates. Creator & client contact info is strictly hidden. All inquiries go through Support. »
