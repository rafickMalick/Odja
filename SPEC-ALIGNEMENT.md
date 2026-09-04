# Ojà — Alignement sur le cahier des charges client

**12 août 2026 — document de référence pour la reprise du backend.**

Le document *OJÀ — Phase 1 : Makers Place*, discuté avec le client, **fait
autorité** sur [`CAHIER-DES-CHARGES-BACKEND.md`](CAHIER-DES-CHARGES-BACKEND.md),
qui avait été rédigé sans lui. Ce document liste tout ce qui change, ce que
j'ai tranché seul et ce qui reste à arbitrer.

**Nouvelle règle de séquencement** : le paiement, l'agrégateur et le juridique
sont repoussés en fin de parcours. Tout le reste de l'application se construit
d'abord, avec un encaissement simulé (§ 7).

---

## 1. Le changement le plus important : le sens de la commission

Mon cahier prenait la commission **en déduction** de ce que touche le créateur.
Le document client la prend **en supplément** du prix qu'il fixe. Ce n'est pas
une nuance de vocabulaire : c'est un modèle de données différent, un calcul de
prix différent et une écriture comptable différente.

| | Mon cahier (faux) | Document client (retenu) |
|---|---|---|
| Le créateur affiche | 100 000 F | 100 000 F |
| Le client paie | 100 000 F | **105 000 F** |
| Le créateur reçoit | 90 000 F | **100 000 F** |
| Ojà encaisse | 10 000 F | 5 000 F |

Le document client affichait à l'origine **trois lignes distinctes** — « Prix
du créateur », « Commission OJÀ », « Prix final ». **Décision révisée (août
2026)** : le client ne voit plus que **le prix final**. Le créateur touche
toujours exactement le prix qu'il a fixé, mais la marge d'Ojà ne lui est plus
montrée — ni sur la fiche produit, ni au panier, ni au chiffrage, ni sur la
commande ou la facture, **ni dans les réponses de l'API** (`PublicProduct`,
`CartView`, `CheckoutQuote`, `OrderView` ne portent plus `makerPriceXof` /
`commissionXof`). Le détail reste au back-office (créateur et administration)
et figé sur `OrderLine` en base.

**Conséquences dans le schéma :**

```prisma
model Product {
  makerPriceXof  Int   // le prix que le créateur fixe et qu'il touchera
  // commissionBps et finalPriceXof ne sont PAS stockés ici :
  // le taux évolue, le prix final se recalcule à l'affichage.
}

model OrderLine {
  makerPriceXof   Int   // figé à la commande — ce que le créateur recevra
  commissionBps   Int   // figé à la commande
  commissionXof   Int   // makerPriceXof × commissionBps, arrondi à l'inférieur
  finalPriceXof   Int   // makerPriceXof + commissionXof — ce que le client paie
  quantity        Int
  lineTotalXof    Int   // finalPriceXof × quantity
}
```

Le champ `makerPayoutXof` de `SubOrder` ne se calcule plus par soustraction :
il vaut **exactement** `Σ (makerPriceXof × quantity)`.

### Ce que ça coûte réellement à Ojà — à lire avant de fixer le pourcentage

Vous m'avez dit qu'on reverrait le taux plus tard. Voici le chiffre qui doit
servir à cette décision, sur une commande de 100 000 F de produit :

| Ligne | Montant |
|---|---|
| Prix créateur | 100 000 F |
| Commission Ojà 5 % | +5 000 F |
| Livraison facturée | +3 000 F |
| **Total payé par le client** | **108 000 F** |
| Frais agrégateur Mobile Money 2,3 % sur 108 000 | −2 484 F |
| Reversé au créateur | −100 000 F |
| Reversé au livreur | −2 500 F |
| **Reste à Ojà** | **3 016 F** |

**Ojà conserve 3 016 F sur 108 000 encaissés, soit 2,8 %.** Sur ces 3 016 F il
faut financer le support, la coordination logistique, l'infrastructure et les
pertes sur litige. Et en cas de remboursement, Ojà garde bien les 5 000 F de
commission mais a déjà décaissé les 2 484 F de frais agrégateur, **qui ne sont
jamais récupérables**.

