# Ojà

Place de marché du mobilier, du design, de la décoration et de l'artisanat
africain. Ojà reste l'intermédiaire unique entre créateurs et acheteurs : les
coordonnées ne circulent jamais, les paiements et les livraisons passent par la
plateforme.

## Documents

À lire dans cet ordre :

| Document | Ce qu'il donne |
|---|---|
| [`SPEC-ALIGNEMENT.md`](SPEC-ALIGNEMENT.md) | **Fait autorité.** Modèle financier, statuts, livraison, ordre des lots |
| [`CAHIER-DES-CHARGES-BACKEND.md`](CAHIER-DES-CHARGES-BACKEND.md) | Architecture détaillée. Valable partout où l'alignement est muet |
| [`INVENTAIRE.md`](INVENTAIRE.md) | **Tout ce qui est fait et ce qu'il reste**, écran par écran |
| [`ETAT-PROJET.md`](ETAT-PROJET.md) | Le résumé de l'inventaire, pour le client |
| [`BACKLOG-BACKEND.md`](BACKLOG-BACKEND.md) | 234 tâches identifiées, ordonnées, avec critères de sortie |
| [`DESIGN-SYSTEM.md`](apps/web/DESIGN-SYSTEM.md) | Tokens, typographie, composants |
| [`NOTES-IMPLEMENTATION.md`](NOTES-IMPLEMENTATION.md) | Journal du front |

## Structure

```
apps/
  web/        Front Next.js 15 — vitrine et parcours d'achat
  api/        API NestJS 11 — REST sous /api/v1
packages/
  db/         Schéma Prisma, migrations, seed, client généré
  domain/     Logique métier pure : prix, livraison, machines à états
  contracts/  DTO partagés API ⇄ front — schémas Zod, un seul jeu de règles
```

`packages/domain` ne dépend de rien : ni base, ni HTTP, ni framework. C'est
volontaire — c'est le code où une erreur coûte de l'argent, il doit se tester
en millisecondes et sans infrastructure.

## Démarrer

```bash
./start.sh --demo
```

Un seul geste : vérifie les pré-requis, installe si besoin, démarre
l'infrastructure, migre la base, la peuple, lance l'API et le front, attend
qu'ils répondent vraiment. Rejouable sans risque — le relancer sur un projet
déjà démarré ne casse rien.

```
./start.sh              tout, sans données de démonstration
./start.sh --demo       + un atelier validé et 4 pièces publiées
./start.sh --fresh      repart d'une base vide
./start.sh --check      types, tests, build — rien ne démarre
./start.sh --stop       arrête tout
./start.sh --help       le détail
```

Pour les étapes à la main :

```bash
npm install
cp .env.example .env

npm run infra:up      # Postgres 16, MinIO, Mailpit
npm run db:migrate    # applique les migrations
npm run db:seed       # pays UEMOA, villes, catégories, tarifs véhicules
npm run db:demo       # un atelier validé et 4 pièces publiées, pour voir tourner

npm run api           # API   → http://localhost:4000/api/v1
npm run web           # Front → http://localhost:3000
```

Vérifier que tout répond :

```bash
curl http://localhost:4000/api/v1/health
curl http://localhost:4000/api/v1/health/reference-data
```

### Les quatre espaces

| Adresse | Pour qui | Ce qu'on y fait |
|---|---|---|
| `/compte` | Client | Suivre ses commandes, **confirmer la réception colis par colis**, réclamer, gérer ses adresses |
| `/espace-createur` | Artisan | Boutique, dossier, fiches et photos, commandes, portefeuille |
| `/espace-livreur` | Livreur | Missions, itinéraires, **preuve de remise**, gains — pensé pour un téléphone |
| `/admin` | Équipe Ojà | Dossiers, modération, affectation, litiges, grand livre, journal, réglages |

### Conteneurs

```bash
docker build -f apps/api/Dockerfile -t oja-api .
docker build -f apps/web/Dockerfile -t oja-web .
```

Les deux images sont multi-étages, tournent sans privilège, et sont
reconstruites à chaque poussée par la CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)),
qui exécute aussi les tests contre un vrai PostgreSQL et un vrai MinIO.

## Contrôles

```bash
npm test         # 308 tests
npm run typecheck
npm run build
```

## Ce qui est déjà en place

- **Schéma de données complet** — 30 modèles, aligné sur le cahier client
- **Invariants du grand livre garantis en base**, pas seulement dans le code :
  une écriture comptable ne peut être ni modifiée ni supprimée, et une
  transaction déséquilibrée est refusée au `COMMIT`
- **Calcul de prix** au modèle du cahier client : la commission s'ajoute au
  prix du créateur, qui touche exactement ce qu'il a fixé
- **Choix automatique du véhicule** — moto, tricycle ou camionnette, selon
  poids, volume, encombrement et distance
