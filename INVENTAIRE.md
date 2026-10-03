# Ojà — inventaire complet

**15 août 2026 · 162 tâches sur 234 · 308 tests au vert**

Ce document dit **tout** : ce qui existe et fonctionne, ce qui manque, ce qui
est cassé, et ce qui attend une décision. Il est plus détaillé que
[`ETAT-PROJET.md`](ETAT-PROJET.md), qui en est le résumé.

Chaque affirmation est vérifiable par une commande. Les chiffres viennent du
code, pas d'une estimation.

---

## 1. En un coup d'œil

| | |
|---|---|
| **Ce qui marche** | Le parcours complet, des quatre profils, de l'inscription au versement programmé |
| **Ce qui manque** | L'encaissement réel et l'exécution des virements |
| **Ce qui bloque** | Un compte marchand Kadev Pay, et six décisions de votre côté |
| **Ce qui est cassé** | Trois défauts connus, dont un formulaire de contact qui ment (§ 8) |

Le système tourne aujourd'hui avec un **fournisseur de paiement simulé**. Ce
n'est pas une maquette : il écrit les mêmes écritures comptables, déclenche les
mêmes états, programme les mêmes versements. Seul le dernier maillon — le débit
réel du client et le virement réel au créateur — est débranché.

---

## 2. Ce qui est fait

### 2.1 Le socle

| Élément | État | Détail |
|---|---|---|
| Monorepo | ✅ | 5 espaces de travail npm : `web`, `api`, `db`, `domain`, `contracts` |
| Base de données | ✅ | PostgreSQL 16, **39 modèles**, 6 migrations |
| Logique métier isolée | ✅ | `packages/domain` ne dépend ni de la base, ni de HTTP, ni d'un framework |
| Contrats partagés | ✅ | Schémas Zod utilisés par l'API **et** le front — une seule définition des règles |
| Configuration validée | ✅ | L'API refuse de démarrer mal configurée, plutôt que de tourner à moitié |
| Erreurs normalisées | ✅ | RFC 9457, avec les erreurs champ par champ pour les formulaires |
| Conteneurs | ✅ | Deux images multi-étages, sans privilège, **vérifiées au démarrage** |
| Intégration continue | ✅ | Migrations → types → tests (Postgres et MinIO réels) → build → images |

**Le refus de démarrer** mérite un mot : l'API rejette une clé de paiement de
test en production, et une clé de production hors production. C'est le genre de
confusion qui coûte de l'argent réel, une fois.

### 2.2 Authentification et accès

| Élément | État | Détail |
|---|---|---|
| Inscription et connexion | ✅ | Par e-mail **ou** téléphone — le téléphone est l'identité sur ce marché |
| Mots de passe | ✅ | argon2id avec poivre applicatif, temps de vérification constant |
| Sessions | ✅ | JWT court + jeton de rafraîchissement rotatif, cookies `httpOnly` |
| Détection de rejeu | ✅ | Un jeton déjà consommé ferme **toutes** les sessions de l'utilisateur |
| Confirmation d'adresse | ✅ | Par lien, jeton de 32 octets, à usage unique |
| Mot de passe oublié | ✅ | Code par e-mail, toutes les sessions fermées au changement |
| Changement de mot de passe | ✅ | L'ancien est exigé ; la session courante survit, les autres tombent |
| Rôles | ✅ | Gardes **globaux** : tout est fermé par défaut, l'ouverture est explicite |
| Anti-énumération | ✅ | Un accès non autorisé renvoie `404`, jamais `403` |
| Limitation de débit | ✅ | Connexion, inscription, codes, preuve de remise — par utilisateur quand il est connu |

**Pourquoi 404 et pas 403 :** un `403` confirme que la ressource existe. Sur une
place de marché, cela suffit à énumérer le catalogue non publié de la
concurrence, ou à savoir si une adresse e-mail a un compte.

### 2.3 Catalogue

| Élément | État |
|---|---|
| Boutiques créateurs, séparation stricte public / privé | ✅ |
| Dossier de validation, pièces justificatives, décision motivée | ✅ |
| Fiches produit, 3 à 5 photos, modération avant publication | ✅ |
| Recherche plein texte française, insensible aux accents, index GIN | ✅ |
| Facettes, filtres, tri, pagination par curseur | ✅ |
| Vitrine publique d'un atelier | ✅ |
| Cache du catalogue | ❌ |

