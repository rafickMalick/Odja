# Ojà — suivi d'implémentation

> **Le front a déménagé dans `apps/web/`.** Le dépôt est devenu un monorepo
> (`apps/web`, `apps/api`, `packages/db`, `packages/domain`). Les commandes
> passent par la racine : `npm run web`, `npm run api`. Voir [`README.md`](README.md).

Fichier Figma : `dfkhsBYiS9gXHDP5vj4i9U` · page **Design** = `6:2` · page **Doc** (handoff) = `73:6197`.

Stack : Next.js 15 (App Router) + TypeScript + CSS Modules. Aucun backend —
panier en React Context + `localStorage`.

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # build de production
```

## Écrans

| Écran | Route | Node Figma | État |
|---|---|---|---|
| Home | `/` | `84:2317` (hero seul) | ✅ complétée hors Figma |
| Catalog | `/catalogue` | `31:700` · mobile `59:5755` | ✅ |
| Listing (fiche produit) | `/produit/[slug]` | `16:2837` · mobile `56:4441` | ✅ |
| Cart | `/panier` | `10:1264` · mobile `41:3529` | ✅ |
| Checkout | `/checkout` | `33:700` · mobile `58:1330` | ✅ |
| Confirmation | `/confirmation` | `35:781` · mobile `61:1541` | ✅ |
| Connexion | `/connexion` | `88:3513` · mobile `102:1792` | ✅ |
| Inscription | `/inscription` | `88:3475` · mobile `102:1746` | ✅ |

## Landing page

Le frame Figma `84:2317` s'arrête au hero. La Home est désormais une vraie page
d'accueil de place de marché, composée à partir du design system :

| Section | Contenu |
|---|---|
| Hero | Frame Figma, copie réécrite en français sur le positionnement réel |
| Réassurance | 4 engagements (paiement, livraison, ateliers vérifiés, retours) sur bandeau Gray/100 |
| Manifeste | Raison d'être + 3 chiffres clés en cartes Primary/Light |
| Catégories | 4 tuiles illustrées vers le catalogue |
| Sélection | 4 `CatalogCard`, mêmes composants que le catalogue |
| Atelier à l'honneur | Visuel + récit + citation attribuée |
| Comment ça marche | Les 4 temps du parcours, escrow compris |
| Rejoindre Ojà | Les 3 profils ouverts à l'inscription + note sur le rôle admin |
| Appel final | Bandeau `Neutral/Black` à deux CTA |

Les sections sont des bandes pleine largeur : `.page` ne porte plus de padding
horizontal, chaque section gère sa gouttière et son fond. Vérifié sans
débordement horizontal sur 4 pages × 4 largeurs (390, 768, 1024, 1440).

**Les trois chiffres de la section Manifeste (120+ ateliers, 4 pays, 100 % de
paiements Mobile Money) sont des valeurs d'exemple.** Ils devront être servis
par le backend ou corrigés avant toute mise en ligne publique.

## Barre de navigation mobile

Aucun frame Figma ne décrit la nav bar sous 900px. La première version repliait
les liens sur une seconde ligne défilant horizontalement : un menu qu'il faut
faire glisser pour découvrir ne se lit pas, et le header occupait deux rangées.

Remplacé par une **barre compacte de 60px** — logo, recherche, panier, menu —
et un **panneau latéral** :

- cibles tactiles de 44px, la pastille du panier passe en exposant sur l'icône
  avec un liseré blanc pour rester lisible ;
- le filet et l'ombre du header n'apparaissent qu'une fois la page défilée
  (`data-scrolled`), la barre se fond dans le hero en haut de page ;
- panneau glissant de 340px, ombrage à 45 %, fermeture au clic hors zone, à
  Échap et à chaque navigation ;
- défilement de la page gelé à l'ouverture et restauré à la fermeture, focus
  porté sur le bouton de fermeture puis **rendu au bouton d'ouverture** ;
- fermé, le panneau est en `visibility: hidden` — donc hors de l'ordre de
  tabulation, et non seulement invisible.

**Le panneau est rendu hors du `<header>`** : celui-ci porte un
`backdrop-filter`, qui crée un bloc conteneur — un enfant `position: fixed` s'y
serait ancré au lieu de couvrir la fenêtre.

Chevrons et icônes du menu tracés en ligne plutôt qu'en `<img>`, pour hériter
de `currentColor` et suivre la couleur de la ligne active.

## Contenu harmonisé

Le contenu d'exemple resté dans les maquettes a été remplacé :

- **Catalogue** — les 6 fiches étaient du mobilier nord-américain (Ikea,
  Wayfair, CB2, « Sagewood Double Dresser »), toutes rangées en « Luminaire »,
  dont une à 0 F CFA. Réécrites sur des ateliers d'Afrique de l'Ouest, réparties
  entre Mobilier / Luminaires / Textile / Décoration — le filtre du catalogue
  renvoie enfin des résultats sur plusieurs catégories — et illustrées avec les
  visuels déjà présents dans `public/images/`.
- **Catégories du panier** — « Textiles » ne correspondait à aucune entrée de
  `CATEGORIES`, corrigé en « Textile ».
- **Libellés de carte** — « Brand: / Material: » → « Atelier : / Matière : »,
  sur la carte catalogue comme dans le panier.
- **Footer** — colonnes « Home / About / Service / Testimonials / Pricing » et
  « Privacy Policy… » traduites et raccordées aux routes réelles ; newsletter
  (« Join the newsletter », « Show Now! ») passée en français.
- **`formatCompactFcfa`** — la maquette écrit « 7500 FCFA » sans séparateur, ce
  qui reste lisible à quatre chiffres mais plus à six (168000). Le séparateur de
  milliers est rétabli, la forme courte « FCFA » conservée.

## Backend

Deux documents, à lire dans cet ordre :

| Document | Répond à |
|---|---|
| [`CAHIER-DES-CHARGES-BACKEND.md`](CAHIER-DES-CHARGES-BACKEND.md) | **Quoi** et **pourquoi** — architecture, schéma de données, flux de paiement, décisions tranchées |
| [`BACKLOG-BACKEND.md`](BACKLOG-BACKEND.md) | **Quoi faire** — 234 tâches identifiées, ordonnées, avec critères de sortie de lot |

NestJS + PostgreSQL + Prisma, quatre rôles, grand livre en partie double et
intégration de l'agrégateur de paiement **Kadev Pay** (`pay.kadev.ci`).

⚠️ Douze pré-requis (§ 0 du backlog) bloquent du développement : décisions
produit, ouvertures de compte et avis juridiques. Rien ne commence sans eux.

---

Deux écrans supplémentaires, **absents du fichier Figma** (la nav y renvoyait
sans qu'aucun frame ne soit dessiné), composés à partir du design system :

| Écran | Route | Contenu |
|---|---|---|
| Contact | `/contact` | Bandeau Gray/100, formulaire (motif, n° de commande, message), 3 cartes de canaux, bannière de confidentialité |
| Recherche | `/recherche` | Barre de recherche en pill, filtres par catégorie, grille de résultats, état vide avec suggestions |

La recherche filtre réellement le catalogue (nom, marque, matière, catégorie),
insensible à la casse et aux accents, et reflète la requête dans l'URL (`?q=`)
pour être partageable.

## Responsive

Breakpoints : **1200px** (grandes tablettes), **1100px** (passage en colonne des
mises en page à deux colonnes), **900px** (bascule mobile, marge 20px du
handoff), en plus des grilles produit 4 → 3 → 2 colonnes.

Vérifié avec Chrome en headless piloté par CDP sur **10 pages × 6 largeurs**
(360, 390, 768, 1024, 1280, 1440) : mesure du débordement horizontal réel
(`scrollWidth` vs viewport) et identification des éléments fautifs. Résultat
final : aucun débordement.

Corrections issues de cet audit :

- `CatalogCard` — la ligne « Brand / Material » était en `nowrap` : à 167px de
  large elle sortait de la carte et recouvrait la colonne voisine. Elle se
  replie désormais, et la puce « • » est rattachée à la seconde paire pour ne
  pas rester orpheline en fin de ligne.
- Hero de la Home — `width: 490px` sur le sous-titre forçait la largeur au lieu
  de la plafonner : remplacé par `max-width`.
- Rangées défilantes (filtres de recherche, fil d'étapes) — sans `width: 100%`
  explicite, un enfant flex en `align-items: flex-start` se dimensionne sur son
  contenu et `overflow-x` n'a rien à borner.
- Barres « champ + bouton pill » (livraison, code promo, newsletter) —
  gouttières resserrées sous 900px.
- Footer — les deux mentions légales se chevauchaient à 390px, désormais
  empilées.

## Taille de la typographie

Les maquettes sont dessinées sur un canevas 1440px, ce qui donne une typo
d'affichage très grande dans un navigateur réel. Toutes les tailles ≥ 20px
passent par un facteur unique, `--type-scale` dans `styles/tokens.css`
(actuellement `0.78`). Les tailles ≤ 18px (labels, légendes, badges) sont
inchangées pour rester lisibles. **Mettre `--type-scale: 1` restitue exactement
les valeurs Figma.** Le wordmark de la Home est en `clamp()` pour suivre la
largeur du viewport.

Les frames mobiles Figma n'ont pas été récupérés un à un — le responsive est
dérivé des maquettes desktop et des breakpoints du handoff. C'est le principal
poste de reprise si tu veux un mobile au pixel près.

Hors périmètre : espace vendeur (`108:2532`, `108:2793`, `161:3414`) et section
**Inspi** (`180:2658`, références d'inspiration).

## Navigation entre pages

```
Home ──► Catalogue ──► Fiche produit ──► Panier ──► Checkout ──► Confirmation
                                             ▲                        │
                                             └──── Continuer mes achats┘