- **Machines à états** des trois profils, avec les libellés du cahier client
- **Refus de démarrer** sur une configuration dangereuse (clé de paiement de
  test en production, ou l'inverse)
- **Authentification complète** — argon2id poivré, JWT court + jeton de
  rafraîchissement rotatif, cookies `httpOnly`, confirmation d'adresse par lien,
  réinitialisation de mot de passe. Détection de rejeu : un jeton déjà consommé ferme toutes
  les sessions de l'utilisateur
- **Tout est fermé par défaut** — les gardes sont globaux, l'ouverture est
  explicite. Un accès refusé renvoie `404`, jamais `403`
- **Catalogue complet** — boutiques créateurs avec séparation stricte
  public / privé, dossier KYC et validation par l'administration, fiches
  produit avec modération, recherche plein texte française insensible aux
  accents, facettes et filtres
- **Panier et commande** — panier serveur dès le premier clic, sans compte,
  fusionné à la connexion. Chiffrage au réel : **une livraison par atelier**,
  distance mesurée, véhicule choisi automatiquement. La commande s'éclate en
  sous-commandes, fige tout ce qui a une portée comptable et réserve le stock
  avant le moindre paiement
- **Cycle de vie complet, encaissement compris** — avec un fournisseur de
  paiement **simulé**. L'atelier accepte ou refuse sous 48 h, le compte à
  rebours de fabrication vient du délai annoncé sur la fiche, le statut vu par
  le client est dérivé de ses sous-commandes
- **Grand livre en partie double alimenté** à chaque encaissement, chaque
  annulation, chaque frais d'agrégateur. Ses invariants sont vérifiables à la
  demande
- **Livraison complète** — l'administration crée les tournées et affecte les
  livreurs, le livreur enlève, roule et remet. La **preuve de livraison**
  (code, photo, position — deux sur trois) verrouille le circuit : sans elle,
  pas de remise, donc pas de versement
- **Validation à la réception** — le client valide ou signale un problème.
  C'est ce clic qui programme le versement au créateur, 24 h plus tard. Un
  client passif ne bloque pas l'atelier : validation automatique après délai
- **Réclamations et remboursements** — client et créateur parlent chacun à Ojà,
  jamais l'un à l'autre. L'administration arbitre : remboursement de 100 % du
  prix produit, et le choix de qui supporte la perte. Notes d'équipe invisibles
  des parties, délai de traitement suivi
- **Téléversement de fichiers** — l'API signe une URL, le navigateur envoie
  directement au stockage. Deux espaces séparés : public pour les photos de
  fiches, privé pour les pièces d'identité et les preuves de livraison, qui
  n'ont **jamais** d'URL stable
- **Front raccordé à l'API** — le catalogue, la recherche, la fiche produit, le
  panier, le passage en caisse et la confirmation lisent des données réelles.
  Plus aucun fichier statique. La fiche produit affiche les trois lignes de
  prix du cahier client, et le panier se groupe par atelier
- **Les quatre espaces**, sur le même langage visuel — sauf l'espace livreur,
  conçu pour un téléphone tenu d'une main : navigation en bas, cibles de 44 px,
  une seule action visible à la fois
- **Ordonnanceur** — les quatre échéances du cahier (validation à 72 h,
  versement à 24 h, refus au silence de 48 h, expiration des paiements)
  s'exécutent seules. Verrou consultatif PostgreSQL : deux instances ne
  libèrent pas deux fois le même versement, et chaque tâche est idempotente
- **Avis par e-mail** à chaque étape qui appelle un geste : commande reçue,
  colis livré, réception confirmée, dossier tranché, fiche modérée, course
  affectée. Un envoi qui échoue n'annule jamais l'action métier
- **Limitation de débit** sur la connexion, l'inscription, les codes et la
  preuve de remise. Comptée par utilisateur quand il est connu, par adresse
  sinon — deux collègues derrière le même NAT ne se bloquent pas

## Ce qui n'est pas encore là

L'agrégateur de paiement et l'exécution des versements — les deux dépendent
d'un compte marchand Kadev Pay. Puis les SMS réels, l'idempotence des routes de
paiement, l'OpenAPI, le TOTP administrateur, les avis clients et le suivi du
livreur en temps réel.
Voir [`BACKLOG-BACKEND.md`](BACKLOG-BACKEND.md) et [`ETAT-PROJET.md`](ETAT-PROJET.md).

**Le paiement est volontairement repoussé au dernier lot.** Il vit derrière une
interface `PaymentProvider` ; un fournisseur simulé permet de dérouler tout le
parcours — commande, fabrication, livraison, validation, versement — sans
attendre l'agrégateur.

## Conventions

- **Montants** : entiers, en franc CFA. Le XOF n'a pas de sous-unité d'usage —
  aucun flottant ne touche un montant, jamais.
- **Taux** : points de base. `500` = 5 %.
- **Valeurs figées** : tout ce qui a une portée comptable est copié à la
  commande, jamais référencé. Un créateur qui change ses prix ne réécrit pas
  l'histoire d'une commande passée.
- **Transitions d'état** : jamais par affectation directe. Elles passent par
  `assertTransition`, qui refuse ce que le métier interdit.

## Écarts assumés

- **npm workspaces** plutôt que pnpm : pnpm n'est pas installé sur le poste de
  développement, et npm 10 suffit. Le passage à pnpm ne toucherait que la
  racine.
- **PostgreSQL en conteneur sur le port 55432**, décalé pour ne pas entrer en
  conflit avec une installation système.