**Il n'y a aucun cache.** Chaque affichage du catalogue frappe la base. Les
index sont en place et les temps de réponse tiennent au volume actuel, mais
c'est le premier point à surveiller à la montée en charge.

**La séparation public / privé est tenue par une fonction unique**, pas par la
prudence de chaque contrôleur. Le jour où l'on ajoute un champ privé, il ne peut
pas fuiter par une route qu'on aurait oublié de relire. Un test vérifie
mécaniquement qu'aucun champ privé ne traverse.

### 2.4 Commande et paiement

| Élément | État | Détail |
|---|---|---|
| Panier serveur | ✅ | Dès le premier clic, sans compte, fusionné à la connexion |
| Chiffrage | ✅ | **Une livraison par atelier**, distance mesurée, véhicule choisi automatiquement |
| Trois lignes de prix | ✅ | Prix créateur / commission Ojà / prix final, visibles avant l'achat |
| Passage de commande | ✅ | Éclatement en sous-commandes, gel de tout ce qui a une portée comptable |
| Réservation de stock | ✅ | Avant le moindre paiement |
| Encaissement | ✅ | Client Kadev Pay, veille au corps brut, montants en points de base |
| Webhook, signature HMAC, idempotence | ✅ | SHA-512 à temps constant, une notification rejouée ne double rien |
| Compte marchand réel | ⚠️ | Codé contre leur documentation publique — **jamais essayé contre un vrai compte**, faute de clés |
| Grand livre | ✅ | Partie double stricte, alimenté à chaque encaissement, annulation et frais |

**Le modèle de commission est celui du cahier client** : elle **s'ajoute** au
prix du créateur, elle ne s'en déduit pas. Un artisan qui fixe 85 000 F touche
85 000 F ; le client voit 89 250 F. C'est vérifié en base par une contrainte
`CHECK`, pas seulement dans le code.

**Les invariants du grand livre sont garantis par PostgreSQL :**

- une écriture ne peut être **ni modifiée ni supprimée** (déclencheur) ;
- une transaction déséquilibrée est **refusée au `COMMIT`** (contrainte différée).

Une correction se fait par contre-passation, comme en comptabilité réelle.

### 2.5 Logistique

| Élément | État |
|---|---|
| Création de l'expédition dès qu'une pièce est prête | ✅ |
| Choix du véhicule : moto, tricycle, camionnette | ✅ |
| Affectation du livreur par l'administration, avec livreurs éligibles proposés | ✅ |
| Tournées : plusieurs missions groupées | ✅ |
| Enlèvement, départ, remise | ✅ |
| **Preuve de remise** : code client, photo, position — deux sur trois | ✅ |
| Code de réception envoyé au client par SMS avant l'arrivée du livreur | ✅ |
| Dossier livreur : identité, permis, carte grise | ✅ |
| Suivi de position en temps réel | ❌ |

**La preuve de remise est le verrou du circuit financier.** Sans elle, pas de
remise ; sans remise, pas de validation ; sans validation, pas de versement.
C'est aussi pour cela qu'elle est protégée par une limitation de débit : le code
ne fait que quatre chiffres, et dix mille essais le trouveraient en quelques
minutes.

### 2.6 Validation et versements

| Élément | État |
|---|---|
| Le client valide la réception, **colis par colis** | ✅ |
| Le client signale un problème → réclamation ouverte, colis à retourner | ✅ |
| Validation automatique si le client ne répond pas (72 h) | ✅ |
| Relances avant la validation automatique | ✅ |
| Versement **programmé** 24 h après la validation | ✅ |
| Versement **exécuté** (virement réel) | ❌ |
| Lots de versement, double validation, export opérateur | ❌ |

Le grand livre sait exactement ce qui est dû à chaque atelier, à l'unité près,
et à quelle date. Il manque le geste final.

### 2.7 Réclamations