Ce n'est pas un avis sur votre modèle, c'est l'arithmétique. Elle reste valable
quel que soit le taux — c'est pour ça qu'il faut la poser maintenant, pas au
moment de brancher le paiement.

---

## 2. Le déclenchement du versement change

| | Mon cahier | Document client |
|---|---|---|
| Déclencheur | J+7 sans litige, automatique | **Validation explicite du client à la réception** |
| Délai | 7 jours | **24 heures après validation** |
| Preuve de livraison | OTP + photo + GPS, deux sur trois | **Le client valide depuis son espace** |

Le document client est net : à réception, le client inspecte puis clique
**« Valider la réception »** ou **« Signaler un problème »**. C'est ce clic qui
décide de tout.

```
Livreur marque « Livré »
        │
        ▼
Client inspecte  ──── Valider la réception ───► versement créateur à +24 h
        │
        └────────── Signaler un problème ─────► litige, produit à retourner,
                                                remboursement du prix produit
```

**Ce qu'il faut ajouter, et qui n'est pas dans le document client** : si le
client ne clique ni sur l'un ni sur l'autre, rien ne se passe et le créateur
n'est jamais payé. Il faut une **validation automatique par défaut** au bout
d'un délai. Je propose **72 heures**, à confirmer (§ 9, point A).

La preuve de livraison du livreur (photo + GPS) n'est pas supprimée pour
autant : elle reste nécessaire pour arbitrer un litige où le client prétend
n'avoir rien reçu. Elle change simplement de rôle — elle ne déclenche plus le
paiement, elle sert de preuve.

---

## 3. La livraison se calcule au réel, plus au forfait

Mon cahier prévoyait des zones à tarif forfaitaire. Le document client demande
un calcul **par distance**, avec un **véhicule choisi automatiquement**.

> Le système choisit automatiquement Moto / Tricycle / Camionnette selon :
> dimensions, poids, quantité, distance.

```prisma
enum VehicleType { MOTO TRICYCLE CAMIONNETTE }

model VehicleRate {
  countryId     String
  vehicle       VehicleType
  baseFeeXof    Int
  perKmXof      Int
  maxWeightKg   Int
  maxVolumeL    Int
  maxLengthCm   Int
  minFeeXof     Int
}
```

**Règle de sélection** — retenir le véhicule **le moins cher parmi ceux dont la
capacité couvre la commande**, jamais simplement le plus petit :

```
1. Cumuler poids, volume et plus grande dimension de la commande
2. Écarter les véhicules dont une capacité est dépassée
3. Si aucun ne convient → scinder la livraison, ou refuser avec un message clair
4. Parmi les restants, retenir celui dont (base + perKm × distance) est le plus bas
```

**La distance** se mesure entre l'adresse de récupération du créateur et le
point GPS du client. En v1, distance à vol d'oiseau (Haversine) **majorée d'un
coefficient de sinuosité de 1,3** — sans quoi on sous-facture systématiquement
en ville. Le passage à une distance routière réelle via une API cartographique
est une évolution isolée derrière une interface `DistanceProvider`.

Chaque produit doit donc porter **poids et dimensions**, sinon rien de tout
ceci ne fonctionne. Le document client ne les demande pas dans le formulaire
produit : **il faut les y ajouter** (§ 9, point B).

---

## 4. L'affectation du livreur passe à l'administrateur

| | Mon cahier | Document client |
|---|---|---|
| Affectation | Diffusion aux livreurs, premier arrivé | **L'admin crée les tournées et attribue un livreur** |

Le tableau de bord administrateur du document liste « Créer les tournées »,
« Attribuer un livreur », « Suivre toutes les livraisons ». Le livreur ne
choisit pas ses missions, il les reçoit.

C'est plus simple à construire et plus maîtrisable au lancement. Je conserve
néanmoins un **classement de suggestion** (livreurs disponibles, proches,
véhicule compatible) pour que l'admin ne choisisse pas dans une liste brute —
mais la décision reste la sienne. La notion de tournée (plusieurs missions
groupées pour un livreur) est ajoutée au schéma.