Header : Marketplace · Vendre sur OJÀ (visiteurs) · À propos · Contact · Compte · Panier
Compte ──► Connexion ⇄ Inscription
```

Le panier persiste dans `localStorage` ; la commande validée est archivée pour
alimenter l'écran de confirmation.

## Écarts assumés par rapport aux maquettes

Chaque point est un choix délibéré, pas un oubli.

1. **Header partagé** — seul l'écran Confirmation possède une Nav bar dans
   Figma (`35:782`). Elle est reprise comme header commun à toutes les pages,
   sans quoi la navigation serait impossible. Un lien **Panier** avec compteur y
   a été ajouté : la maquette n'en prévoit pas, le parcours d'achat l'exige.
2. **Footer sur la Home** — le frame Home s'arrête au hero ; le footer commun
   est ajouté pour la cohérence de navigation.
3. **Écrans d'authentification sans chrome** — Connexion et Inscription sont
   dessinés en pleine page ; `Chrome.tsx` retire header et footer sur ces routes.
3 bis. **Appels à s'inscrire réservés aux visiteurs** — « Vendre sur Ojà »,
   « Devenir livreur », « Ouvrir ma boutique », les cartes « Rejoindre Ojà »
   et l'encart créateur de « À propos » disparaissent pour un client, un
   créateur ou un livreur connecté : un compte porte un seul rôle, ces liens
   ne lui offraient rien. L'administrateur les garde, il contrôle le site tel
   qu'un visiteur le voit. Une seule requête `/auth/me`, partagée par
   `SessionProvider` (`lib/session.tsx`) et relue à chaque navigation ; les
   pages serveur passent par `ForVisitors`, qui rend son contenu tant que la
   session est inconnue (moteurs de recherche, visiteurs) et le retire à la
   réponse.
4. **Titre du footer** — 49px/60px sur le frame Catalog, 56px/120% sur Listing,
   pour une même instance de composant. On retient 56px, valeur du token
   `H1/Desktop`.
5. **Ratio des images de carte** — le handoff annonce 4:5, la maquette Catalog
   utilise un carré (400/400). On suit la maquette.
6. **Prix barrés** — le handoff impose gris + barré pour les anciens prix ;
   l'export Figma ne portait pas toujours la décoration. On applique la règle
   du handoff.
7. **Contenu d'exemple résiduel** — plusieurs frames avaient gardé du contenu
   sans rapport : fil d'Ariane « Facewashes » et fiche technique « Daily
   Facewash (Foaming Cleanser) » sur un fauteuil en teck, prix en € sur
   l'écran Confirmation alors que tout le reste est en F CFA, ancien prix
   inférieur au prix courant sur les cartes du panier. Structure et libellés
   conservés, valeurs rendues cohérentes.
8. **Catégories du catalogue** — les 6 produits de la maquette portent tous la
   catégorie « Luminaire ». Le filtre est fonctionnel ; les autres catégories
   affichent donc un état vide.
9. **Panier pré-rempli** — au premier chargement, le panier est initialisé avec
   les 3 articles textiles de la maquette (`CART_SEED`) pour que l'écran
   s'affiche tel qu'il est dessiné. Toute action utilisateur reprend la main.
   Voir `src/lib/products.ts`.
10. **Pastille de l'étape active** — le stepper affiche un fond pâle bordé sur
    Panier/Checkout et un fond orange plein sur Confirmation dans Figma. Une
    seule variante est implémentée (fond pâle bordé).
11. **Fredoka One** — retirée du catalogue Google Fonts, donc inconnue de
    `next/font/google`. Le fichier d'origine est auto-hébergé dans
    `src/fonts/FredokaOne-Regular.woff2`.
12. **Icônes Rechercher et Compte** — Figma les a exportées vides (des groupes
    `Vector` sans tracé). Elles ont été redessinées dans le style outline du
    reste du fichier : `public/images/icon-search.svg` et `icon-account.svg`.
    Les 26 autres SVG proviennent bien de l'export Figma.
13. **Contact et Recherche** — aucun frame Figma n'existe pour ces écrans ; ils
    sont composés à partir du design system et des composants déjà en place.

## Assets

Téléchargés depuis Figma dans `public/images/`. Les URLs de l'API MCP expirent
au bout de 7 jours : les fichiers sont donc versionnés dans le dépôt.

## Structure

```
src/
  app/                 pages (une par écran) + globals.css
  components/          Button, Field, Badge, CatalogCard, StepperQuantity,
                       ProgressStepper, PrivacyNoteBanner, Header, Footer,
                       Chrome, AuthLayout
  lib/                 cart.tsx (état panier + commande), products.ts, format.ts
  fonts/               Fredoka One auto-hébergée