| Élément | État |
|---|---|
| Client et créateur parlent **chacun à Ojà**, jamais l'un à l'autre | ✅ |
| Fil de discussion, notes internes invisibles des parties | ✅ |
| Arbitrage : rembourser ou rejeter, motivé | ✅ |
| Choix explicite : rendre aussi la livraison (geste commercial) | ✅ |
| Choix explicite : qui supporte la perte, le créateur ou Ojà | ✅ |
| Délai de traitement suivi, dépassement signalé | ✅ |
| Avis clients | ✅ |

### 2.8 Les quatre espaces

**41 pages**, toutes vérifiées en réponse `200` sur données réelles.

#### Client — `/compte`

| Page | Ce qu'on y fait |
|---|---|
| Mes commandes | Les colis en attente de confirmation **en tête**, puis l'historique |
| Détail d'une commande | Confirmer la réception ou signaler un problème, **par colis** |
| Mes réclamations | Le fil de discussion avec Ojà |
| Mes adresses | Carnet, avec le point de repère mis en avant |
| Mon profil | Identité, identifiants, changement de mot de passe |

Cet espace **ne figurait pas au cahier**. Il a été ajouté parce que le clic de
validation du client décide du sort de l'argent : sans écran, chaque commande
attendait la validation automatique de 72 h.

#### Créateur — `/espace-createur`

| Page | Ce qu'on y fait |
|---|---|
| Tableau de bord | Les commandes à accepter d'abord, puis six chiffres cliquables |
| Mes pièces | Liste, état, photos sur 5, stock réservé distingué du disponible |
| Fiche produit | Prix décomposé **en direct** : votre prix / commission / prix vitrine |
| Photos | Glisser-déposer, envoi direct au stockage, choix de la vignette |
| Commandes | Accepter, refuser avec motif, signaler prête |
| Portefeuille | Versements ligne à ligne, et le calendrier expliqué |
| Ma boutique | Vitrine, informations privées, adresse d'enlèvement, pièces, dépôt |

Le bandeau d'état du dossier suit sur **toutes** les pages. Un artisan dont le
dossier est refusé doit le voir partout, pas seulement là où il pense à aller.

#### Livreur — `/espace-livreur`

| Page | Ce qu'on y fait |
|---|---|
| Missions | Triées par ce qui est **déjà dans le coffre**, pas par date |
| Détail d'une mission | Itinéraires, appel du client, une seule action visible à la fois |
| Preuve de remise | Décompte en direct des deux éléments sur trois |
| Historique | Courses terminées — le numéro du client n'y figure plus |
| Gains | Frais encaissés, versements, et la mention que le barème n'est pas arrêté |
| Profil | Véhicule, plaque, pièces justificatives, dépôt du dossier |

**Seul espace à ne pas utiliser la barre latérale**, et c'est délibéré : le
livreur travaille dehors, en mouvement, sur un téléphone tenu d'une main. La
navigation descend en bas, à portée du pouce ; les cibles ne descendent jamais
sous 44 px. Un menu qu'on ouvre au coin supérieur gauche, casque sur la tête, ne
s'ouvre pas.

#### Administration — `/admin`

| Page | Ce qu'on y fait |
|---|---|
| Vue d'ensemble | Les cinq files qui bloquent quelqu'un d'autre |
| Dossiers créateurs | Pièces justificatives en URL courte durée, validation motivée |
| Dossiers livreurs | Identité, permis, carte grise |
| Fiches à valider | Photos, description, dimensions — de quoi décider vraiment |
| Expéditions | Affectation, avec les livreurs éligibles proposés |
| Rechercher | Par référence, nom ou téléphone |
| Réclamations | Arbitrage à trois décisions distinctes |
| Grand livre | Soldes, écritures, contrôle des invariants — lecture seule |
| Journal d'audit | Qui a décidé quoi, et quand |
| Réglages | Pays, grilles de livraison, moyens de paiement |
| Outils | Tâches périodiques et paiement simulé |

### 2.9 Ce qui tourne sans personne

Quatre échéances du cahier client s'exécutent seules :

| Tâche | Cadence | Effet |
|---|---|---|
| Validation automatique | Chaque heure | Valide les livraisons sans réponse depuis 72 h |
| Libération des versements | Chaque heure | Rend exécutables les versements échus (24 h) |
| Refus au silence | Chaque heure | Annule les commandes non acceptées sous 48 h, rembourse |
| Expiration des paiements | Toutes les 5 min | Libère le stock retenu par un paiement abandonné |

