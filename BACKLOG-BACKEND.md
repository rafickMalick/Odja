# Ojà — Backlog backend

**Version 1.0 — 12 août 2026**
Déclinaison exécutable de [`CAHIER-DES-CHARGES-BACKEND.md`](CAHIER-DES-CHARGES-BACKEND.md).

Le cahier des charges dit **quoi** et **pourquoi**. Ce document dit **quoi faire**,
dans quel ordre, et à quelle condition c'est fini. Chaque tâche porte un
identifiant stable (`L3-07`) pour être citée en réunion, en commit et en ticket.

**234 tâches** (cinq ajoutées en cours de route, voir F1bis) : 12 pré-requis, 9 lots backend (192 tâches) plus une série
transverse de notifications, et 4 lots front (25 tâches).

> **Lisez d'abord le § 0.** Sept pré-requis bloquent du développement : trois
> décisions produit, deux ouvertures de compte et deux avis juridiques. Lancer
> L3 sans `P-01` ou L4 sans `P-04`, c'est coder deux fois.

---

## Définition de « terminé »

Une tâche n'est cochée que si les cinq points sont vrais. Ce n'est pas une
formalité : le § 16 du cahier fait de la couverture des états, du calcul de
prix et du grand livre une exigence, pas un objectif.

1. Le code est revu par quelqu'un d'autre que son auteur
2. Les tests passent en CI, y compris les cas d'erreur et les transitions interdites
3. Les migrations Prisma s'appliquent et se rejouent sur une base vierge
4. L'endpoint apparaît dans l'OpenAPI avec ses codes d'erreur
5. Ce qui touche à l'argent est couvert à 100 %, pas à 70 %

<!-- Ces cinq points sont des critères, pas des tâches : en cases à cocher, ils
     faussaient le décompte du backlog de cinq unités. -->

---

## § 0 — Pré-requis (avant la première ligne de code)

Rien ici n'est technique. Tout y est bloquant.

### Décisions produit — cahier § 19

- [ ] **P-01** Ouvrir le compte marchand Kadev Pay, récupérer les clés `kdvp_test_` / `kdvs_test_` et le secret webhook — **bloque L3**
- [ ] **P-02** Demander **par écrit** à Kadev Pay l'accès au *split* / sous-comptes (§ 19.1). Leur page manipule déjà `split` et `subaccount` — si c'est ouvert, L5 est divisé par deux — **bloque l'arbitrage de L5**
- [ ] **P-03** Fixer le taux de commission plancher, en tenant compte des 2,3 % Mobile Money absorbés (§ 19.2) — **bloque L2-09**
- [ ] **P-04** Trancher le paiement à la livraison : oui ou non (§ 19.3) — **bloque L4**, la logistique change entièrement
- [ ] **P-05** Fixer le délai de libération des fonds, 7 jours par défaut (§ 19.4) — **bloque L4-14**
- [ ] **P-06** Écrire la règle de prise en charge de la casse en transit (§ 19.5) — **bloque L6**

### Juridique et conformité — cahier § 15

- [ ] **P-07** Faire qualifier par un avocat la détention de fonds de tiers au regard de la réglementation BCEAO — **bloque l'ouverture commerciale, pas le développement**
- [ ] **P-08** Vérifier que le statut marchand Kadev Pay couvre une activité de place de marché
- [ ] **P-09** Déposer la déclaration ARTCI et ouvrir le registre des traitements
- [ ] **P-10** Rédiger les trois CGU distinctes (client, fabricant, livreur) — **bloque L0-19**
- [ ] **P-11** Faire confirmer les taux de TVA par pays par un fiscaliste — **bloque L2-08**

### Infrastructure

- [ ] **P-12** Ouvrir les comptes : Postgres managé, Redis, S3, Sentry, Resend, agrégateur SMS. Vérifier la couverture SMS sur CI / BJ / SN / TG avant de signer

---

## L0 — Socle · 3 semaines · 35 tâches

**Objectif** — Un utilisateur s'inscrit, vérifie son téléphone, se connecte, et
l'API refuse ce qu'elle doit refuser.

### Monorepo et outillage