styles/                tokens.css, typography.css  ← transcription du handoff
```

## Authentification : e-mail plutôt que SMS

La vérification du téléphone par OTP SMS a été **mise de côté**, sur décision
produit. Le raisonnement chiffré : à 25–50 F CFA le SMS, vérifier à
l'inscription fait payer pour tous les visiteurs curieux, dont la plupart ne
commanderont jamais. Sur 1 000 inscriptions dont 100 commandes, c'est dix fois
le prix de la même vérification faite à la première commande.

Le compte s'ouvre donc à l'e-mail, et la session est posée **dans le même
geste** : bloquer l'accès derrière un clic dans une boîte aux lettres perd le
visiteur au moment précis où il vient d'arriver. Un lien de confirmation part
quand même — il sert aux notifications de commande et à la récupération de mot
de passe.

**Toute la machinerie OTP reste en place**, derrière `REQUIRE_PHONE_VERIFICATION`.
Sa place naturelle est la **première commande** : c'est là que le numéro prend
une valeur opérationnelle, puisque c'est celui que le livreur appellera.

Deux arbitrages assumés au passage :

- l'inscription **refuse franchement** une adresse déjà prise (409) au lieu de
  répondre « regardez vos e-mails » quoi qu'il arrive. La seconde forme
  protégerait mieux contre l'énumération des comptes, mais imposerait un détour
  par la boîte aux lettres à chaque nouveau visiteur ;
- la réinitialisation de mot de passe part **par e-mail**. C'est le canal qui
  ouvre le compte, c'est celui qui doit permettre de le récupérer.

**Piège rencontré** — `z.coerce.boolean()` applique `Boolean()`, et
`Boolean("false")` vaut `true`. `REQUIRE_PHONE_VERIFICATION=false` réactivait
donc la vérification par SMS, ce qui bloquait toutes les connexions. Un
`booleanFromEnv` lit désormais la chaîne pour ce qu'elle dit, et trois tests
gardent la porte. Le même piège se trouvait sur le filtre `?inStock=false` du
catalogue, corrigé aussi.