Deux garde-fous : **toutes les tâches sont idempotentes** (les rejouer ne double
rien), et **un verrou consultatif PostgreSQL** empêche deux conteneurs de
libérer deux fois le même versement. Sans lui, la mise à l'échelle horizontale
serait un incident financier.

### 2.10 Avis par e-mail

| Événement | Destinataire | Ce que le message dit |
|---|---|---|
| Commande payée | Créateur | Le contenu, sa part, et **son délai de 48 h** |
| Commande refusée | Client | Le motif, et que le remboursement est intégral |
| Colis livré | Client | Vérifier, puis confirmer — **72 h avant validation automatique** |
| Réception confirmée | Créateur | Versement programmé dans 24 h |
| Course affectée | Livreur | Adresse d'enlèvement, distance, lien direct |
| Dossier tranché | Créateur ou livreur | Validé, ou **le motif du refus** |
| Fiche modérée | Créateur | Publiée, ou le motif |
| Réclamation tranchée | Client | La motivation complète, et le montant remboursé |

Un envoi qui échoue **n'annule jamais l'action métier**. Une commande acceptée
reste acceptée même si le relais SMTP est tombé.

### 2.11 Stockage de fichiers

L'API **ne voit jamais un octet** : elle signe une autorisation, le navigateur
envoie directement au stockage, puis rattache la clé obtenue.

Deux espaces séparés :

- **public** — photos de fiches et de boutiques, URL stables ;
- **privé** — pièces d'identité, permis, cartes grises, preuves de remise.
  **Jamais d'URL stable.** Une URL de lecture n'est délivrée qu'à
  l'administration, à la demande, et pour quelques minutes.

### 2.12 Ce qui est vérifié, et comment

**289 tests**, dont 192 contre une vraie base PostgreSQL et un vrai MinIO.

| Domaine | Tests | Ce qui est prouvé |
|---|---|---|
| Catalogue | 30 | Boutique, dossier, publication, modération, non-fuite des champs privés |
| Livraison | 25 | Véhicules, distances, affectation, preuve de remise |
| Authentification | 22 | Sessions, rejeu, anti-énumération, suspension |
| Cycle de vie | 22 | Acceptation, refus, délais, dérivation des états |
| Machines à états | 22 | Toutes les transitions autorisées et interdites |
| Stockage | 22 | Signatures, bornes, **inaccessibilité des fichiers privés** |
| Réclamations | 18 | Cloisonnement des parties, arbitrage, remboursement |
| Achat | 18 | Panier, chiffrage multi-atelier, propriété des commandes |
| Prix | 16 | Commission ajoutée, arrondis, remboursements |
| Distances et véhicules | 16 | Sinuosité, capacité, choix du moins cher qui convient |
| Progression | 14 | L'état vu par le client dérive de ses sous-commandes |
| Preuve de remise | 14 | Les combinaisons acceptées et refusées |
| États produit | 15 | Cycle de vie, et **tous** les manques listés d'un coup |
| Configuration | 15 | Refus de démarrer mal configuré |
| Espace livreur | 11 | Profil, dossier, **présence dans la liste d'affectation** |
| Limitation de débit | 6 | Seuils, fenêtres, isolation par utilisateur |
| Ordonnanceur | 3 | Les quatre échéances programmées, idempotence, échec avalé |

Ce qui est délibérément testé **contre l'infrastructure réelle** plutôt que
contre des doublures : les invariants du grand livre sont tenus par des
déclencheurs PostgreSQL, l'immuabilité par une contrainte, l'expiration des URL
signées par le stockage. Des doublures rendraient ces tests verts sans rien
prouver.

### 2.13 Parcours déroulé de bout en bout

Le 15 août 2026, à la main, contre PostgreSQL, MinIO et Mailpit réels :

```
inscription créateur → boutique → dossier déposé → validé par l'admin
  → fiche créée → 3 photos envoyées (PUT signé) → mise en vente → publiée
  → client : adresse, panier, chiffrage 91 750 F → commande CMD-2026-000001
  → paiement (simulé) → e-mail au créateur, délai de 48 h ouvert
  → atelier accepte → expédition créée, code SMS au client
  → livreur : profil, permis, carte grise → validé → disponible
  → admin affecte → e-mail au livreur
  → enlèvement → départ → remise refusée avec 1 preuve, acceptée avec 2
  → e-mail au client : 72 h pour confirmer
  → client confirme → versement de 85 000 F programmé
```