- [x] **L0-01** Workspace pnpm : `apps/api`, `apps/worker`, `packages/db`, `packages/contracts`, `packages/domain`
- [ ] **L0-02** Config TypeScript strict partagée, ESLint, Prettier, hooks de pré-commit
- [x] **L0-03** Docker Compose local : Postgres 16, Redis 7, MinIO, serveur SMTP de test
- [x] **L0-04** Dockerfile multi-étages pour `api` **et pour le front**, images vérifiées au démarrage
- [x] **L0-05** CI : migrations vérifiées → typecheck → tests (Postgres + MinIO réels) → build → images Docker
- [ ] **L0-06** Environnements `staging` / `production`, promotion par image et non par rebuild
- [ ] **L0-07** Gestionnaire de secrets branché, aucune clé dans le dépôt
- [x] **L0-08** **Contrôle bloquant au démarrage** : l'application refuse de booter si une clé `_test_` est chargée en production (§ 7.7)

### Base de données

- [x] **L0-09** Schéma Prisma complet du § 4.2 — 30 modèles
- [x] **L0-10** Migration initiale + jeu de départ : pays UEMOA, villes, zones de livraison, catégories
- [x] **L0-11** Trigger Postgres interdisant `UPDATE` et `DELETE` sur `LedgerEntry` — invariant **I4**
- [x] **L0-12** Contrainte différée : somme des `LedgerEntry` d'une transaction = 0 — invariant **I1**
- [x] **L0-13** Index et clés d'unicité du § 4.2, dont la clé d'idempotence de `PaymentEvent`
- [ ] **L0-14** Harnais Testcontainers : Postgres et Redis réels en test d'intégration

### Authentification

- [x] **L0-15** Hachage argon2id (m=64 Mo, t=3, p=4) + poivre applicatif
- [x] **L0-16** JWT d'accès 15 min + refresh 30 jours en rotation, stocké **haché** en base
- [x] **L0-17** Transport par cookies `httpOnly` + `Secure` + `SameSite=Lax` — jamais de jeton en `localStorage`
- [x] **L0-18** Inscription — **par e-mail**. L'OTP SMS reste en place derrière `REQUIRE_PHONE_VERIFICATION`, à réactiver à la première commande
- [x] **L0-19** Acceptation des CGU horodatée et versionnée en base (dépend de `P-10`)
- [x] **L0-20** Vérification d'adresse e-mail
- [x] **L0-21** Mot de passe oublié / réinitialisation, jeton à usage unique
- [ ] **L0-22** TOTP obligatoire pour `ADMIN`, optionnel pour `MAKER`
- [x] **L0-23** Révocation de session, déconnexion de tous les appareils

### Transverse

- [x] **L0-24** Guard `@Roles()` **plus** vérification de propriété dans chaque service — un accès non autorisé renvoie `404`, jamais `403` (§ 2.1)
- [ ] **L0-25** Middleware `Idempotency-Key` + mémorisation Redis 24 h, réponse rejouée à l'identique
- [x] **L0-26** Limitation de débit sur connexion, inscription, codes et preuve de livraison — par utilisateur quand il est connu
- [x] **L0-27** Validation Zod aux frontières, schémas partagés dans `packages/contracts`
- [x] **L0-28** Erreurs au format RFC 9457 (`application/problem+json`)
- [x] **L0-29** Pagination par curseur générique (`common/pagination.ts`) — pas d'`OFFSET` ; appliquée à `/orders` et `/notifications`, extension mécanique aux autres listes
- [ ] **L0-30** Logger avec filtre de secrets **au niveau du logger** : ni mot de passe, ni OTP, ni clé, ni PAN
- [ ] **L0-31** `AuditLog` + intercepteur automatique sur toute action d'administration
- [ ] **L0-32** OpenTelemetry (traces avec `orderId` / `paymentId` en attributs) + Sentry
- [x] **L0-33** Ordonnanceur des 4 échéances métier, verrou consultatif Postgres (BullMQ non nécessaire à ce stade)
- [x] **L0-34** Stockage S3 : upload signé, URL pré-signées à 5 min, chiffrement au repos pour les pièces KYC
- [ ] **L0-35** OpenAPI exposée sur `/api/docs`, désactivée en production