---

## 5. Ce qui se simplifie

Quatre briques de mon cahier disparaissent ou se réduisent. C'est autant de
temps gagné.

| Brique | Décision |
|---|---|
| **Variantes produit** (`ProductVariant`) | **Supprimée.** Le document client décrit un produit avec un prix et une quantité, sans déclinaison. Prix et stock remontent sur `Product`. Réintroductible plus tard sans casse |
| **TVA** | **Mise en sommeil.** Absente du document client. Le champ `vatRate` reste dans `Country`, à 0, et la ligne apparaît dans le calcul dès qu'on l'active |
| **Retours sous 30 jours** | **Supprimés.** Le document client est formel : les retours ne sont possibles qu'**au moment de la réception**. Il n'y a pas de fenêtre de rétractation |
| **Messagerie** | **Réduite.** Créateur ↔ administration uniquement. Client ↔ administration pour les réclamations. **Jamais créateur ↔ client**, à aucun moment |

Le remboursement se simplifie aussi : **100 % du prix produit, jamais partiel**.
Les frais de livraison et la commission restent acquis à Ojà.

---

## 6. Les statuts, tels que le document client les nomme

Une seule machine à états par entité, des libellés différents selon qui regarde.
Il faut **reprendre les mots du document client dans l'interface**, sans les
reformuler.

### Vue créateur — sous-commande

| Interne | Affiché au créateur |
|---|---|
| `RECEIVED` | Commande reçue |
| `PAYMENT_CONFIRMED` | Paiement confirmé |
| `IN_PRODUCTION` | En fabrication |
| `READY_FOR_PICKUP` | Prêt à récupérer |
| `IN_DELIVERY` | En cours de livraison |

Le passage en « En fabrication » ouvre un compte à rebours égal au **délai de
fabrication saisi sur le produit**.

### Vue client — commande

| Interne | Affiché au client |
|---|---|
| `CONFIRMED` | Commande confirmée |
| `IN_PRODUCTION` | En fabrication |
| `PREPARING` | En préparation |
| `IN_DELIVERY` | En livraison |
| `DELIVERED` | Livrée |

### Vue livreur — mission

| Interne | Affiché au livreur |
|---|---|
| `TO_PICK_UP` | À récupérer |
| `PICKED_UP` | Récupéré |
| `IN_DELIVERY` | En livraison |
| `DELIVERED` | Livré — **basculé par la confirmation du client** |
| `RETURN_REQUIRED` | Produit à retourner — si le client signale un problème |

---

## 7. Le paiement est isolé derrière une interface

Puisque l'agrégateur arrive en dernier, **rien ne doit l'attendre**. Le module
paiement est réduit à une interface, avec deux implémentations :

```ts
// packages/domain/payment/provider.ts
export interface PaymentProvider {
  initiate(input: InitiatePayment): Promise<{ reference: string; checkout: CheckoutConfig }>;
  verify(reference: string): Promise<PaymentStatus>;
  parseWebhook(rawBody: Buffer, signature: string): WebhookEvent;
}
```

| Implémentation | Rôle |
|---|---|
| `SimulatedPaymentProvider` | **Développement et recette.** Un endpoint d'administration marque un paiement comme confirmé, exactement comme le ferait un webhook. Tout le parcours — commande, fabrication, livraison, validation, versement — se teste de bout en bout **sans agrégateur** |
| `KadevPayProvider` | Branché en dernier lot. Le reste du code ne change pas d'une ligne |

**Le grand livre en partie double, lui, se construit tout de suite.** Il ne
dépend pas de l'agrégateur, et c'est lui qui rend le reste juste. Un
encaissement simulé écrit les mêmes écritures qu'un encaissement réel.

De la même façon, les versements aux créateurs sont d'abord **enregistrés
comme dus** dans le grand livre ; leur exécution effective (Mobile Money) est
le dernier maillon.

---

## 8. Le nouvel ordre des lots