**Grand livre à l'arrivée :**

| Compte | Solde |
|---|---|
| Trésorerie Ojà | +89 640 |
| Commissions encaissées | −4 250 |
| Dû au créateur | −85 000 |
| Provision de livraison | −2 500 |
| Frais de l'agrégateur | +2 110 |
| **Somme** | **0** |

Invariants vérifiés : aucun écart.

---

## 3. Ce qui reste — par ordre d'importance

### 3.1 Le paiement réel · 3 semaines · **bloqué par vous**

Tout le circuit existe, seul le dernier maillon est débranché.

- Client HTTP Kadev Pay, délais d'attente, réessais, disjoncteur
- Webhook sur corps brut, **signature HMAC SHA-512**, comparaison à temps constant
- Idempotence : une notification rejouée ne double pas un encaissement
- Contrôle de cohérence : devise, statut, mode, et surtout **le montant**
- Vérification active à l'ouverture de la page de confirmation
- Rapprochement quotidien à 03 h, alerte critique sur tout écart

**Bloqué par :** l'ouverture du compte marchand (P-01).

> **Un point technique déjà établi :** leur exemple d'intégration Node est
> faux. Il calcule la signature sur `JSON.stringify(req.body)`, ce qui
> reconstruit un JSON différent de celui reçu et fait échouer une signature sur
> deux, de façon intermittente. Notre implémentation lira le corps brut.

### 3.2 L'exécution des versements · 2 semaines · **bloqué par vous**

- Constitution hebdomadaire des lots, seuil de 5 000 F, report en dessous
- Écran de revue : bénéficiaires, numéros, montants, commandes rattachées
- **Double validation** : celui qui crée le lot ne peut pas l'approuver
- Export au format de chaque opérateur, import du fichier de retour
- Écriture au grand livre **à l'exécution**, pas à la programmation
- Reprise sur échec, créance négative compensée sur les versements suivants

**Bloqué par :** la réponse de Kadev Pay sur le *split* / sous-comptes (P-02).
Si c'est ouvert, la moitié de ce lot disparaît.

### 3.3 Durcissement avant ouverture · 2 semaines

| Élément | Pourquoi cela compte |
|---|---|
| ~~Idempotence des routes de paiement~~ | **Fait** : `POST /checkout` accepte `Idempotency-Key` (L0-25) |
| Filtre de secrets **dans le logger** | Ni mot de passe, ni code, ni clé dans les journaux |
| Intercepteur d'audit automatique | Aujourd'hui, chaque action trace à la main : une oubliée passe |
| ~~TOTP obligatoire pour les administrateurs~~ | **Fait** (L0-22) : espace admin fermé sans second facteur |
| Traces et alertes | Un webhook en panne doit réveiller quelqu'un |
| **Restauration de sauvegarde réellement testée** | Une sauvegarde jamais restaurée n'est pas une sauvegarde |
| Politique de conservation | 10 ans comptable, 5 ans dossiers, 12 mois technique |
| Anonymisation sur demande d'effacement | Sans détruire les pièces comptables |
| Audit de sécurité externe | Ce document n'en tient pas lieu |
| ~~Bout en bout Playwright~~, charge k6 | Playwright **fait** (L8-02, `e2e/`) ; reste la charge k6 |

### 3.4 Confort — utile, pas bloquant

| Élément | État |
|---|---|
| SMS réels (compte fournisseur nécessaire) | ❌ |
| Suivi du livreur en temps réel (SSE) | ❌ |
| Avis clients et notes | ✅ |
| Facture PDF numérotée | ❌ |
| Codes promo | ❌ |
| Mode dégradé hors ligne pour le livreur | ❌ |
| Retour de colis après litige | ❌ |
| OpenAPI sur `/api/docs` | ❌ |
| Messagerie créateur ↔ administration | ❌ |
| Relance à 48 h au créateur qui n'a pas répondu | ❌ |

---

## 4. Ce qui vous attend — six décisions

Vous avez tranché **un** arbitrage sur six et ouvert **aucun** des comptes.
Trois points sont sur le chemin critique.

