# Ojà — Cahier des charges backend

**Version 1.0 — 12 août 2026**
Place de marché du mobilier et de la décoration d'intérieur façonnés localement.
Zone : UEMOA (lancement Côte d'Ivoire, modèle de données multi-pays dès le départ).

Ce document décrit ce qu'il faut construire côté serveur, dans quel ordre, et
pourquoi. Il est écrit pour être exécutable : chaque décision est tranchée, les
points encore ouverts sont regroupés en fin de document au § 19.

> ⚠️ **Ce document a été rédigé avant réception du cahier des charges client
> (*OJÀ — Phase 1 : Makers Place*).** Sur plusieurs points structurants — sens
> de la commission, déclenchement du versement, calcul de la livraison,
> affectation des livreurs, variantes produit, retours — c'est
> [`SPEC-ALIGNEMENT.md`](SPEC-ALIGNEMENT.md) qui fait foi. Lisez-le d'abord.
> Le présent document reste valable partout où l'alignement est muet.

---

## 1. Contexte et périmètre

### 1.1 Ce qui existe

Un front Next.js 15 (App Router, TypeScript, CSS Modules) couvrant 11 écrans :
accueil, catalogue, fiche produit, recherche, panier, checkout, confirmation,
connexion, inscription, contact. **Aucun backend** : le catalogue est un module
TypeScript statique (`src/lib/products.ts`), le panier vit dans un React Context
adossé à `localStorage`, les formulaires n'envoient rien.

### 1.2 Ce que le backend doit apporter

Transformer cette vitrine en place de marché réellement transactionnelle :
comptes et rôles, catalogue administrable par les artisans eux-mêmes, commandes,
encaissement Mobile Money, répartition de l'argent entre Ojà / fabricants /
livreurs, logistique de livraison, service client et back-office.

### 1.3 Le modèle économique, en une phrase

Le client paie Ojà. Ojà retient une commission, puis reverse au fabricant sa
part et au livreur sa course, après confirmation de livraison. Toute
l'architecture financière décrite au § 8 découle de cette phrase.

### 1.4 Hors périmètre v1

Application mobile native, click & collect, enchères, personnalisation sur
mesure avec devis, marketplace B2B, programme de fidélité, marketplace
publicitaire interne.

---

## 2. Les quatre profils

Un utilisateur = un compte, un rôle principal. Rien n'interdit à un fabricant
d'acheter : il a alors les droits `CUSTOMER` en plus des siens.

| Rôle | Qui | Ce qu'il fait |
|---|---|---|
| `CUSTOMER` | Le client | Parcourt, commande, paie, suit sa livraison, note, ouvre un litige |
| `MAKER` | Le fabricant / l'atelier | Gère sa boutique, ses produits, ses stocks, accepte et prépare les commandes, suit ses versements |
| `COURIER` | Le livreur | Reçoit des missions sur sa zone, récupère à l'atelier, livre, dépose la preuve de livraison |
| `ADMIN` | L'équipe Ojà | Vérifie les ateliers et les livreurs, modère le catalogue, arbitre les litiges, déclenche et contrôle les versements |

### 2.1 Matrice de droits (extrait dirigeant)

| Ressource | CUSTOMER | MAKER | COURIER | ADMIN |
|---|---|---|---|---|
| `product` | lecture (publiés) | CRUD **sur ses propres produits** | — | lecture + suspension |
| `order` | lecture **sur ses commandes** | lecture **sur ses lignes** | lecture **sur ses missions** | tout |
| `payment` | lecture **sur ses paiements** | — | — | tout |
| `payout` | — | lecture **sur les siens** | lecture **sur les siens** | tout + validation |
| `ledger_entry` | — | — | — | lecture seule (immuable) |
| `dispute` | ouvrir / répondre | répondre | répondre | arbitrer |
| `user` | son profil | son profil | son profil | tout + suspension |

**Règle d'or** : l'autorisation n'est jamais seulement « ce rôle a le droit »,
c'est toujours « ce rôle a le droit **sur cette ressource-là** ». Un `MAKER` qui
demande `GET /orders/{id}` d'une commande qui ne le concerne pas reçoit un `404`,
pas un `403` — un `403` confirmerait l'existence de la ressource.

### 2.2 Cycle de vie d'un compte

```
inscription → email/téléphone vérifié → (MAKER/COURIER) dossier KYC déposé
   → revue ADMIN → ACTIVE | REJECTED | SUSPENDED
```

Un `MAKER` peut créer ses fiches produit dès l'inscription mais **rien n'est
publié** tant que son dossier n'est pas validé. Un `COURIER` ne reçoit aucune
mission tant qu'il n'est pas validé.

---

## 3. Architecture retenue

### 3.1 La stack

| Couche | Choix | Pourquoi |
|---|---|---|
| Runtime | **Node 22 LTS + TypeScript strict** | Même langage que le front : types de la commande partagés bout en bout, une seule équipe |
| Framework | **NestJS 11** | Modules, injection de dépendances, guards/interceptors natifs — le RBAC ressource-par-ressource du § 2.1 s'y exprime proprement |
| Base | **PostgreSQL 16** | Transactions ACID sérialisables : non négociable pour un grand livre financier. `jsonb` pour les payloads webhook, `tsvector` pour la recherche |
| ORM | **Prisma 6** | Schéma unique, migrations versionnées, client typé. Types dérivés partagés avec le front |
| File d'attente | **BullMQ + Redis 7** | Webhooks, notifications, réconciliation, relances : tout ce qui ne doit pas bloquer une requête HTTP |
| Cache / verrous | **Redis** | Cache catalogue, rate limiting, verrous distribués sur les webhooks |
| Fichiers | **S3-compatible** (Scaleway, MinIO en local) | Photos produits, pièces KYC, preuves de livraison |
| Mail | **Resend** ou SMTP | Transactionnel |
| SMS / WhatsApp | Agrégateur local (**Orange / LeTexto / Twilio**) | Le SMS reste le canal fiable en zone UEMOA |
| Recherche | **Postgres FTS** en v1 | Meilisearch seulement quand le catalogue dépasse ~50 000 fiches. Pas d'infrastructure prématurée |
| Observabilité | **OpenTelemetry → Grafana / Loki**, **Sentry** | |
| Conteneurs | **Docker + Docker Compose**, cible Kubernetes ou Scaleway Serverless | |

### 3.2 La forme : monolithe modulaire, pas microservices

**Un seul déploiement applicatif**, découpé en modules NestJS aux frontières
nettes. Les microservices sont écartés délibérément : à ce stade ils
ajouteraient de la latence réseau, des transactions distribuées et une
complexité opérationnelle pour une équipe qui n'a pas encore de trafic.

Le découpage est fait pour qu'un module puisse être extrait plus tard sans
réécriture : les modules ne s'appellent **jamais** par leurs repositories, ils
passent par les services publics exposés ou par des événements.

```
apps/
  api/          Application NestJS (HTTP)
  worker/       Consommateurs BullMQ — même code, autre point d'entrée
packages/
  db/           Schéma Prisma + migrations + client généré
  contracts/    DTO + schémas Zod partagés API ⇄ front
  domain/       Machines à états, calculs de prix, règles de commission
```

Modules métier :

```
auth          identités, sessions, MFA, réinitialisation
users         profils, KYC, vérification
catalog       catégories, produits, variantes, médias, stock
search        indexation et requêtes catalogue
cart          paniers persistés
checkout      devis de commande, frais, taxes, création de commande
orders        commandes, lignes, sous-commandes, machine à états
payments      Kadev Pay, webhooks, réconciliation      ← § 7
ledger        grand livre en partie double               ← § 8
payouts       reversements fabricants et livreurs        ← § 8.4
logistics     zones, tarifs, expéditions, missions       ← § 9
disputes      litiges, retours, remboursements
reviews       avis et notes
messaging     support, fils de discussion
notifications e-mail / SMS / push
admin         back-office, modération, audit
```

### 3.3 Pourquoi pas simplement les API Routes de Next.js

C'était l'option la plus rapide, et elle a été écartée pour trois raisons
concrètes :

1. **Les webhooks de paiement** doivent être traités avec un corps de requête
   **brut** (vérification HMAC, cf. § 7.5) et une idempotence stricte. Le
   pipeline de Next.js parse le corps avant qu'on y touche ; on se bat contre
   le framework.
2. **Les traitements différés** (relances, réconciliation quotidienne, lots de
   versement) réclament un vrai worker. Les fonctions serverless meurent à la
   fin de la requête.
3. **Le grand livre** exige des transactions Postgres longues et des niveaux
   d'isolation choisis. On veut un processus qui tient une connexion, pas un
   pool serverless qui se réinvente à chaque appel.

Le front Next.js reste tel quel et devient un pur consommateur de l'API.

### 3.4 Vue de déploiement

```
                  ┌──────────────┐
   Navigateur ───►│  Next.js 15  │  SSR + pages statiques
                  └──────┬───────┘
                         │ HTTPS, JWT en cookie httpOnly
                  ┌──────▼───────┐        ┌──────────────┐
                  │  API NestJS  │◄──────►│ PostgreSQL 16│
                  └──┬────────┬──┘        └──────────────┘
                     │        │            ┌──────────────┐
                     │        └───────────►│    Redis     │
                     │                     └──────┬───────┘
                     │                            │
            ┌────────▼────────┐          ┌────────▼────────┐
            │   Kadev Pay     │          │  Worker BullMQ  │
            │  pay.kadev.ci   │─webhook─►│                 │
            └─────────────────┘          └─────────────────┘
```

---

## 4. Modèle de données

Schéma Prisma, volontairement complet sur les parties sensibles (argent,
commandes, livraison) et resserré ailleurs.

### 4.1 Conventions

- **Identifiants** : `cuid()` en clé primaire. Jamais d'entier auto-incrémenté
  exposé (il fuite le volume d'affaires).
- **Montants** : **entiers, en franc CFA**. Le XOF n'a pas de sous-unité
  d'usage — aucune décimale, donc aucun flottant, jamais. Le champ s'appelle
  toujours `...Xof`.
- **Dates** : `DateTime` en UTC, converties à l'affichage.
- **Suppression** : logique (`deletedAt`) partout où une trace comptable ou
  légale doit survivre.
- **Audit** : `createdAt` / `updatedAt` systématiques ; `AuditLog` pour toute
  action d'administration.

### 4.2 Schéma

```prisma
// ─────────────────────────── Géographie (multi-pays UEMOA)

model Country {
  id            String   @id @default(cuid())
  iso2          String   @unique          // CI, BJ, SN, TG, BF, ML, NE, GW
  name          String
  currency      String   @default("XOF")
  vatRate       Int                       // en points de base : 1800 = 18 %
  callingCode   String                    // +225
  isActive      Boolean  @default(false)  // ouverture pays par pays
  cities        City[]
  zones         DeliveryZone[]
  paymentMethods PaymentMethodConfig[]
}

model City {
  id        String  @id @default(cuid())
  countryId String
  country   Country @relation(fields: [countryId], references: [id])
  name      String
  zoneId    String?
  zone      DeliveryZone? @relation(fields: [zoneId], references: [id])
  @@unique([countryId, name])
}

model DeliveryZone {
  id          String   @id @default(cuid())
  countryId   String
  country     Country  @relation(fields: [countryId], references: [id])
  name        String                       // « Abidjan intra-muros »
  baseFeeXof  Int
  perKmFeeXof Int      @default(0)
  freeAboveXof Int?                        // livraison offerte au-delà
  etaMinDays  Int
  etaMaxDays  Int
  cities      City[]
  isActive    Boolean  @default(true)
}

// ─────────────────────────── Identité

enum UserRole   { CUSTOMER MAKER COURIER ADMIN }
enum UserStatus { PENDING ACTIVE SUSPENDED REJECTED }

model User {
  id             String     @id @default(cuid())
  role           UserRole
  status         UserStatus @default(PENDING)
  email          String     @unique
  emailVerifiedAt DateTime?
  phone          String     @unique        // E.164, +225…
  phoneVerifiedAt DateTime?
  passwordHash   String                    // argon2id
  firstName      String
  lastName       String
  locale         String     @default("fr")
  countryId      String
  mfaSecret      String?                   // TOTP, obligatoire pour ADMIN
  lastLoginAt    DateTime?
  deletedAt      DateTime?
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt

  maker      MakerProfile?
  courier    CourierProfile?
  addresses  Address[]
  orders     Order[]
  sessions   Session[]
  @@index([role, status])
}

model Session {
  id           String   @id @default(cuid())
  userId       String
  user         User     @relation(fields: [userId], references: [id])
  refreshHash  String                       // le jeton n'est jamais stocké en clair
  userAgent    String?
  ip           String?
  expiresAt    DateTime
  revokedAt    DateTime?
  createdAt    DateTime @default(now())
}

model Address {
  id         String  @id @default(cuid())
  userId     String
  user       User    @relation(fields: [userId], references: [id])
  label      String?                       // « Domicile »
  fullName   String
  phone      String
  cityId     String
  line1      String
  landmark   String?                       // « en face de la pharmacie »
  // L'adressage postal est peu fiable dans la zone : le point GPS
  // et le repère sont ce dont le livreur se sert réellement.
  latitude   Float?
  longitude  Float?
  isDefault  Boolean @default(false)
  deletedAt  DateTime?
}

// ─────────────────────────── Fabricant

enum KycStatus { NOT_SUBMITTED PENDING APPROVED REJECTED }

model MakerProfile {
  id              String    @id @default(cuid())
  userId          String    @unique
  user            User      @relation(fields: [userId], references: [id])
  shopName        String
  slug            String    @unique
  bio             String?
  logoUrl         String?
  coverUrl        String?
  cityId          String
  craft           String                     // menuiserie, tissage, poterie…
  yearsActive     Int?

  kycStatus       KycStatus @default(NOT_SUBMITTED)
  kycReviewedAt   DateTime?
  kycReviewerId   String?
  kycRejectReason String?
  legalName       String?                    // raison sociale
  registrationNo  String?                    // RCCM
  taxId           String?                    // DFE / NIF

  // Compte de réception des versements
  payoutMethod    PayoutMethod @default(MOBILE_MONEY)
  payoutMsisdn    String?                    // numéro Mobile Money
  payoutOperator  String?                    // wave, orange, mtn, moov
  payoutBankIban  String?

  commissionBps   Int       @default(1000)   // 10 % — surchargeable par atelier
  leadTimeDays    Int       @default(7)      // délai de fabrication annoncé
  isFeatured      Boolean   @default(false)
  ratingAvg       Float     @default(0)
  ratingCount     Int       @default(0)

  products        Product[]
  documents       KycDocument[]
  @@index([kycStatus])
}

model KycDocument {
  id        String   @id @default(cuid())
  makerId   String?
  courierId String?
  type      String                          // cni_recto, rccm, permis…
  fileKey   String                          // clé S3, jamais une URL publique
  status    KycStatus @default(PENDING)
  note      String?
  createdAt DateTime @default(now())
}

// ─────────────────────────── Livreur

enum VehicleType { MOTO TRICYCLE VAN TRUCK }

model CourierProfile {
  id             String      @id @default(cuid())
  userId         String      @unique
  user           User        @relation(fields: [userId], references: [id])
  vehicle        VehicleType
  plateNumber    String?
  maxLoadKg      Int?
  kycStatus      KycStatus   @default(NOT_SUBMITTED)
  payoutMsisdn   String?
  payoutOperator String?
  isAvailable    Boolean     @default(false)
  ratingAvg      Float       @default(0)
  zones          DeliveryZone[]             // zones couvertes
  assignments    DeliveryAssignment[]
}

// ─────────────────────────── Catalogue

model Category {
  id       String     @id @default(cuid())
  slug     String     @unique
  name     String
  parentId String?
  parent   Category?  @relation("Tree", fields: [parentId], references: [id])
  children Category[] @relation("Tree")
  position Int        @default(0)
  products Product[]
}

enum ProductStatus { DRAFT PENDING_REVIEW PUBLISHED REJECTED ARCHIVED }

model Product {
  id           String        @id @default(cuid())
  slug         String        @unique
  makerId      String
  maker        MakerProfile  @relation(fields: [makerId], references: [id])
  categoryId   String
  category     Category      @relation(fields: [categoryId], references: [id])
  name         String
  description  String
  material     String
  status       ProductStatus @default(DRAFT)
  reviewedAt   DateTime?
  reviewerId   String?
  rejectReason String?

  priceXof     Int                          // prix de référence
  oldPriceXof  Int?                         // prix barré
  weightGrams  Int?                         // pour le calcul de livraison
  lengthMm     Int?
  widthMm      Int?
  heightMm     Int?
  isMadeToOrder Boolean      @default(false) // fabriqué à la commande
  leadTimeDays Int?                          // surcharge le délai de l'atelier

  ratingAvg    Float         @default(0)
  ratingCount  Int           @default(0)
  searchVector Unsupported("tsvector")?

  variants     ProductVariant[]
  images       ProductImage[]
  deletedAt    DateTime?
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt
  @@index([status, categoryId])
  @@index([makerId, status])
}

model ProductVariant {
  id             String  @id @default(cuid())
  productId      String
  product        Product @relation(fields: [productId], references: [id])
  sku            String  @unique
  name           String                      // « Teck / 90 cm »
  priceXof       Int
  stockOnHand    Int     @default(0)
  stockReserved  Int     @default(0)         // réservé par des paniers/commandes
  isActive       Boolean @default(true)
  // Le stock disponible est toujours stockOnHand - stockReserved,
  // jamais une colonne dénormalisée : deux sources de vérité divergent.
}

model ProductImage {
  id        String  @id @default(cuid())
  productId String
  product   Product @relation(fields: [productId], references: [id])
  fileKey   String
  alt       String?
  position  Int     @default(0)
}

// ─────────────────────────── Panier

model Cart {
  id        String     @id @default(cuid())
  userId    String?                          // null = panier anonyme
  token     String     @unique               // cookie du visiteur non connecté
  countryId String
  items     CartItem[]
  expiresAt DateTime
  updatedAt DateTime   @updatedAt
}

model CartItem {
  id        String @id @default(cuid())
  cartId    String
  cart      Cart   @relation(fields: [cartId], references: [id], onDelete: Cascade)
  variantId String
  quantity  Int
  @@unique([cartId, variantId])
}

// ─────────────────────────── Commande

enum OrderStatus {
  PENDING_PAYMENT   // créée, paiement non confirmé
  PAID              // encaissée, en attente d'acceptation des ateliers
  IN_PRODUCTION     // au moins une sous-commande en fabrication
  READY             // tout est prêt à enlever
  IN_DELIVERY       // au moins une expédition en route
  DELIVERED         // tout est livré
  COMPLETED         // délai de rétractation écoulé → versements libérés
  CANCELLED
  REFUNDED
}

enum SubOrderStatus {
  PENDING ACCEPTED REJECTED IN_PRODUCTION READY
  PICKED_UP DELIVERED CANCELLED
}

model Order {
  id             String      @id @default(cuid())
  reference      String      @unique          // CMD-2026-000123, visible du client
  customerId     String
  customer       User        @relation(fields: [customerId], references: [id])
  status         OrderStatus @default(PENDING_PAYMENT)
  countryId      String

  // Adresse figée à la commande : si le client modifie son carnet
  // d'adresses ensuite, la commande ne doit pas changer.
  shipFullName   String
  shipPhone      String
  shipCityId     String
  shipLine1      String
  shipLandmark   String?
  shipLat        Float?
  shipLng        Float?

  // Montants figés (§ 6.1). Tous en XOF entier.
  itemsSubtotalXof Int
  deliveryFeeXof   Int
  vatXof           Int
  discountXof      Int    @default(0)
  totalXof         Int                        // ce que le client paie
  commissionXof    Int                        // part Ojà, informative ici

  placedAt       DateTime?
  completedAt    DateTime?
  cancelledAt    DateTime?
  cancelReason   String?
  createdAt      DateTime    @default(now())
  updatedAt      DateTime    @updatedAt

  subOrders      SubOrder[]
  payments       Payment[]
  shipments      Shipment[]
  disputes       Dispute[]
  @@index([customerId, status])
  @@index([status, createdAt])
}

/// Une commande peut réunir les pièces de plusieurs ateliers.
/// La SubOrder est l'unité que le fabricant voit, accepte et prépare,
/// et l'unité sur laquelle porte son versement.
model SubOrder {
  id            String         @id @default(cuid())
  reference     String         @unique         // CMD-2026-000123-A
  orderId       String
  order         Order          @relation(fields: [orderId], references: [id])
  makerId       String
  maker         MakerProfile   @relation(fields: [makerId], references: [id])
  status        SubOrderStatus @default(PENDING)

  itemsSubtotalXof Int
  commissionBps    Int                          // taux figé au moment de la commande
  commissionXof    Int
  makerPayoutXof   Int                          // itemsSubtotal - commission

  acceptedAt    DateTime?
  rejectedAt    DateTime?
  rejectReason  String?
  readyAt       DateTime?
  deliveredAt   DateTime?
  dueReadyAt    DateTime?                       // échéance de préparation

  lines         OrderLine[]
  shipment      Shipment?
  payout        PayoutItem?
  @@index([makerId, status])
}

model OrderLine {
  id           String   @id @default(cuid())
  subOrderId   String
  subOrder     SubOrder @relation(fields: [subOrderId], references: [id])
  variantId    String
  // Copies figées : le produit peut être renommé ou retiré du catalogue,
  // la facture doit rester lisible dix ans plus tard.
  productName  String
  variantName  String
  sku          String
  unitPriceXof Int
  quantity     Int
  totalXof     Int
}

// ─────────────────────────── Paiement

enum PaymentStatus  { INITIATED PENDING PAID FAILED EXPIRED REFUNDED PARTIALLY_REFUNDED }
enum PaymentChannel { MOBILE_MONEY CARD CASH_ON_DELIVERY }

model PaymentMethodConfig {
  id         String  @id @default(cuid())
  countryId  String
  country    Country @relation(fields: [countryId], references: [id])
  channel    PaymentChannel
  operator   String?                          // wave, orange, mtn, moov
  label      String
  logoUrl    String?
  feeBps     Int                              // frais agrégateur, en points de base
  isActive   Boolean @default(true)
  position   Int     @default(0)
}

model Payment {
  id            String        @id @default(cuid())
  orderId       String
  order         Order         @relation(fields: [orderId], references: [id])
  status        PaymentStatus @default(INITIATED)
  channel       PaymentChannel
  operator      String?

  provider      String        @default("kadevpay")
  providerRef   String?       @unique         // KDV-1775413916000
  providerMode  String        @default("live")// live | test

  amountXof     Int                           // montant demandé
  paidAmountXof Int?                          // montant réellement encaissé
  netAmountXof  Int?                          // net agrégateur, frais déduits
  feeXof        Int?                          // frais retenus par l'agrégateur

  idempotencyKey String       @unique
  initiatedAt   DateTime      @default(now())
  paidAt        DateTime?
  failedAt      DateTime?
  failureCode   String?
  failureMessage String?
  expiresAt     DateTime                      // au-delà, le stock est relâché

  refunds       Refund[]
  events        PaymentEvent[]
  @@index([orderId, status])
  @@index([status, expiresAt])
}

/// Journal brut de tout ce que l'agrégateur nous envoie ou nous répond.
/// Sert de preuve, de source de rejeu et de base de réconciliation.
model PaymentEvent {
  id           String   @id @default(cuid())
  paymentId    String?
  payment      Payment? @relation(fields: [paymentId], references: [id])
  providerRef  String?
  eventType    String                          // payment.success…
  signature    String?
  rawBody      String                          // corps brut, tel qu'il est arrivé
  payload      Json
  signatureOk  Boolean
  processedAt  DateTime?
  error        String?
  receivedAt   DateTime @default(now())
  @@unique([providerRef, eventType, signature])  // clé d'idempotence (§ 7.5)
  @@index([processedAt])
}

model Refund {
  id          String   @id @default(cuid())
  paymentId   String
  payment     Payment  @relation(fields: [paymentId], references: [id])
  amountXof   Int
  reason      String
  status      String   @default("PENDING")     // PENDING | DONE | FAILED
  providerRef String?
  requestedBy String                           // id de l'admin
  createdAt   DateTime @default(now())
  settledAt   DateTime?
}

// ─────────────────────────── Grand livre (§ 8)

enum LedgerAccountType { PLATFORM_CASH PLATFORM_REVENUE MAKER_PAYABLE COURIER_PAYABLE CUSTOMER_REFUNDABLE PSP_FEE VAT_PAYABLE }

model LedgerAccount {
  id        String            @id @default(cuid())
  type      LedgerAccountType
  ownerId   String?                            // userId pour les comptes nominatifs
  currency  String            @default("XOF")
  entries   LedgerEntry[]
  @@unique([type, ownerId])
}

/// Partie double stricte : chaque transaction porte n lignes dont la somme
/// des montants signés vaut exactement zéro. Aucune ligne n'est jamais
/// modifiée ni supprimée — on contre-passe.
model LedgerTransaction {
  id          String        @id @default(cuid())
  kind        String                           // order_paid, payout_released…
  refType     String                           // order | payout | refund
  refId       String
  memo        String?
  entries     LedgerEntry[]
  createdAt   DateTime      @default(now())
  @@index([refType, refId])
}

model LedgerEntry {
  id            String            @id @default(cuid())
  transactionId String
  transaction   LedgerTransaction @relation(fields: [transactionId], references: [id])
  accountId     String
  account       LedgerAccount     @relation(fields: [accountId], references: [id])
  amountXof     Int                              // signé : + débit, − crédit
  createdAt     DateTime          @default(now())
  @@index([accountId, createdAt])
}

// ─────────────────────────── Reversements

enum PayoutMethod { MOBILE_MONEY BANK_TRANSFER CASH }
enum PayoutStatus { SCHEDULED READY PROCESSING PAID FAILED CANCELLED }

model PayoutBatch {
  id          String       @id @default(cuid())
  reference   String       @unique             // PAY-2026-W33
  status      PayoutStatus @default(SCHEDULED)
  totalXof    Int          @default(0)
  itemCount   Int          @default(0)
  approvedBy  String?
  approvedAt  DateTime?
  executedAt  DateTime?
  items       PayoutItem[]
  createdAt   DateTime     @default(now())
}

model PayoutItem {
  id           String       @id @default(cuid())
  batchId      String?
  batch        PayoutBatch? @relation(fields: [batchId], references: [id])
  beneficiaryId String                          // userId du MAKER ou du COURIER
  beneficiaryRole UserRole
  subOrderId   String?      @unique
  subOrder     SubOrder?    @relation(fields: [subOrderId], references: [id])
  assignmentId String?      @unique
  amountXof    Int
  method       PayoutMethod
  msisdn       String?
  operator     String?
  status       PayoutStatus @default(SCHEDULED)
  externalRef  String?                          // référence du transfert exécuté
  failureReason String?
  releasedAt   DateTime?
  paidAt       DateTime?
  @@index([beneficiaryId, status])
}

// ─────────────────────────── Logistique (§ 9)

enum ShipmentStatus { PENDING ASSIGNED PICKED_UP IN_TRANSIT DELIVERED FAILED RETURNED }

model Shipment {
  id           String         @id @default(cuid())
  reference    String         @unique           // LIV-2026-000456
  orderId      String
  order        Order          @relation(fields: [orderId], references: [id])
  subOrderId   String         @unique
  subOrder     SubOrder       @relation(fields: [subOrderId], references: [id])
  status       ShipmentStatus @default(PENDING)
  zoneId       String
  feeXof       Int                              // facturé au client
  courierFeeXof Int                             // reversé au livreur
  pickupCityId String
  pickupLine1  String
  etaAt        DateTime?
  assignments  DeliveryAssignment[]
  events       ShipmentEvent[]
  createdAt    DateTime       @default(now())
}

model DeliveryAssignment {
  id          String   @id @default(cuid())
  shipmentId  String
  shipment    Shipment @relation(fields: [shipmentId], references: [id])
  courierId   String
  courier     CourierProfile @relation(fields: [courierId], references: [id])
  offeredAt   DateTime @default(now())
  expiresAt   DateTime                          // l'offre retombe dans le pool
  acceptedAt  DateTime?
  declinedAt  DateTime?
  completedAt DateTime?
  // Preuve de livraison
  proofPhotoKey String?
  proofOtp      String?                         // code à 4 chiffres remis au client
  proofSignedAt DateTime?
  proofLat      Float?
  proofLng      Float?
  @@index([courierId, acceptedAt])
}

model ShipmentEvent {
  id         String   @id @default(cuid())
  shipmentId String
  shipment   Shipment @relation(fields: [shipmentId], references: [id])
  status     ShipmentStatus
  note       String?
  actorId    String?
  latitude   Float?
  longitude  Float?
  createdAt  DateTime @default(now())
}

// ─────────────────────────── Litiges, avis, support, audit

enum DisputeStatus { OPEN AWAITING_CUSTOMER AWAITING_MAKER UNDER_REVIEW RESOLVED REJECTED }

model Dispute {
  id          String        @id @default(cuid())
  reference   String        @unique
  orderId     String
  order       Order         @relation(fields: [orderId], references: [id])
  subOrderId  String?
  openedById  String
  reason      String                             // non_recu, non_conforme, casse…
  status      DisputeStatus @default(OPEN)
  resolution  String?                            // refund_full, refund_partial, reship…
  refundXof   Int?
  resolvedBy  String?
  resolvedAt  DateTime?
  slaDueAt    DateTime
  messages    DisputeMessage[]
  createdAt   DateTime      @default(now())
}

model DisputeMessage {
  id        String   @id @default(cuid())
  disputeId String
  dispute   Dispute  @relation(fields: [disputeId], references: [id])
  authorId  String
  body      String
  fileKeys  String[]
  isInternal Boolean @default(false)             // note d'équipe, invisible des parties
  createdAt DateTime @default(now())
}

model Review {
  id         String   @id @default(cuid())
  productId  String
  authorId   String
  orderLineId String  @unique                    // un avis exige un achat réel
  rating     Int                                 // 1..5
  body       String?
  status     String   @default("PENDING")        // modération
  createdAt  DateTime @default(now())
}

model Notification {
  id        String   @id @default(cuid())
  userId    String
  channel   String                                // email | sms | push | inapp
  template  String
  payload   Json
  sentAt    DateTime?
  readAt    DateTime?
  error     String?
  createdAt DateTime @default(now())
}

model AuditLog {
  id         String   @id @default(cuid())
  actorId    String?
  actorRole  UserRole?
  action     String                               // maker.kyc.approve
  targetType String
  targetId   String
  before     Json?
  after      Json?
  ip         String?
  createdAt  DateTime @default(now())
  @@index([targetType, targetId])
}
```

### 4.3 Le point le plus important du schéma

**Tout ce qui a une valeur juridique ou comptable est figé par copie, jamais
par référence.** `OrderLine` copie le nom du produit et le prix unitaire ;
`SubOrder` copie le taux de commission ; `Order` copie l'adresse de livraison.
Un artisan qui augmente ses prix ou renomme une pièce ne doit pas pouvoir
réécrire l'histoire d'une commande déjà passée.

---

## 5. Machines à états

Les transitions sont **explicites et gardées** : chaque changement de statut
passe par un service dédié qui valide la transition, écrit l'événement et
publie les effets de bord. Un `UPDATE orders SET status = …` direct est un bug.

### 5.1 Commande

```
PENDING_PAYMENT ──paiement confirmé──► PAID ──atelier accepte──► IN_PRODUCTION
       │                                 │                            │
       │ expiration / échec              │ tous ateliers refusent      ▼
       ▼                                 ▼                          READY
   CANCELLED  ◄────────────────────── CANCELLED                       │
                                                                      ▼
COMPLETED ◄──J+7 sans litige── DELIVERED ◄──preuve de livraison── IN_DELIVERY
   │
   └──litige tranché en faveur du client──► REFUNDED
```

**`DELIVERED` → `COMPLETED` est la transition qui libère l'argent.** Elle est
déclenchée par une tâche planifiée, 7 jours après la livraison, si aucun litige
n'est ouvert. C'est le point de rendez-vous entre la logistique et la finance.

### 5.2 Sous-commande (vue fabricant)

```
PENDING ──48 h pour répondre──► ACCEPTED ──► IN_PRODUCTION ──► READY ──► PICKED_UP ──► DELIVERED
   │                                                                             
   └── REJECTED (ou silence > 48 h) ──► remboursement au prorata de la ligne
```

Le silence vaut refus. Sans cette règle, une commande peut rester bloquée
indéfiniment sur un atelier injoignable.

### 5.3 Paiement

```
INITIATED ──redirection/widget──► PENDING ──webhook payment.success──► PAID
    │                                │
    │                                ├── webhook d'échec ──► FAILED
    └── pas de webhook à expiresAt ──┴── réconciliation (§ 7.6) ──► PAID | EXPIRED
```

---

## 6. Prix, frais et taxes

### 6.1 Ordre de calcul

Le calcul est fait **une seule fois**, côté serveur, à la création de la
commande, puis figé. Le front n'a le droit de calculer que pour afficher.

```
1. sous-total articles   = Σ (prix unitaire figé × quantité)
2. remise                = code promo appliqué au sous-total
3. frais de livraison    = Σ (par expédition) tarif de zone [+ surcharge poids/volume]
                           mis à 0 si sous-total ≥ freeAboveXof de la zone
4. base taxable          = sous-total − remise + livraison
5. TVA                   = base taxable × vatRate du pays de livraison
6. TOTAL CLIENT          = base taxable + TVA
7. commission Ojà        = Σ (par sous-commande) sous-total atelier × commissionBps
8. dû au fabricant       = sous-total atelier − commission
9. dû au livreur         = courierFeeXof de l'expédition
```

**Arrondis** : la commission et la TVA sont calculées en points de base sur des
entiers, arrondies **à l'entier inférieur**, et l'écart d'arrondi tombe toujours
du côté d'Ojà. Aucun franc ne doit jamais apparaître ou disparaître entre le
total client et la somme des parts — c'est vérifié par une contrainte du grand
livre (§ 8.2).

### 6.2 Qui supporte les frais de l'agrégateur

Kadev Pay prélève **2,3 % en Mobile Money** et **4,5 % en carte** (constaté sur
la documentation publique, § 7.1), et propose quatre stratégies dont
« E-Commerce : le marchand absorbe tout ».

**Décision : Ojà absorbe les frais agrégateur** et les impute sur sa commission,
pas sur la part du fabricant. Deux raisons : le client voit le prix affiché et
paie exactement ce prix, ce qui évite un abandon au dernier écran ; et l'artisan
touche un montant prévisible qu'il peut annoncer lui-même.

Conséquence : la commission nette réelle d'Ojà sur une commande Mobile Money à
10 % de commission affichée est de **10 % − 2,3 % = 7,7 %**. La commission
plancher doit être fixée en connaissance de ce chiffre.

---

## 7. Module paiement — intégration Kadev Pay

C'est le module le plus sensible du système. Il est traité en détail.

### 7.1 Ce que Kadev Pay expose

Relevé le 12 août 2026 depuis <https://pay.kadev.ci/developer-documentation>.
**À faire confirmer par écrit auprès de l'éditeur avant le développement** — la
documentation est publique mais non versionnée, et le service se présente
d'abord comme une passerelle pour « églises et associations », pas comme une
infrastructure de place de marché.

| Élément | Valeur constatée |
|---|---|
| Base API | `https://pay.kadev.ci/api` |
| SDK navigateur | `https://pay.kadev.ci/js/v1/kadev-pay.js` → `KadevPay.checkout({…})` |
| Clé publique | `kdvp_test_…` / `kdvp_live_…` — utilisable côté client |
| Clé secrète | `kdvs_test_…` / `kdvs_live_…` — serveur uniquement |
| Auth serveur | `Authorization: Bearer <clé secrète>` |
| Vérification | `GET /api/v1/transactions/verify/{reference}` |
| Webhook | `POST` vers l'URL configurée, en-tête `X-KadevPay-Signature` |
| Signature | HMAC **SHA-512** du corps brut, clé = « Secret Webhook » |
| Événement | `payment.success` |
| Référence | `KDV-<epoch_ms>` |
| Devise | `XOF` |
| Canaux | `momo` (2,3 %) et `card` (4,5 %) |
| Sandbox | Clés `_test_`, jeu complet de fonctionnalités |
| Sous-traitants | KkiaPay et Paystack (chargés par la page de paiement) |

**Réponse de vérification :**

```json
{
  "status": "success",
  "mode": "live",
  "data": {
    "reference": "KDV-1775413916000",
    "status": "paid",
    "amount": 5000,
    "currency": "XOF",
    "customer": { "full_name": "…", "email": "…" },
    "paid_at": "2026-04-05T18:32:02+00:00"
  }
}
```

**Charge utile du webhook :**

```json
{
  "event": "payment.success",
  "data": {
    "reference": "KDV-1775415488000",
    "amount": 5000,
    "net_amount": 4850,
    "currency": "XOF",
    "status": "paid",
    "customer": { "full_name": "…", "email": "…", "phone": "…" },
    "metadata": { "cart_id": "CMD-9982", "payment_provider": "paystack",
                  "payment_method_selected": "mobile" }
  }
}
```

### 7.2 La limite structurelle, et comment on fait avec

**Kadev Pay est une passerelle mono-marchand.** Rien dans son API publique ne
permet de répartir automatiquement un encaissement entre plusieurs
bénéficiaires, ni de déclencher un virement vers un tiers. Les versements
existent dans son tableau de bord (`/dashboard/payouts`) mais ne sont pas
exposés en API.

**Conséquence architecturale — c'est la décision structurante du projet :**

> Ojà encaisse **100 % du montant** sur son unique compte marchand Kadev Pay,
> tient **son propre grand livre** des sommes dues à chaque fabricant et à
> chaque livreur, et exécute les reversements par un canal distinct.

Ce que cela implique concrètement :

1. Ojà détient des fonds appartenant à des tiers. Ce n'est pas neutre
   juridiquement (cf. § 15) et doit être couvert par les CGU des fabricants.
2. Le grand livre du § 8 n'est pas un confort comptable, c'est **la seule source
   de vérité** sur ce qui est dû. Il doit être irréprochable.
3. Les reversements sont un module à part entière avec sa propre exécution,
   ses échecs et ses rapprochements (§ 8.4).

**Alternative à explorer avant le développement** : demander à Kadev Pay
l'accès à une fonctionnalité de *split* / sous-comptes. Leur page de paiement
manipule déjà les champs `split` et `subaccount` (mécanisme Paystack) — la
capacité existe donc en dessous, sans être documentée publiquement. Si elle est
ouverte, une partie du § 8.4 disparaît. **À trancher au § 19.1.**

### 7.3 Flux d'encaissement

```
Client                Front Next.js          API Ojà              Kadev Pay
  │                        │                    │                     │
  │ « Payer »              │                    │                     │
  ├───────────────────────►│                    │                     │
  │                        │ POST /checkout     │                     │
  │                        ├───────────────────►│                     │
  │                        │                    │ réserve le stock    │
  │                        │                    │ crée Order (PENDING_PAYMENT)
  │                        │                    │ crée Payment (INITIATED)
  │                        │◄───────────────────┤ {paymentId, publicKey,
  │                        │                    │  amount, reference}
  │                        │ KadevPay.checkout({…, metadata:{order_id, payment_id}})
  │                        ├─────────────────────────────────────────►│
  │◄───────────────────────┴─────────────────────────────────────────►│ widget
  │ saisit son code Mobile Money                                      │
  │                                                                    │
  │                                            ◄──── webhook ─────────┤
  │                                            │ POST /webhooks/kadevpay
  │                                            │ vérifie HMAC, idempotence,
  │                                            │ MONTANT, devise, mode
  │                                            │ → Payment PAID
  │                                            │ → Order PAID
  │                                            │ → écriture au grand livre
  │                                            │ → notifie les ateliers
  │  redirection callback_url                  │
  ├───────────────────────►│ /confirmation?ref= │
  │                        ├───────────────────►│ GET /orders/{ref}
  │                        │◄───────────────────┤ statut réel, jamais celui de l'URL
```

### 7.4 Règles non négociables

1. **Le montant n'est jamais transmis par le client.** Le front envoie un
   `cartId`, l'API recalcule le total et c'est ce total-là qui part à
   l'agrégateur. Accepter un montant venu du navigateur, c'est offrir un
   fauteuil à 100 F CFA.
2. **La redirection ne vaut pas paiement.** `callback_url` est un confort
   d'affichage. Le seul fait qui fasse basculer une commande en `PAID` est le
   webhook vérifié, ou une vérification serveur-à-serveur explicite.
3. **`metadata` porte nos identifiants.** On y met `order_id`, `payment_id`,
   `idempotency_key`. C'est ce qui permet de rattacher un webhook à une
   commande même si la référence de l'agrégateur change de format.
4. **Le stock est réservé dès `INITIATED`**, pas à la confirmation. Un
   `stockReserved` incrémenté, relâché par un job si le paiement expire.
5. **`expiresAt` sur chaque `Payment`** (30 minutes). Passé ce délai, un job
   vérifie une dernière fois auprès de l'agrégateur, puis expire le paiement et
   relâche le stock.

### 7.5 Réception du webhook

Endpoint : `POST /webhooks/kadevpay`, **non authentifié** (l'authenticité vient
de la signature), exclu du parseur JSON global.

```ts
// apps/api/src/payments/kadevpay-webhook.controller.ts
@Post('webhooks/kadevpay')
@HttpCode(200)
async handle(
  @Req() req: RawBodyRequest<Request>,
  @Headers('x-kadevpay-signature') signature: string,
) {
  const raw = req.rawBody;                       // Buffer, JAMAIS re-sérialisé
  if (!raw || !signature) throw new UnauthorizedException();

  const expected = createHmac('sha512', this.config.webhookSecret)
    .update(raw)
    .digest('hex');

  // Comparaison à temps constant : un `===` fuit la signature octet par octet.
  const ok =
    expected.length === signature.length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(signature));

  // On journalise même les webhooks invalides : c'est un signal d'attaque.
  const event = await this.payments.recordEvent({ raw, signature, signatureOk: ok });
  if (!ok) throw new UnauthorizedException();

  // On répond 200 tout de suite et on traite dans le worker :
  // l'agrégateur ne doit jamais attendre notre base de données.
  await this.queue.add('kadevpay.process', { eventId: event.id },
    { jobId: event.id, attempts: 8, backoff: { type: 'exponential', delay: 2000 } });

  return { received: true };
}
```

> **Piège à éviter** : l'exemple Node.js de la documentation Kadev Pay calcule
> le HMAC sur `JSON.stringify(req.body)`. C'est faux dès que l'agrégateur
> sérialise différemment de `JSON.stringify` (espaces, ordre des clés, échappement
> Unicode). On signe **toujours** sur le corps brut reçu. Le middleware
> `rawBody: true` de NestJS est activé pour cette seule route.

**Traitement dans le worker**, dans une transaction unique :

```
1. Verrou Redis sur providerRef (évite le doublon si deux webhooks arrivent ensemble)
2. Si PaymentEvent.processedAt ≠ null → sortie immédiate (idempotence)
3. Retrouver le Payment par metadata.payment_id, à défaut par providerRef
4. VÉRIFICATIONS DE COHÉRENCE — toute divergence ⇒ litige interne, pas d'encaissement
   ├─ data.currency == "XOF"
   ├─ data.status  == "paid"
   ├─ data.amount  == payment.amountXof        ← le contrôle le plus important
   └─ mode         == mode attendu (live/test)
5. Payment → PAID (paidAmountXof, netAmountXof, feeXof, paidAt)
6. Order   → PAID
7. Écriture au grand livre (§ 8.3)
8. Confirmer la réservation de stock (stockOnHand -= q, stockReserved -= q)
9. Événements : notifier le client, notifier chaque atelier, ouvrir les SubOrders
10. PaymentEvent.processedAt = now()
```

Le point 4 mérite d'être souligné : **si le montant reçu diffère du montant
attendu, on n'encaisse pas et on alerte un administrateur.** Un paiement partiel
silencieusement accepté est une perte sèche.

### 7.6 Réconciliation

Un webhook peut se perdre. Trois filets de sécurité :

| Filet | Fréquence | Ce qu'il fait |
|---|---|---|
| Vérification active | à l'ouverture de `/confirmation` | `GET /transactions/verify/{ref}` si le paiement est encore `PENDING` |
| Balayage des paiements en attente | toutes les 5 min | Vérifie tous les `PENDING` de plus de 3 minutes |
| Rapprochement quotidien | 03 h 00 | Compare les `Payment` `PAID` de J-1 aux relevés de l'agrégateur ; tout écart alerte |

Le chemin de traitement est **le même** que celui du webhook (mêmes contrôles,
même idempotence) : une vérification active ne fait que fabriquer un
`PaymentEvent` synthétique et le pousser dans la même file.

### 7.7 Sécurité du module

- Clés secrètes dans un gestionnaire de secrets, jamais dans le dépôt, jamais
  dans un `NEXT_PUBLIC_*`. Seule la clé **publique** atteint le navigateur.
- L'endpoint webhook est limité en débit et restreint aux IP de l'agrégateur
  si celui-ci les publie.
- Séparation stricte des environnements : les clés `_test_` ne peuvent pas être
  chargées en production (contrôle au démarrage, l'application refuse de
  démarrer sinon).
- Les payloads de `PaymentEvent` sont conservés 10 ans, avec masquage du
  téléphone et de l'e-mail à l'affichage back-office.

---

## 8. Le grand livre et les reversements

### 8.1 Pourquoi une partie double

Parce qu'Ojà détient l'argent d'autrui. Une colonne `solde` sur `MakerProfile`
paraît suffisante jusqu'au premier remboursement partiel sur une commande à
trois ateliers, et l'on ne sait plus ni pourquoi ni depuis quand un solde vaut
ce qu'il vaut. La partie double donne trois propriétés qu'on ne peut pas
obtenir autrement : **chaque franc a une origine traçable**, **rien n'est
modifié après coup** (on contre-passe), et **une erreur se détecte
mécaniquement** — la somme des écritures d'une transaction doit être nulle.

### 8.2 Invariants vérifiés

```
I1  Σ (amountXof) de toute LedgerTransaction  = 0
I2  Solde d'un compte MAKER_PAYABLE           ≥ 0
I3  Σ soldes MAKER_PAYABLE + COURIER_PAYABLE + PLATFORM_REVENUE + VAT_PAYABLE
      = solde PLATFORM_CASH
I4  Aucun UPDATE ni DELETE sur LedgerEntry (garanti par un trigger Postgres)
```

`I1` est vérifié en base par une contrainte différée. `I3` est contrôlé chaque
nuit ; un écart déclenche une alerte de niveau critique — pas un ticket, une
alerte.

### 8.3 Écritures type

**Commande de 100 000 F CFA payée (2 ateliers, commission 10 %, livraison
3 000 F, TVA incluse dans le prix affiché, frais agrégateur 2,3 %) :**

| Transaction `order_paid` | Compte | Montant |
|---|---|---|
| | `PLATFORM_CASH` | +100 000 |
| | `MAKER_PAYABLE` (atelier A) | −54 000 |
| | `MAKER_PAYABLE` (atelier B) | −33 300 |
| | `COURIER_PAYABLE` (provision) | −3 000 |
| | `PLATFORM_REVENUE` | −9 700 |
| **Somme** | | **0** ✅ |

Les frais de l'agrégateur (2 300 F) sont enregistrés séparément :

| Transaction `psp_fee` | Compte | Montant |
|---|---|---|
| | `PSP_FEE` | +2 300 |
| | `PLATFORM_CASH` | −2 300 |

**Livraison confirmée + 7 jours → `payout_released`** : le `MAKER_PAYABLE` de
l'atelier devient un `PayoutItem` en statut `READY`. Le compte n'est soldé
qu'au moment du versement effectif (`payout_paid`), pas à sa programmation.

### 8.4 Exécution des reversements

Faute d'API de virement chez l'agrégateur (§ 7.2), la v1 procède ainsi :

```
Chaque lundi 08 h 00
 1. Le worker constitue un PayoutBatch des PayoutItem en READY
    (seuil minimum 5 000 F CFA, sinon report à la semaine suivante)
 2. Un ADMIN examine le lot dans le back-office : bénéficiaires,
    numéros Mobile Money, montants, commandes rattachées
 3. Il approuve → statut PROCESSING, export CSV au format de l'opérateur
 4. Les virements sont exécutés (portail opérateur ou tableau de bord Kadev)
 5. L'ADMIN importe le fichier de retour ; chaque ligne rapprochée passe
    en PAID avec sa référence externe, chaque échec en FAILED avec son motif
 6. Écriture payout_paid au grand livre, notification au bénéficiaire
```

**La double validation est obligatoire** : la personne qui constitue le lot ne
peut pas être celle qui l'approuve. C'est le contrôle interne minimal dès lors
qu'on manipule les fonds de tiers.

**Cible v2** : brancher une API de virement Mobile Money en masse (Wave
Business, Orange Money B2C, ou l'API de *split* de Kadev Pay si elle est
ouverte) et supprimer les étapes 3 à 5. Le modèle `PayoutItem` est déjà
dimensionné pour cela — seul l'exécuteur change.

### 8.5 Remboursements

Un remboursement suit le chemin inverse et **contre-passe** :

- Si le fabricant n'a pas encore été payé → on annule sa créance, coût nul pour lui.
- S'il a déjà été payé → la créance devient négative et se compense sur ses
  versements suivants, ou fait l'objet d'un recouvrement amiable.
- Les frais de l'agrégateur ne sont **pas** récupérables : ils restent à la
  charge d'Ojà. C'est une ligne de coût à budgéter, pas un incident.

---

## 9. Logistique

### 9.1 Zones et tarifs

Une `DeliveryZone` par pays et par aire (« Abidjan intra-muros », « Grand
Abidjan », « Intérieur du pays »). Chaque ville pointe vers sa zone. Le tarif
est `baseFeeXof`, majoré au poids ou au volume au-delà d'un seuil, offert
au-dessus de `freeAboveXof`.

Le mobilier est volumineux : le calcul retient le **poids volumétrique**
(L×l×h en cm ÷ 5 000) quand il dépasse le poids réel.

### 9.2 Affectation des missions

```
SubOrder → READY
   ↓
Création du Shipment (PENDING)
   ↓
Diffusion aux COURIER de la zone, disponibles, non saturés
   ↓
Premier qui accepte l'emporte  ─── offre expirée après 15 min ──► pool élargi
   ↓                                                              ↓
ASSIGNED → PICKED_UP → IN_TRANSIT → DELIVERED              relance ADMIN
```

Le modèle « premier arrivé » est retenu pour la v1 : simple, lisible pour les
livreurs, sans classement opaque à expliquer. Une affectation par score
(proximité, note, taux d'acceptation) est une évolution v2.

### 9.3 Preuve de livraison

Trois éléments, dont **deux au minimum** sont exigés pour valider :

- **Code OTP à 4 chiffres** envoyé au client, saisi par le livreur ;
- **Photo** du colis remis, horodatée ;
- **Position GPS** au moment de la validation, comparée à l'adresse.

Sans preuve valide, `DELIVERED` est refusé — donc le compte à rebours de 7 jours
ne démarre pas, donc l'atelier n'est pas payé. La preuve de livraison est le
verrou de tout le circuit financier.

### 9.4 Suivi temps réel

Position du livreur poussée toutes les 30 secondes pendant `IN_TRANSIT`,
diffusée au client par SSE (`GET /shipments/{id}/stream`). Les WebSockets sont
écartés : le flux est unidirectionnel, SSE traverse mieux les proxies et coûte
moins cher à exploiter.

---

## 10. Surface d'API

REST, versionnée sous `/api/v1`, JSON, erreurs au format RFC 9457
(`application/problem+json`). Pagination par curseur (`?cursor=&limit=`) —
`OFFSET` s'effondre au-delà de quelques milliers de lignes.

### 10.1 Public

```
GET    /catalog/categories
GET    /catalog/products                ?category=&city=&minPrice=&maxPrice=&sort=&cursor=
GET    /catalog/products/{slug}
GET    /catalog/search                  ?q=
GET    /makers/{slug}
GET    /geo/countries | /geo/cities
POST   /auth/register | /auth/login | /auth/refresh | /auth/verify-otp
POST   /auth/forgot-password | /auth/reset-password
POST   /contact
```

### 10.2 Client (`CUSTOMER`)

```
GET    /me                              PATCH /me
GET    /me/addresses                    POST/PATCH/DELETE /me/addresses/{id}
GET    /cart                            POST /cart/items   PATCH/DELETE /cart/items/{id}
POST   /checkout/quote                  → total, frais, TVA, délais (sans engagement)
POST   /checkout                        → crée Order + Payment, renvoie la config du widget
GET    /orders                          GET /orders/{reference}
GET    /orders/{ref}/invoice.pdf
GET    /shipments/{id}/stream           (SSE)
POST   /orders/{ref}/disputes           POST /disputes/{id}/messages
POST   /order-lines/{id}/review
```

### 10.3 Fabricant (`MAKER`)

```
GET    /maker/dashboard                 CA, commandes en attente, solde à venir
POST   /maker/kyc                       GET /maker/kyc
GET    /maker/products                  POST /maker/products
PATCH  /maker/products/{id}             POST /maker/products/{id}/submit
PATCH  /maker/variants/{id}/stock
GET    /maker/sub-orders                POST /maker/sub-orders/{id}/accept | /reject | /ready
GET    /maker/payouts                   GET /maker/payouts/{id}
```

### 10.4 Livreur (`COURIER`)

```
GET    /courier/missions                offres ouvertes sur ses zones
POST   /courier/missions/{id}/accept | /decline
POST   /courier/shipments/{id}/pickup
POST   /courier/shipments/{id}/position
POST   /courier/shipments/{id}/deliver  (OTP + photo + GPS)
PATCH  /courier/availability
GET    /courier/earnings
```

### 10.5 Administration (`ADMIN`)

```
GET    /admin/makers                    POST /admin/makers/{id}/approve | /reject | /suspend
GET    /admin/couriers                  POST /admin/couriers/{id}/approve
GET    /admin/products?status=PENDING_REVIEW   POST /admin/products/{id}/approve | /reject
GET    /admin/orders                    POST /admin/orders/{id}/cancel
GET    /admin/payments                  POST /admin/payments/{id}/refund
GET    /admin/payouts/batches           POST /admin/payouts/batches
POST   /admin/payouts/batches/{id}/approve      (validateur ≠ créateur)
POST   /admin/payouts/batches/{id}/import-result
GET    /admin/ledger                    GET /admin/ledger/accounts/{id}
GET    /admin/disputes                  POST /admin/disputes/{id}/resolve
GET    /admin/audit-log
GET    /admin/reconciliation/{date}
```

### 10.6 Conventions transverses

- **Idempotence** : toute route `POST` qui crée de l'argent ou du stock exige
  un en-tête `Idempotency-Key`. La réponse est mémorisée 24 h et rejouée à
  l'identique.
- **Limitation de débit** : 5 tentatives de connexion / 15 min / IP ;
  100 requêtes / min / utilisateur ; 20 / min sur la recherche anonyme.
- **Validation** : Zod aux frontières, schémas partagés avec le front via
  `packages/contracts`.
- **Documentation** : OpenAPI générée par les décorateurs NestJS, publiée sur
  `/api/docs` en dehors de la production.

---

## 11. Authentification et sécurité

| Sujet | Décision |
|---|---|
| Mots de passe | argon2id (m=64 Mo, t=3, p=4). Jamais de bcrypt sur un nouveau projet |
| Sessions | JWT d'accès 15 min + refresh 30 jours en rotation, stocké haché en base |
| Transport | Cookies `httpOnly` + `Secure` + `SameSite=Lax`. Pas de jeton en `localStorage` : une faille XSS le rend exploitable |
| Vérification | OTP SMS à l'inscription — en zone UEMOA le téléphone est l'identité, pas l'e-mail |
| MFA | TOTP **obligatoire** pour `ADMIN`, optionnel pour `MAKER` |
| RBAC | Guard NestJS `@Roles()` + vérification de propriété systématique dans le service |
| Chiffrement au repos | Pièces KYC chiffrées côté serveur, accès S3 par URL pré-signée à 5 min |
| Journalisation | Aucun mot de passe, PAN, OTP ni clé secrète dans les logs. Filtre au niveau du logger, pas à la main |
| Dépendances | `npm audit` + Dependabot bloquants en CI |
| Sauvegardes | Postgres : PITR + dump quotidien chiffré, restauration **testée** tous les trimestres |

---

## 12. Notifications

Une seule table `Notification`, un worker par canal, des gabarits versionnés.

| Événement | Client | Fabricant | Livreur | Admin |
|---|---|---|---|---|
| Commande payée | e-mail + SMS | SMS + push | — | — |
| Sous-commande non acceptée sous 48 h | — | SMS de relance | — | tableau de bord |
| Prête à enlever | e-mail | — | push (offre) | — |
| Livraison en cours | SMS + suivi | — | — | — |
| Livrée | e-mail + SMS | notification | — | — |
| Versement effectué | — | SMS | SMS | — |
| Litige ouvert | accusé | notification | — | alerte |
| Écart de rapprochement | — | — | — | **alerte critique** |

Le SMS est le canal prioritaire pour tout ce qui est transactionnel : taux de
lecture sans commune mesure avec l'e-mail sur ce marché.

---

## 13. Multi-pays UEMOA

Tout est déjà en place dans le schéma ; il reste à l'exploiter avec rigueur.

- **Devise unique XOF** dans les huit pays : pas de conversion, pas de taux, pas
  d'écart de change. C'est le principal cadeau de la zone.
- **TVA par pays** : `Country.vatRate`, appliqué selon le **pays de livraison**.
  CI 18 %, BJ 18 %, SN 18 %, TG 18 % — à confirmer par un fiscaliste et surtout
  à ne jamais coder en dur.
- **Opérateurs par pays** : table `PaymentMethodConfig`. Wave et Orange Money en
  CI et SN, MTN MoMo et Moov en CI/BJ/TG, etc. La liste affichée au checkout
  vient de la base, jamais du code.
- **Numéros de téléphone** : stockés en E.164, validés par
  `libphonenumber-js` contre l'indicatif du pays.
- **Ouverture d'un pays** : `Country.isActive = true` suffit à le rendre
  livrable, une fois ses zones, ses tarifs et ses moyens de paiement saisis.
  Aucun déploiement de code.
- **Transfrontalier** : hors périmètre v1. Un client d'un pays A ne peut
  commander qu'auprès d'ateliers du pays A. Les formalités douanières
  intra-UEMOA, même allégées, méritent leur propre chantier.

---

## 14. Recherche et catalogue

Postgres en v1, avec la colonne `searchVector` du § 4.2 :

```sql
-- Index GIN, dictionnaire français, pondération : nom > matière > description
CREATE INDEX product_search_idx ON "Product" USING GIN ("searchVector");

CREATE FUNCTION product_search_refresh() RETURNS trigger AS $$
BEGIN
  NEW."searchVector" :=
      setweight(to_tsvector('french', coalesce(NEW.name, '')), 'A')
   || setweight(to_tsvector('french', coalesce(NEW.material, '')), 'B')
   || setweight(to_tsvector('french', coalesce(NEW.description, '')), 'C');
  RETURN NEW;
END $$ LANGUAGE plpgsql;
```

Recherche insensible aux accents via `unaccent` — le front le fait déjà côté
client, la règle doit être la même côté serveur pour que les résultats
concordent. Facettes (catégorie, prix, ville, matière, disponibilité) par
agrégation SQL. **Meilisearch seulement quand la latence p95 de la recherche
dépasse 200 ms**, pas avant.

---

## 15. Conformité et juridique

Ces points ne sont pas des détails de fin de projet : deux d'entre eux
conditionnent le droit d'exploiter le service.

1. **Détention de fonds de tiers.** Ojà encaisse pour le compte d'artisans.
   Selon la lecture de la réglementation BCEAO, cela peut relever de
   l'intermédiation en opérations de paiement. **Faire qualifier le montage par
   un avocat avant l'ouverture commerciale**, et vérifier que le statut de
   marchand Kadev Pay couvre l'activité de place de marché.
2. **Protection des données.** Loi ivoirienne n° 2013-450 et équivalents
   nationaux : déclaration à l'ARTCI, registre des traitements, base légale
   des envois SMS, droit d'accès et d'effacement. Le champ `deletedAt` permet
   l'anonymisation sans détruire les pièces comptables.
3. **La bannière de confidentialité du design system est une obligation, pas un
   texte d'habillage** : « Ojà gère tous les paiements et la coordination. Les
   coordonnées des créateurs et des clients sont strictement masquées. » Le
   backend doit la faire respecter techniquement — le téléphone du client n'est
   exposé au fabricant à aucun moment, seul le livreur affecté y accède, et
   uniquement pendant sa mission.
4. **Conservation** : pièces comptables 10 ans, journaux techniques 12 mois,
   pièces KYC 5 ans après la fin de la relation.
5. **Facturation** : numérotation séquentielle sans trou, mentions légales du
   pays de livraison, PDF archivé et immuable.
6. **CGU distinctes** pour les clients, les fabricants et les livreurs, avec
   acceptation horodatée et versionnée en base.

---

## 16. Qualité, exploitation, environnements

**Tests** — 70 % de couverture minimum, mais surtout : **100 % des machines à
états, du calcul de prix et du grand livre**. Ces trois-là se testent
exhaustivement, y compris les transitions interdites.

- Unitaires : Vitest sur `packages/domain` (pur, sans base).
- Intégration : Testcontainers (Postgres + Redis réels, pas de simulacre d'ORM).
- Contrat : un simulateur Kadev Pay rejouant les payloads réels du § 7.1,
  webhooks en double, signature invalide, montant divergent, arrivée hors ordre.
- Bout en bout : Playwright sur le parcours complet en mode sandbox.
- Charge : k6 sur le catalogue et le checkout avant l'ouverture.

**Environnements** — `local` (Docker Compose) · `staging` (clés `_test_`,
données anonymisées) · `production`. La promotion se fait par image, jamais par
rebuild.

**CI/CD** — lint → typecheck → tests → build → migrations en *dry-run* →
déploiement. Les migrations Prisma sont appliquées avant le basculement du
trafic ; toute migration destructive passe par une paire de déploiements
(ajout, remplissage, bascule, suppression).

**Observabilité** — traces OpenTelemetry de bout en bout, `paymentId` et
`orderId` en attributs de span. Alertes sur : taux d'échec de paiement > 5 %,
webhooks non traités > 10, écart de rapprochement ≠ 0, file BullMQ > 1 000,
p95 API > 800 ms.

---

## 17. Ce qui change côté front

Le Next.js existant reste, mais quatre briques doivent bouger :

| Aujourd'hui | Demain |
|---|---|
| `src/lib/products.ts` statique | `GET /catalog/products`, en cache ISR 60 s |
| Panier en `localStorage` | Panier serveur, `localStorage` en secours hors ligne, fusion à la connexion |
| Formulaires sans destination | Server Actions → API, erreurs de validation remontées champ par champ |
| Aucune session | Middleware Next.js lisant le cookie, redirection selon le rôle |
| `/inscription` sans choix de rôle | Sélection client / fabricant / livreur, puis parcours KYC dédié |

Trois espaces restent à concevoir et à dessiner : **tableau de bord fabricant**,
**application livreur** (mobile d'abord, PWA), **back-office admin**. Les
maquettes Figma en contiennent une amorce (`108:2532`, `108:2793`, `161:3414`),
non implémentée à ce jour.

---

## 18. Lotissement

| Lot | Contenu | Durée estimée |
|---|---|---|
| **L0 — Socle** | Monorepo, Prisma, Docker, CI, auth, RBAC, OTP SMS | 3 sem. |
| **L1 — Catalogue** | Catégories, produits, variantes, médias, recherche, back-office fabricant minimal | 4 sem. |
| **L2 — Commande** | Panier serveur, devis, création de commande, machines à états | 3 sem. |
| **L3 — Paiement** | Kadev Pay, webhooks, idempotence, réconciliation, **grand livre** | 4 sem. |
| **L4 — Logistique** | Zones, tarifs, expéditions, missions, preuve de livraison, suivi | 4 sem. |
| **L5 — Versements** | Lots, double validation, exports, imports de retour | 2 sem. |
| **L6 — Service client** | Litiges, remboursements, avis, messagerie | 3 sem. |
| **L7 — Back-office** | Administration complète, KYC, modération, tableaux de bord, audit | 3 sem. |
| **L8 — Durcissement** | Charge, audit de sécurité, sauvegardes testées, documentation | 2 sem. |

**Environ 28 semaines** pour une équipe de 2 à 3 personnes côté backend.
Le chemin critique est L3 : rien ne se teste réellement avant que l'argent
circule de bout en bout en sandbox.

**Jalon de mise en service minimale** : L0 → L4 + versements manuels hors
système. Ouverture sur une seule ville, une vingtaine d'ateliers, encaissement
et suivi réels. C'est atteignable en 18 semaines et cela vaut mieux qu'un
système complet livré d'un bloc.

---

## 19. Points à trancher

Ces cinq questions n'ont pas de réponse dans ce document parce qu'elles ne
relèvent pas de la technique. Chacune a un impact direct sur le chiffrage.

**19.1 — Kadev Pay expose-t-il un *split* ou des sous-comptes ?**
Sa page de paiement manipule déjà `split` et `subaccount` (mécanisme Paystack).
Si l'éditeur ouvre cette capacité, le § 8.4 se réduit de moitié et le risque
juridique du § 15.1 diminue nettement. **À demander par écrit avant L3.** C'est
la question la plus rentable de la liste.

**19.2 — Quel taux de commission ?**
Le schéma prévoit un taux par atelier (`commissionBps`, 10 % par défaut). En
tenant compte des 2,3 % de frais Mobile Money absorbés (§ 6.2), une commission
inférieure à 8 % laisse une marge nette trop mince pour financer le support et
la logistique.

**19.3 — Le paiement à la livraison ?**
`CASH_ON_DELIVERY` figure dans l'énumération mais n'est traité nulle part.
C'est un moyen de paiement attendu sur ce marché, et il fait porter le risque
d'impayé au livreur et l'encaissement d'espèces à Ojà. **Décision produit
avant L4**, sans quoi la logistique sera à reprendre.

**19.4 — Combien de jours avant de libérer l'argent du fabricant ?**
7 jours est retenu par défaut. Plus court favorise la trésorerie de l'artisan,
plus long protège Ojà en cas de litige. Un délai réduit pour les ateliers
anciens et bien notés est un bon compromis, mais c'est un arbitrage
commercial.

**19.5 — Qui porte le risque d'une pièce cassée en transit ?**
Le mobilier volumineux casse. Livreur, atelier, Ojà, assurance ? Sans règle
écrite, chaque incident devient une négociation. À fixer dans les CGU des
trois parties avant l'ouverture.

---

## Annexe A — Variables d'environnement

```bash
# Base
DATABASE_URL=postgresql://…
REDIS_URL=redis://…

# Auth
JWT_ACCESS_SECRET=…
JWT_REFRESH_SECRET=…
ARGON2_PEPPER=…

# Kadev Pay  (clés live absentes de tout environnement non-production)
KADEVPAY_BASE_URL=https://pay.kadev.ci/api
KADEVPAY_PUBLIC_KEY=kdvp_test_…        # seule clé exposée au navigateur
KADEVPAY_SECRET_KEY=kdvs_test_…
KADEVPAY_WEBHOOK_SECRET=…
KADEVPAY_MODE=test                     # test | live
KADEVPAY_CALLBACK_URL=https://oja.market/confirmation

# Stockage
S3_ENDPOINT=…  S3_BUCKET=…  S3_ACCESS_KEY=…  S3_SECRET_KEY=…

# Messagerie
RESEND_API_KEY=…
SMS_PROVIDER_KEY=…

# Métier
PLATFORM_COMMISSION_BPS=1000           # 10 %
PAYOUT_HOLD_DAYS=7
PAYOUT_MIN_XOF=5000
PAYMENT_EXPIRY_MINUTES=30
SUBORDER_ACCEPT_HOURS=48
```

## Annexe B — Contrôles avant mise en production

- [ ] Clés `live` chargées **uniquement** en production, contrôle bloquant au démarrage
- [ ] Webhook signé, vérifié sur corps brut, comparaison à temps constant
- [ ] Idempotence prouvée : le même webhook rejoué 100 fois ne crée qu'une écriture
- [ ] Contrôle du montant reçu vs attendu, testé sur un cas divergent
- [ ] Invariants `I1`–`I4` du grand livre vérifiés sur un jeu de 10 000 commandes simulées
- [ ] Restauration de sauvegarde effectuée pour de vrai, chronométrée
- [ ] Double validation des versements impossible à contourner (testée)
- [ ] Coordonnées client jamais exposées au fabricant (testé sur toutes les routes)
- [ ] Rapprochement quotidien opérationnel et alerte de niveau critique branchée
- [ ] CGU des trois profils publiées, acceptation horodatée en base
- [ ] Déclaration ARTCI déposée
- [ ] Qualification juridique de la détention de fonds obtenue par écrit

---

*Ce document est une base de travail versionnée avec le code. Toute décision
prise au § 19 doit y être reportée, datée, et non consignée ailleurs.*

*La déclinaison en tâches exécutables se trouve dans
[`BACKLOG-BACKEND.md`](BACKLOG-BACKEND.md).*