**Sortie de lot** — Un compte se crée, se vérifie, se connecte. Un `CUSTOMER`
qui demande la ressource d'un autre reçoit `404`. La CI est verte de bout en bout.

---

## L1 — Catalogue · 4 semaines · 25 tâches

**Objectif** — Un artisan vérifié publie une pièce, un visiteur la trouve.

### Catégories et produits

- [x] **L1-01** CRUD catégories (arbre parent/enfant, ordre d'affichage) côté admin
- [x] **L1-02** CRUD produits côté fabricant, restreint à ses propres fiches
- [x] **L1-03** ~~Variantes~~ — supprimées par l'alignement client. Prix, stock, poids et dimensions vivent sur le produit
- [x] **L1-04** Images : upload, ordre, texte alternatif — **entre 3 et 5 par produit** (règle du cahier client)
- [x] **L1-05** Machine à états produit : `DRAFT → PENDING_REVIEW → PUBLISHED | REJECTED → ARCHIVED`
- [x] **L1-06** File de modération admin + motif de rejet renvoyé au fabricant
- [x] **L1-07** **Rien n'est publiable tant que le KYC du fabricant n'est pas approuvé** (§ 2.2)
- [x] **L1-08** Suppression logique et archivage, jamais de suppression dure

### Stock

- [x] **L1-09** `stockOnHand` / `stockReserved`, disponible **toujours calculé**, jamais dénormalisé
- [x] **L1-10** Mise à jour de stock par le fabricant, avec journal des mouvements
- [x] **L1-11** Produits `isMadeToOrder` : pas de stock, un délai de fabrication

### Recherche

- [x] **L1-12** Colonne `searchVector` + fonction de rafraîchissement + trigger (§ 14)
- [x] **L1-13** Index GIN, dictionnaire français, pondération nom > matière > description
- [x] **L1-14** Extension `unaccent` — **la règle doit être identique à celle du front**, sinon les résultats divergent
- [x] **L1-15** Facettes par agrégation SQL : catégorie, prix, ville, matière, disponibilité
- [x] **L1-16** Tri : pertinence, prix, nouveauté, note

### Exposition publique

- [x] **L1-17** `GET /catalog/categories`
- [x] **L1-18** `GET /catalog/products` avec filtres, facettes et curseur
- [x] **L1-19** `GET /catalog/products/{slug}`
- [x] **L1-20** `GET /catalog/search`
- [x] **L1-21** `GET /makers/{slug}` — vitrine publique de l'atelier
- [ ] **L1-22** Cache Redis du catalogue + invalidation à la publication — **aucun cache aujourd'hui**, le catalogue frappe la base à chaque appel
- [x] **L1-23** `GET /geo/countries`, `GET /geo/cities`

### KYC fabricant

- [x] **L1-24** Dépôt des pièces (CNI, RCCM, IFU), espace privé sans URL stable, statuts suivis
- [x] **L1-25** Revue admin : approbation, rejet motivé, suspension

**Sortie de lot** — Un fabricant vérifié publie une pièce qui apparaît dans la
recherche et dans les facettes, en moins de 200 ms au 95ᵉ centile.

---

## L2 — Commande · 3 semaines · 20 tâches

**Objectif** — Un panier devient une commande chiffrée, éclatée par atelier, prête à payer.

### Panier

- [x] **L2-01** Panier serveur, anonyme par jeton de cookie
- [x] **L2-02** Fusion du panier anonyme dans le panier utilisateur à la connexion
- [x] **L2-03** Expiration et purge des paniers dormants
- [x] **L2-04** Carnet d'adresses client, adresse par défaut, repère et point GPS

### Chiffrage — cahier § 6

- [x] **L2-05** `POST /checkout/quote` : total, frais, TVA, délais, **sans engagement**
- [x] **L2-06** Frais de livraison par zone, avec **poids volumétrique** (L×l×h ÷ 5 000) quand il dépasse le poids réel
- [x] **L2-07** Franchise de livraison au-delà de `freeAboveXof`
- [x] **L2-08** TVA selon le **pays de livraison**, jamais codée en dur (dépend de `P-11`)
- [x] **L2-09** Commission par sous-commande, taux **figé au moment de la commande** (dépend de `P-03`)
- [x] **L2-10** Arrondis en points de base sur entiers, à l'inférieur, l'écart tombant du côté d'Ojà — **aucun franc ne se crée ni ne disparaît**
- [x] **L2-11** Codes promo — remise portée par la commission Ojà et plafonnée à elle ; CRUD back-office

### Création

- [x] **L2-12** `POST /checkout` : création de la commande, **éclatement en `SubOrder` par atelier**
- [x] **L2-13** Copie figée : nom du produit, prix unitaire, adresse, taux de commission (§ 4.3)
- [x] **L2-14** Réservation de stock **dès la création**, avant tout paiement (§ 7.4)
- [x] **L2-15** Références `CMD-2026-000123` et `CMD-2026-000123-A`, séquentielles et sans trou

### États

- [x] **L2-16** Machine à états `Order` du § 5.1, transitions gardées, `UPDATE` direct interdit
- [x] **L2-17** Machine à états `SubOrder` du § 5.2
- [x] **L2-18** **Règle des 48 h** : relance du fabricant, puis refus automatique au silence
- [x] **L2-19** Annulation et remboursement au prorata quand un atelier refuse
- [x] **L2-20** Facture PDF numérotée, archivée, immuable, mention du pays de livraison — émise à l’encaissement, URL pré-signée

**Sortie de lot** — Une commande à trois ateliers se crée, se chiffre au franc
près et s'éclate correctement. Le stock est réservé. Aucune transition
interdite n'est possible.

---

## L3 — Paiement et grand livre · 4 semaines · 26 tâches

**Chemin critique du projet.** Rien n'est réellement testable avant que
l'argent circule de bout en bout en sandbox. Dépend de `P-01`.

### Client Kadev Pay — cahier § 7.1

- [x] **L3-01** Client HTTP : clé secrète en `Authorization: Bearer`, délai d'attente (10 s), pas de réessai automatique — non testé contre un vrai comptes, disjoncteur
- [x] **L3-02** `POST /checkout` renvoie une configuration de widget (`publicKey`, `amount`, `reference`) — **jamais le montant venu du navigateur** (§ 7.4)
- [x] **L3-03** `metadata` porte `order_id` — leur doc ne montre aucun exemple rempli, à confirmer au premier essai réel
- [x] **L3-04** `GET /transactions/verify/{ref}` encapsulé et typé
- [x] **L3-05** Séparation stricte des modes `test` / `live` — refus de démarrer au démenti (env.ts)

### Webhook — cahier § 7.5

- [x] **L3-06** Route `POST /webhooks/kadevpay` avec `rawBody: true`, posé une fois pour toutes dans `main.ts`obal
- [x] **L3-07** HMAC **SHA-512 sur le corps brut** — surtout pas sur `JSON.stringify(req.body)`, l'erreur de leur propre exemple PHP, l'exemple de leur doc est faux
- [x] **L3-08** Comparaison à **temps constant** (`timingSafeEqual`), y compris sur deux longueurs différentes
- [x] **L3-09** Journalisation des webhooks **invalides** : c'est un signal d'attaque, pas un déchetéchet
- [x] **L3-10** Réponse `200` immédiate, traitement synchrone (BullMQ non nécessaire à ce volume — voir L0-33)
- [x] **L3-11** Idempotence : clé unique `PaymentEvent` (contrainte PostgreSQL, pas de verrou Redis nécessaire)
- [x] **L3-12** Traitement synchrone du webhook, contrôles et écritures comptables en une transaction
- [x] **L3-13** **Contrôles de cohérence** : devise, montant — déjà en place avant ce lot, réutilisés tels quelst.amountXof`. Toute divergence ⇒ pas d'encaissement + alerte administrateur

### Cycle de vie

- [x] **L3-14** Expiration à 30 min : **dernière vérification auprès du fournisseur**, puis `EXPIRED` + relâche du stock
- [x] **L3-15** Confirmation de la réservation de stock à l'encaissement
- [x] **L3-16** Vérification active à l'ouverture de `/confirmation`
- [x] **L3-17** Balayage des `PENDING` toutes les 5 min (ordonnanceur, déjà en place)
- [ ] **L3-18** **Rapprochement quotidien à 03 h** + alerte de niveau critique sur tout écart (§ 7.6)

### Grand livre — cahier § 8

- [x] **L3-19** Comptes du grand livre, création à la volée par bénéficiaire
- [x] **L3-20** Service d'écriture en **partie double**, refusant toute transaction dont la somme ≠ 0
- [x] **L3-21** Écriture `order_paid` : encaissement, dettes ateliers, provision livreur, revenu Ojà
- [x] **L3-22** Écriture `psp_fee` : les frais agrégateur imputés à Ojà (§ 6.2)
- [x] **L3-23** Vérification nocturne des invariants **I1 → I4**, alerte critique en cas d'écart
- [x] **L3-24** Remboursements par **contre-passation**, jamais par modification (§ 8.5)
- [x] **L3-25** `POST /admin/payments/{id}/refund`, total et partiel

### Tests

- [ ] **L3-26** **Simulateur Kadev Pay** rejouant les payloads réels : webhook en double, signature invalide, montant divergent, arrivée hors ordre, webhook perdu

**Sortie de lot** — Un paiement sandbox aboutit, le webhook rejoué 100 fois ne
crée qu'une écriture, un montant divergent est refusé, et les invariants du
grand livre tiennent sur 10 000 commandes simulées.

---

## L4 — Logistique · 4 semaines · 22 tâches

Dépend de `P-04` et `P-05`.

### Zones et tarifs

- [x] **L4-01** Administration des pays, villes, zones et grilles tarifaires
- [ ] **L4-02** Majoration au poids et au volume au-delà d'un seuil
- [x] **L4-03** Estimation de délai par zone affichée au chiffrage

### Missions

- [x] **L4-04** Création du `Shipment` au passage de la `SubOrder` en `READY`
- [x] **L4-05** Diffusion aux livreurs de la zone, disponibles et non saturés
- [x] **L4-06** ~~Modèle premier arrivé~~ — remplacé par l'affectation administrateur (cahier client) : offre à 15 min, puis élargissement du pool
- [x] **L4-07** Acceptation / refus, plafond de missions simultanées
- [ ] **L4-08** Relance administrateur si personne n'accepte
- [x] **L4-09** Machine à états d'expédition + journal `ShipmentEvent` horodaté

### Preuve de livraison — le verrou du circuit financier

- [x] **L4-10** OTP à 4 chiffres envoyé au client, saisi par le livreur
- [x] **L4-11** Photo du colis remis, horodatée, stockée en S3
- [x] **L4-12** Position GPS à la validation, comparée à l'adresse
- [x] **L4-13** **Règle des deux preuves sur trois** ; sans elle, `DELIVERED` est refusé
- [x] **L4-14** Job `DELIVERED → COMPLETED` **à 72 h** sans litige (et non J+7, voir SPEC-ALIGNEMENT § 9-A) — **c'est la transition qui libère l'argent** (dépend de `P-05`)

### Suivi et livreurs

- [x] **L4-15** Position poussée pendant `IN_DELIVERY` (app livreur toutes les 30 s), écriture throttlée + bus d’événements
- [x] **L4-16** `GET /shipments/{reference}/stream` en **SSE** (+ `GET .../track` pour l’instantané et le repli)
- [x] **L4-17** Disponibilité du livreur, zones couvertes
- [x] **L4-18** KYC livreur : identité, permis, carte grise, véhicule et plaque
- [x] **L4-19** `GET /courier/earnings` — gains et courses à venir
- [x] **L4-20** Échec de livraison, nouvelle tentative, retour à l'atelier

### Confidentialité — obligation du § 15.3

- [x] **L4-21** Le téléphone du client n'est **jamais** exposé au fabricant
- [x] **L4-22** Il n'est visible que du livreur affecté, et **uniquement pendant sa mission** — testé sur toutes les routes

**Sortie de lot** — Une commande payée traverse `READY → PICKED_UP → DELIVERED`
avec preuve valide, et bascule seule en `COMPLETED` sept jours plus tard.

---

## L5 — Versements · 2 semaines · 12 tâches

Arbitrage à faire selon la réponse à `P-02`. Ce qui suit décrit la v1 sans
API de virement.

- [ ] **L5-01** Constitution hebdomadaire des lots (lundi 08 h), seuil de 5 000 F CFA, report en dessous
- [ ] **L5-02** Écran de revue du lot : bénéficiaires, numéros Mobile Money, montants, commandes rattachées
- [ ] **L5-03** **Double validation** : le créateur du lot ne peut pas l'approuver — impossible à contourner, et testé
- [ ] **L5-04** Export CSV au format de chaque opérateur
- [ ] **L5-05** Import du fichier de retour, rapprochement ligne à ligne
- [ ] **L5-06** Statuts `PAID` avec référence externe, `FAILED` avec motif
- [ ] **L5-07** Écriture `payout_paid` au grand livre, à l'exécution et non à la programmation
- [ ] **L5-08** Notification SMS au bénéficiaire
- [x] **L5-09** `GET /maker/payouts` et `GET /courier/earnings` — solde à venir et historique
- [ ] **L5-10** Reprise sur échec : le montant retourne en `READY` pour le lot suivant
- [ ] **L5-11** Créance négative après remboursement d'un fabricant déjà payé, compensée sur les versements suivants
- [ ] **L5-12** **Cible v2** — brancher une API de virement en masse (Wave Business, Orange Money B2C, ou le *split* de Kadev Pay) : seul l'exécuteur change, le modèle est déjà dimensionné

**Sortie de lot** — Un lot se constitue, s'approuve à deux personnes, s'exporte,
se réimporte et solde exactement les comptes `MAKER_PAYABLE` concernés.

---

## L6 — Service client · 3 semaines · 14 tâches

Dépend de `P-06`.

- [x] **L6-01** Ouverture de litige par le client, motifs typés, SLA calculé
- [x] **L6-02** Machine à états du litige (§ 4.2, `DisputeStatus`)
- [x] **L6-03** Fil de discussion avec pièces jointes
- [x] **L6-04** **Notes internes** invisibles des parties
- [x] **L6-05** Un litige ouvert **suspend** le passage en `COMPLETED` — donc le versement
- [x] **L6-06** Arbitrage admin : remboursement total, partiel, réexpédition, rejet
- [x] **L6-07** Branchement sur les remboursements de L3-24
- [ ] **L6-08** Règle de prise en charge de la casse en transit (dépend de `P-06`)
- [x] **L6-09** Retours produit et délai de rétractation
- [x] **L6-10** Alertes de dépassement de SLA
- [ ] **L6-11** Avis : **un avis exige une `OrderLine` réellement achetée**
- [ ] **L6-12** Modération des avis, recalcul des notes moyennes produit et atelier
- [ ] **L6-13** Formulaire de contact raccordé — ⚠️ **il affiche aujourd'hui « message envoyé » sans rien envoyer**
- [x] **L6-14** Toutes les demandes transitent par le Support, coordonnées masquées (§ 15.3)

---

## L7 — Back-office · 3 semaines · 16 tâches

- [x] **L7-01** Tableau de bord admin : les cinq files qui bloquent quelqu'un
- [x] **L7-02** Fabricants : liste, fiche, approbation, rejet (suspension : reste à faire)
- [x] **L7-03** Livreurs : liste, fiche, pièces, approbation, rejet
- [x] **L7-04** Revue des pièces KYC avec accès S3 pré-signé
- [x] **L7-05** Modération du catalogue
- [x] **L7-06** Commandes : recherche par référence, nom ou téléphone (annulation : reste à faire)
- [ ] **L7-07** Paiements : recherche, détail, remboursement
- [x] **L7-08** **Consultation du grand livre**, soldes, écritures et contrôle des invariants, en lecture seule
- [ ] **L7-09** Lots de versement : constitution, approbation, import de retour
- [x] **L7-10** Litiges : file, arbitrage à trois décisions distinctes, dépassement de délai signalé
- [x] **L7-11** Journal d'audit consultable et filtrable
- [ ] **L7-12** Rapport de rapprochement quotidien consultable
- [ ] **L7-13** Envoi d'e-mails aux utilisateurs et aux marchands
- [x] **L7-14** Paramétrage consultable : pays, grilles de livraison, moyens de paiement
- [x] **L7-15** **Ouverture d'un pays** : un interrupteur dans le back-office, aucun déploiement (§ 13)
- [ ] **L7-16** Gestion des comptes admin et de leur MFA

---

## LN — Notifications · transverse · 10 tâches

À répartir sur L2 → L6, pas à traiter en bloc.

- [x] **LN-01** Table `Notification` + `templateVersion` ; registre de gabarits versionnés (`notifications/templates.ts`)
- [x] **LN-02** Worker e-mail (Resend)
- [ ] **LN-03** Worker SMS — **canal prioritaire pour tout le transactionnel** (§ 12)
- [x] **LN-04** Notifications in-app : `GET /notifications`, `unread-count`, `POST /read` + cloche et page dédiée au front
- [x] **LN-05** Commande payée → avis au créateur, avec son délai de 48 h
- [x] **LN-06** Relance des 48 h → fabricant (cron horaire, `reminderSentAt` pour l’idempotence)
- [x] **LN-07** Prête à enlever → client (e-mail + in-app) ; offre de course aux livreurs de la zone (in-app)
- [x] **LN-08** Livrée → avis au client, avec le délai de 72 h avant validation automatique
- [x] **LN-09** Versement → fabricant / livreur : avis à la libération des fonds ; le point d’accroche « virement effectué » attend L5
- [x] **LN-10** Litige ouvert → alerte à tous les administrateurs ; `criticalAdminAlert` générique en place pour l’écart de rapprochement (L3-18)

---

## L8 — Durcissement · 2 semaines · 12 tâches

- [ ] **L8-01** Charge k6 sur le catalogue et le checkout
- [ ] **L8-02** Bout en bout Playwright du parcours complet en sandbox
- [ ] **L8-03** Audit de sécurité externe
- [ ] **L8-04** `npm audit` et Dependabot bloquants en CI
- [ ] **L8-05** PITR Postgres + dump quotidien chiffré
- [ ] **L8-06** **Restauration de sauvegarde réellement effectuée et chronométrée**
- [ ] **L8-07** Alertes : échec de paiement > 5 %, webhooks non traités > 10, écart ≠ 0, file > 1 000, p95 > 800 ms
- [ ] **L8-08** Runbooks : webhook en panne, écart de rapprochement, versement échoué
- [ ] **L8-09** Politique de conservation : 10 ans comptable, 12 mois technique, 5 ans KYC
- [ ] **L8-10** Anonymisation sur demande d'effacement, sans détruire les pièces comptables
- [ ] **L8-11** Documentation d'exploitation et d'intégration
- [ ] **L8-12** **Passer la checklist complète de l'annexe B du cahier des charges**

---

## Front — hors des 28 semaines backend

Le lotissement du cahier (§ 18) chiffre **le backend seul**. Trois des quatre
profils n'ont aujourd'hui aucune interface. Sans ces quatre lots, il y a une
API complète et personne pour s'en servir.

### F1 — Raccordement du front existant · 3 semaines

- [x] **F1-01** Catalogue servi par l'API, ISR 60 s, remplacement de `src/lib/products.ts`
- [x] **F1-02** Panier serveur, `localStorage` réduit au secours hors ligne, fusion à la connexion
- [x] **F1-03** Formulaires raccordés à l'API, erreurs remontées champ par champ
- [x] **F1-04** Redirection selon le rôle à la connexion, et accès à son espace depuis l'en-tête
- [x] **F1-05** Inscription avec **choix du rôle** puis parcours KYC dédié
- [x] **F1-06** Checkout branché sur le widget Kadev Pay, page de confirmation lisant le **statut réel** et non l'URL
- [x] **F1-07** Suivi de commande et de livraison en SSE (composant `DeliveryTracker`, repli par relecture toutes les 15 s)
- [x] **F1-08** Remplacer les trois chiffres d'exemple de la Home par des données réelles
- [x] **F1-09** Écrire les pages légales encore en `#` dans le footer

### F1bis — Espace client · ajouté en cours de route

Absent du lotissement d'origine : le cahier ne le mentionnait pas, mais **le
clic de validation du client décide du sort de l'argent**. Sans écran, chaque
commande attendait la validation automatique de 72 h.

- [x] **F1b-01** Mes commandes, avec les colis en attente de confirmation en tête
- [x] **F1b-02** Détail d'une commande, validation ou signalement **par colis**
- [x] **F1b-03** Mes réclamations et leur fil de discussion avec Ojà
- [x] **F1b-04** Carnet d'adresses
- [x] **F1b-05** Profil et changement de mot de passe

### F2 — Espace fabricant · 4 semaines

- [x] **F2-01** Conception des écrans (amorce Figma `108:2532`, `108:2793`)
- [x] **F2-02** Tableau de bord : ventes, commandes en attente, solde à venir
- [x] **F2-03** Gestion des produits et photos (pas de variantes : hors Phase 1)
- [x] **F2-04** Stocks
- [x] **F2-05** Sous-commandes : accepter, refuser, marquer prête
- [x] **F2-06** Versements et historique
- [x] **F2-07** Parcours KYC et suivi du dossier

### F3 — Application livreur · 4 semaines

- [x] **F3-01** Conception mobile d'abord : barre d'onglets basse, cibles de 44 px (PWA : reste à faire)
- [x] **F3-02** Missions affectées, triées par ce qui est déjà en main
- [x] **F3-03** Itinéraire `geo:` vers l'atelier puis le client, appel direct du destinataire
- [x] **F3-04** Enlèvement, départ en livraison avec position
- [x] **F3-05** Preuve de livraison : OTP, photo, GPS — décompte en direct des 2 éléments sur 3
- [x] **F3-06** Gains, avec la mention explicite que le barème n'est pas arrêté
- [ ] **F3-07** Mode dégradé hors ligne — la couverture réseau n'est pas acquise

### F4 — Back-office admin · 4 semaines

- [x] **F4-01** Conception (amorce Figma `161:3414`)
- [x] **F4-02** Interfaces des tâches L7-01 → L7-16 — reste : annulation de commande, lots de versement, MFA admin

---

## Chemin critique

```
P-01 ──► L0 ──► L1 ──► L2 ──► L3 ──► L4 ──► L5
                                │       │
P-11 ───────────────► L2-08     │       └──► L6 ──► L7 ──► L8
P-03 ───────────────► L2-09     │
P-04 ────────────────────────► L4
P-05 ──────────────────────► L4-14
P-06 ──────────────────────────────────────► L6
P-02 ──────────────────────────────► arbitrage L5
```

**Mise en service minimale** — `P-01` → L0 → L4, versements faits à la main
hors système, une seule ville, une vingtaine d'ateliers. **Environ 18 semaines**,
et cela vaut mieux qu'un système complet livré d'un bloc.

**Solution complète** — les neuf lots backend plus les quatre lots front :
**environ 28 semaines de backend et 15 semaines de front**, largement
parallélisables une fois L1 et L2 livrés.

---

## Les cinq erreurs qui coûtent le plus cher

Rassemblées ici parce que chacune se paie en réécriture, pas en correctif.

1. **Coder avant `P-02`.** Si Kadev Pay ouvre le *split*, la moitié de L5 n'a pas lieu d'être. Une lettre vaut deux semaines de développement.
2. **Vérifier la signature du webhook sur `JSON.stringify(req.body)`.** C'est ce que montre leur documentation, et c'est faux. Corps brut, toujours (`L3-07`).
3. **Faire confiance à la redirection de paiement.** `callback_url` est un confort d'affichage. Seul le webhook vérifié fait foi (`L3-13`).
4. **Remplacer le grand livre par une colonne `solde`.** Ça tient jusqu'au premier remboursement partiel sur une commande à trois ateliers, puis plus personne ne sait pourquoi un solde vaut ce qu'il vaut.
5. **Traiter la preuve de livraison comme un détail logistique.** C'est le verrou qui déclenche les versements. Sans elle, on paie des ateliers pour des colis jamais remis (`L4-13`).

---

*Backlog versionné avec le code. Toute tâche ajoutée reçoit un identifiant dans
sa série ; les identifiants ne sont jamais réattribués.*