### 4.1 La rémunération du livreur — **le plus urgent**

C'est devenu le point le plus visible : l'espace livreur existe, il affiche le
total des frais encaissés sur ses courses, et lui dit franchement que sa part
n'est pas fixée. Un livreur acceptera de rouler quelques jours dans ces
conditions, pas quelques semaines.

Conséquence technique : je provisionne la **totalité** des frais de livraison à
son compte, faute de règle — c'est le choix prudent, on ne compte pas comme
revenu ce qu'on devra peut-être reverser. Mais **la marge réelle d'Ojà sur une
commande reste donc inconnue**.

*Ce qu'il faut décider :* un forfait, un pourcentage, une grille au kilomètre,
ou une combinaison.

### 4.2 Kadev Pay — le *split*

Leur passerelle est, en l'état de ce que j'ai pu observer, **mono-marchand** :
un encaissement va sur un seul compte. Il n'y a pas d'API publique de partage.

Cela a une conséquence lourde : **Ojà encaisse et détient l'argent des
créateurs** avant de le leur reverser. C'est ce qui déclenche la question
réglementaire du § 4.4.

Leur interface manipule déjà des champs de sous-comptes. Si cet accès est
ouvert, la moitié du lot versements disparaît et la question réglementaire
s'allège.

### 4.3 La casse en transit

L'écran d'arbitrage pose désormais la question explicitement — une case
« imputer la perte au créateur », à décocher quand la casse est survenue pendant
le transport. Elle est cochée par défaut, faute de règle.

Sans texte, chaque litige reste une négociation, et deux agents trancheront
différemment le même dossier.

### 4.4 Ce qui ne bloque pas le développement, mais bloque l'ouverture

| Sujet | Pourquoi |
|---|---|
| Qualification BCEAO | Ojà détient des fonds de tiers. C'est une activité réglementée |
| Statut marchand Kadev Pay | Couvre-t-il une activité de place de marché ? |
| Déclaration ARTCI, registre des traitements | Données personnelles, pièces d'identité |
| Trois CGU distinctes | Client, créateur, livreur — les obligations diffèrent |
| Taux de TVA par pays | Le champ existe, il est à zéro tant que rien n'est confirmé |
| Taux de commission plancher | En tenant compte des 2,3 % Mobile Money absorbés |

### 4.5 Les comptes à ouvrir

PostgreSQL managé, stockage S3, Sentry, un service d'envoi d'e-mails, un
agrégateur SMS. **Vérifier la couverture Côte d'Ivoire** pour les deux
derniers — tous les fournisseurs ne desservent pas la zone.

---

## 5. Décisions techniques prises, et pourquoi

Les points où j'ai tranché, pour que vous puissiez revenir dessus en
connaissance de cause.

| Décision | Raison |
|---|---|
| **Commission ajoutée**, pas déduite | Le cahier client. L'artisan touche son prix en entier |
| **Une livraison par atelier** | Deux ateliers, deux enlèvements. C'est la réalité du terrain, et le client doit le voir **avant** de payer |
| Montants en **entiers**, jamais de flottants | Le franc CFA n'a pas de sous-unité d'usage. Un flottant sur un montant finit par coûter un franc, puis une réconciliation |
| **Poids et dimensions obligatoires** | Absents du cahier, mais le choix du véhicule en dépend entièrement. Sans eux, aucune commande ne peut être chiffrée |
| Validation automatique à **72 h** | Absente du cahier. Sans échéance, un client passif prive indéfiniment un créateur qui a fait son travail |
| Refus au silence à **48 h** | Absent du cahier. Sans elle, une commande reste bloquée sur un atelier injoignable, argent immobilisé |
| Vérification SMS **mise de côté** | Votre remarque était juste : sur une application web, l'e-mail suffit au départ. Le SMS reviendra pour les opérations sensibles |
| Références **sans trou** | Compteur en table, pas séquence PostgreSQL : une séquence consomme son numéro même sur transaction annulée. Une numérotation comptable ne peut pas avoir de trous |
| Pagination **par curseur** | Au-delà de quelques milliers de lignes, `OFFSET` fait relire à PostgreSQL tout ce qu'il saute |
| Ordonnanceur **cron**, pas BullMQ | Quatre tâches périodiques idempotentes ne justifient pas une dépendance Redis. À revoir si des files de travail apparaissent |
| Compteurs de débit **en mémoire** | Un stockage partagé ferait dépendre l'authentification de Redis : une panne de cache fermerait la porte à tout le monde |