Le paiement passe de L3 à L9. Le chemin critique n'est plus l'argent, c'est le
**cycle de vie de la commande**.

| Lot | Contenu | Durée | Change ? |
|---|---|---|---|
| **L0** | Socle : monorepo, Prisma, auth, RBAC | 3 sem | inchangé |
| **L1** | Catalogue, recherche, comptes créateurs (public/privé, IFU, RCCM), validation admin | 4 sem | +séparation public/privé |
| **L2** | Panier, calcul du prix final, commande, sous-commandes | 3 sem | modèle de commission revu |
| **L3** | **Cycle de vie complet** : statuts créateur, client, fabrication, préparation | 3 sem | **nouveau, remonté** |
| **L4** | Logistique : distance, choix du véhicule, tournées, missions, suivi | 4 sem | recalcul au réel |
| **L5** | **Validation à la réception** + litiges + retours + grand livre | 3 sem | **cœur du système** |
| **L6** | Tableaux de bord : créateur, client, livreur, portefeuille | 3 sem | remonté |
| **L7** | Back-office administrateur complet | 3 sem | inchangé |
| **L8** | Messagerie, notifications, durcissement | 3 sem | messagerie réduite |
| **L9** | **Agrégateur de paiement + versements réels** | 3 sem | **repoussé en dernier** |
| — | *Juridique, ARTCI, CGU, qualification BCEAO* | — | **en parallèle, hors chemin critique** |

**Ce que ça donne** : à la fin de L6, l'application est **entièrement
fonctionnelle avec un paiement simulé**. Vous pouvez la montrer, la faire
tester par de vrais créateurs et de vrais livreurs, et corriger le parcours —
avant même d'avoir signé avec l'agrégateur.

C'est exactement ce que vous demandez, et c'est le bon ordre.

---

## 9. Ce que je n'ai pas pu trancher seul

Six points. Aucun ne bloque le démarrage de L0, tous bloquent un lot précis.

**A — Validation automatique si le client ne clique pas.** Le document ne le
prévoit pas. Sans délai par défaut, un client passif prive le créateur de son
paiement indéfiniment. Je propose **72 heures après le passage en « Livré »**,
avec relance SMS à 24 h et 48 h. *Bloque L5.*

**B — Poids et dimensions des produits.** Le formulaire du document client ne
les demande pas, mais le choix automatique du véhicule en dépend entièrement.
Il faut les rendre **obligatoires à la création d'un produit**. *Bloque L4.*

**C — Une commande, plusieurs créateurs.** Le document ne dit pas ce qui se
passe quand un panier contient des produits de deux ateliers différents. Mon
modèle éclate en sous-commandes, avec **une livraison par créateur** — donc
plusieurs frais de livraison sur une même commande. À confirmer, car cela se
voit sur la facture. *Bloque L2.*

**D — Qui paie quand un créateur refuse ou ne répond pas.** Le document ne
prévoit ni refus, ni délai de réponse du créateur. Je propose : **48 heures
pour accepter**, silence valant refus, et remboursement intégral de la ligne
concernée. *Bloque L3.*

**E — Le virement bancaire comme moyen de paiement.** Le document le liste, mais
un virement n'est pas confirmable en temps réel : il faudrait un rapprochement
manuel par l'administration. Je propose de **ne pas l'ouvrir en Phase 1**.
*Bloque L9, donc sans urgence.*

**F — Rémunération du livreur.** Le document décrit ce que le client paie mais
jamais ce que le livreur touche. Est-ce la totalité des frais de livraison, un
pourcentage, un forfait par course ? *Bloque L5.*

---

## 10. Corrections déjà appliquées au front

Deux affirmations de la page d'accueil contredisaient le document client. Elles
sont corrigées :

| Avant | Après |
|---|---|
| « Retour sous 30 jours » | « Validation à la réception » — conforme à la règle métier |
| « 100 % des paiements par Mobile Money » | « Mobile Money, carte ou virement » |

---

*Ce document remplace le cahier des charges sur tous les points qu'il traite.
Là où il est muet, le cahier des charges continue de faire foi.*