---

## 6. Écarts par rapport au cahier client

Documentés en détail dans [`SPEC-ALIGNEMENT.md`](SPEC-ALIGNEMENT.md).

| Sujet | Cahier | Ce qui est fait | Pourquoi |
|---|---|---|---|
| Commission | Ambigu à la première lecture | **Ajoutée** au prix créateur | Confirmé avec vous |
| Livraison multi-ateliers | Non traité | **Séparée par atelier** | Votre décision |
| Affectation du livreur | Par l'administration | Idem | Conforme |
| Délai de versement | 24 h après validation | Idem | Conforme |
| Remboursement | 100 % du prix produit | Idem, livraison et commission retenues | Conforme |
| Validation automatique | Non prévue | **72 h**, paramétrable | À confirmer |
| Réponse du créateur | Non prévue | **48 h**, paramétrable | À confirmer |
| Rémunération du livreur | Non traitée | Provision totale, en attente | **Ouvert** |
| Virement bancaire créateur | Évoqué | Hors phase 1 | Mobile Money d'abord |

---

## 7. Ce qui a été trouvé en vérifiant

Trois pannes qu'aucune relecture n'aurait attrapées, et qui ont chacune laissé
un test derrière elles.

**Un livreur validé n'apparaissait dans aucune liste d'affectation.** Son
dossier passait à « validé », mais son compte utilisateur restait « en
attente », et la liste d'affectation ne retient que les comptes actifs. Validé,
disponible, et pourtant introuvable — les deux côtés semblaient corrects.

**`z.coerce.boolean()` transforme `"false"` en `true`.** Il applique
`Boolean()`, et `Boolean("false")` vaut `true`. Le réglage qui désactivait la
vérification par SMS la réactivait donc en silence, **et bloquait toutes les
connexions**. Remplacé par une lecture explicite de la chaîne, avec trois tests
de non-régression.

**Prisma supprime l'index de recherche à chaque migration touchant les
produits.** Quatre fois. Il ne comprend pas les objets définis en SQL brut sur
une colonne qu'il ne sait pas typer, et les prend pour des restes à nettoyer.
Laisser passer ce `DROP` ne casserait rien de visible : la recherche
continuerait de répondre, en balayage séquentiel, jusqu'à s'effondrer sur un
vrai volume. Un script le refuse maintenant en intégration continue.

---

## 8. Défauts connus

**Le formulaire de contact ment.** Il affiche « message envoyé » sans rien
envoyer — aucune route d'API derrière. C'est plus grave qu'une fonction
manquante : un visiteur croit avoir écrit et attend une réponse qui ne viendra
jamais. À corriger ou à désactiver avant toute mise en ligne. *(L6-13)*

**Le journal d'audit n'est pas automatique.** Chaque action l'écrit à la main.
Une action ajoutée sans sa ligne d'audit passera inaperçue. *(L0-31)*

**Les compteurs de limitation de débit sont par instance.** À plusieurs
conteneurs, la limite effective est multipliée par leur nombre. Reste très
au-dessous du seuil de nuisance, mais ce n'est pas une limite globale.

**Le passage de commande est idempotent** *(L0-25, fait)*. Le site envoie une
`Idempotency-Key` par intention : un double clic ou une requête rejouée retrouve
la commande déjà créée. Les futures routes de versement et de remboursement
devront porter `@Idempotent()` elles aussi.

**Le catalogue n'a aucun cache.** Chaque affichage frappe PostgreSQL. Tenable au
volume actuel, à revoir avant l'ouverture. *(L1-22)*

### Trois cases cochées à tort, corrigées en écrivant ce document

Écrire cet inventaire a servi à quelque chose : trois lignes du backlog étaient
marquées faites alors qu'elles ne l'étaient pas.

| Ligne | Ce qui était annoncé | La réalité |
|---|---|---|
| L1-22 | Cache Redis du catalogue | **Aucune dépendance Redis dans le projet** |
| L3-26 | Simulateur Kadev Pay rejouant les webhooks | Un fournisseur simulé existe, mais **ni webhook ni vérification de signature** |
| L4-14 | Transition à **J+7** | Elle se fait à **72 h** — écart assumé, mais il n'était pas écrit |

Deux autres lignes étaient au contraire marquées à faire alors qu'elles étaient
faites (dépôt des pièces créateur, dossier livreur). Le décompte net passe de
146 à **144**.

---

## 9. Vérifier vous-même

```bash
npm install
cp .env.example .env

npm run infra:up               # PostgreSQL, MinIO, Mailpit
npm run db:migrate
npm run db:seed                # pays, villes, catégories, tarifs
npm run db:demo                # un atelier validé et 4 pièces publiées

npm run typecheck              # 0 erreur attendue
npm test                       # 289 tests attendus
npm run build

npm run api                    # http://localhost:4000/api/v1
npm run web                    # http://localhost:3000
```

Les quatre espaces : `/compte`, `/espace-createur`, `/espace-livreur`, `/admin`.
Les e-mails partent dans Mailpit, lisibles sur <http://localhost:58025>.

Pour dérouler un parcours complet sans agrégateur, l'écran `/admin/outils`
permet de simuler un paiement et de déclencher les tâches périodiques à la main.

Les conteneurs :

```bash
docker build -f apps/api/Dockerfile -t oja-api .
docker build -f apps/web/Dockerfile -t oja-web .
```

---

## 10. Décompte, lot par lot

| Lot | Fait | Reste | Lecture |
|---|---|---|---|
| **§ 0 — Pré-requis** | 0 | 12 | ⚠️ Rien n'est technique. Tout vous revient |
| **L0 — Socle** | 24 | 11 | Reste OpenAPI, idempotence, TOTP, secrets, traces |
| **L1 — Catalogue** | 24 | 1 | Reste le cache du catalogue |
| **L2 — Commande** | 18 | 2 | Reste facture PDF et codes promo |
| **L3 — Paiement** | 24 | 2 | Client, webhook, vérification active : faits. Reste rapprochement quotidien et essai réel |
| **L4 — Logistique** | 18 | 4 | Reste suivi temps réel, majorations, relance d'affectation |
| **L5 — Versements** | 1 | 11 | Le montant dû est connu ; **le virement n'existe pas** |
| **L6 — Service client** | 10 | 4 | Reste avis clients et formulaire de contact |
| **L7 — Back-office** | 11 | 5 | Reste lots de versement, remboursements, MFA |
| **LN — Notifications** | 3 | 7 | Les avis e-mail partent. Le SMS et les gabarits, non |
| **L8 — Durcissement** | 0 | 12 | Rien. Normal à ce stade |
| **Front** | 28 | 2 | Les quatre espaces fonctionnent |
| **Total** | **162** | **72** | |

**69 % ne veut pas dire « à 69 % du chemin ».** Les lots métier — ceux qui
définissent ce qu'Ojà fait — sont à plus de 85 %, et les quatre interfaces
existent. Le décompte reste bas parce qu'il inclut douze pré-requis juridiques
et administratifs entièrement de votre côté, un lot paiement suspendu à Kadev
Pay, et un lot de durcissement qui ne se fait qu'à l'approche de l'ouverture.

---

## 11. Ce que je propose

| Ordre | Quoi | Durée | Dépend de |
|---|---|---|---|
| 1 | **Fixer la rémunération du livreur** | — | vous |
| 2 | Corriger le formulaire de contact | 1 j | rien |
| 3 | Agrégateur de paiement | 3 sem | compte marchand Kadev Pay |
| 4 | Exécution des versements | 2 sem | réponse sur le *split* |
| 5 | Durcissement et mise en service | 2 sem | juridique |

Le point 1 ne coûte rien en développement et débloque le recrutement des
livreurs, qui prend du temps. Il peut avancer en parallèle du reste.

---

*Document produit le 15 août 2026. Chiffres issus de `npm run typecheck`,
`npm test` et du décompte de [`BACKLOG-BACKEND.md`](BACKLOG-BACKEND.md). Le
parcours du § 2.13 a été déroulé à la main contre PostgreSQL, MinIO et Mailpit
réels. Rien ici n'est déclaratif : tout est reproductible avec le § 9.*
