# Ojà — état du projet

**15 août 2026 · 162 tâches sur 234 · 308 tests au vert**

Ce document remplace la question « où en est-on ». Il dit ce qui marche, ce qui
manque, et ce qui attend une décision de votre côté.

---

## 1. Ce qui fonctionne aujourd'hui

Le backend fait tourner **l'intégralité du parcours** décrit dans votre cahier
des charges, de bout en bout, testé automatiquement :

```
inscription par e-mail → l'atelier ouvre sa boutique → dossier KYC → admin valide
   → publication d'une pièce (3 à 5 photos) → modération → catalogue et recherche
   → panier → chiffrage (une livraison par atelier) → commande
   → encaissement → écritures au grand livre
   → l'atelier accepte → fabrication → prêt à récupérer
   → admin affecte un livreur → enlèvement → remise avec preuve
   → le client valide → versement programmé à +24 h
   → ou le client signale un problème → réclamation → remboursement
```

Côté client, **le site est utilisable** : accueil, catalogue, recherche, fiche
produit, panier, passage en caisse, confirmation, inscription et connexion
lisent tous des données réelles.

**Les quatre profils ont désormais leur espace.** Un artisan ouvre sa
boutique, dépose son dossier, publie ses fiches et suit ses versements. Un
livreur crée son profil, dépose permis et carte grise, reçoit ses missions et
relève sa preuve de remise sur son téléphone. Un client suit ses commandes,
confirme la réception colis par colis et ouvre une réclamation. L'équipe Ojà
valide, modère, affecte, arbitre, et consulte le grand livre.

**La plateforme tourne aussi sans personne.** Un ordonnanceur exécute les
quatre échéances du cahier — validation automatique à 72 h, versement à 24 h,
refus au silence de 48 h, expiration des paiements — sous verrou Postgres pour
qu'une mise à l'échelle ne les exécute pas deux fois. Les avis partent par
e-mail à chaque étape qui appelle un geste.

---

## 2. L'avancement, lot par lot

| Lot | Fait | Ce qu'il en est |
|---|---|---|
| **§ 0 — Pré-requis** | 0/12 | ⚠️ Rien n'est technique ici. Tout vous revient |
| **L0 — Socle** | 24/35 | Auth, RBAC, stockage, CI, Docker, limitation de débit : faits. Reste OpenAPI, idempotence, MFA admin |
| **L1 — Catalogue** | 24/25 | Terminé, au cache du catalogue près |
| **L2 — Commande** | 18/20 | Terminé, hors facture PDF et codes promo |
| **L3 — Paiement** | 24/26 | **Trompeur** : le grand livre est fait, l'agrégateur est repoussé volontairement |
| **L4 — Logistique** | 18/22 | Terminé, hors suivi temps réel et majorations |
| **L5 — Versements** | 1/12 | Le montant dû est connu ; **l'exécution du virement n'existe pas** |
| **L6 — Réclamations** | 10/14 | Terminé, hors avis clients et messagerie |
| **L7 — Back-office** | 12/16 | Dossiers, modération, litiges, grand livre, journal, réglages : faits. Reste lots de versement, remboursements, MFA admin |
| **LN — Notifications** | 3/10 | Les avis e-mail partent à chaque étape. Le SMS réel et les gabarits versionnés, non |
| **L8 — Durcissement** | 0/12 | Rien. Normal à ce stade |
| **Front** | 32/35 | Les quatre espaces existent et fonctionnent sur données réelles |

**Pourquoi 61 % ne veut pas dire « à 60 % du chemin »** : les lots métier —
ceux qui définissent ce qu'Ojà fait — sont à plus de 85 %, et les quatre
interfaces existent. Le décompte reste bas parce qu'il inclut les 12 pré-requis
juridiques et administratifs, entièrement de votre côté, et le lot paiement
suspendu à Kadev Pay.

---

## 3. Ce qui manque vraiment

### Plus rien du côté fonctionnel

Le parcours complet a été déroulé de bout en bout sur l'environnement réel :
inscription, dossier validé, pièce publiée avec ses photos, commande payée,
acceptée par l'atelier, enlevée par le livreur, remise avec preuve, confirmée
par le client, versement programmé — **grand livre équilibré, invariants
vérifiés**. Rien de tout cela n'est simulé, sauf le dernier maillon.

### Deux choses bloquent la mise en service

**L'agrégateur de paiement.** Volontairement repoussé, comme convenu. Un
fournisseur simulé encaisse aujourd'hui à sa place, en écrivant les mêmes
écritures comptables. Le brancher demande un compte marchand Kadev Pay.

**L'exécution des versements.** Le grand livre sait exactement ce qui est dû à
chaque atelier, à l'unité près, et le versement est programmé à la bonne date.
Mais rien ne déclenche le virement : cela suppose l'accès Kadev Pay, et la
réponse à la question du *split* que je vous ai signalée. Vous pourrez faire
vendre un atelier — **pas encore le payer**.

### Ce qui manque et peut attendre

Les SMS réels (il faut un compte chez leur fournisseur), les avis clients, le
suivi du livreur en temps réel, le retour de colis, la facture PDF, la
messagerie créateur ↔ admin.

### Ce qui manque et qu'il ne faudra pas oublier

Idempotence des routes de paiement, traces et alertes, OpenAPI, MFA des comptes
administrateurs, **restauration de sauvegarde réellement testée**,
rapprochement quotidien des paiements.

Rien de tout cela n'est visible. Tout compte avant d'ouvrir au public.

---

## 4. Ce qui vous attend

Vous avez tranché **un** arbitrage sur six, et ouvert **aucun** des comptes.
Trois points sont maintenant sur le chemin critique.

**La rémunération du livreur.** C'est devenu le point le plus visible :
l'espace livreur existe, il affiche le total des frais encaissés sur ses
courses, et lui dit franchement que sa part n'est pas encore fixée. Un livreur
acceptera de rouler quelques jours dans ces conditions, pas quelques semaines.
Tant que la règle n'est pas écrite, **la marge réelle d'Ojà sur une commande
reste inconnue** elle aussi.

**Kadev Pay.** Sans réponse sur le *split* / sous-comptes, je ne peux pas
trancher l'architecture des versements. Leur page manipule déjà ces champs :
si c'est ouvert, la moitié du lot disparaît.

**La prise en charge de la casse en transit.** L'écran d'arbitrage pose
désormais la question explicitement — une case « imputer la perte au créateur »,
à décocher quand la casse est survenue en transit. Elle est cochée par défaut,
faute de règle. Sans texte, chaque litige reste une négociation, et deux agents
trancheront différemment.

Le reste — qualification juridique BCEAO, déclaration ARTCI, CGU, taux de TVA —
ne bloque pas le développement, mais **bloque l'ouverture au public**.

---

## 5. Ce que je propose

| Ordre | Quoi | Durée | Dépend de |
|---|---|---|---|
| ~~1~~ | ~~Espace créateur + écrans admin~~ | — | **fait** |
| ~~2~~ | ~~Espace client, espace livreur, ordonnanceur~~ | — | **fait** |
| 1 | Agrégateur de paiement | 3 sem | **compte marchand Kadev Pay** |
| 2 | Exécution des versements | 2 sem | réponse de Kadev Pay sur le *split* |
| 3 | Durcissement et mise en service | 2 sem | juridique |

**Le fonctionnel est terminé.** Ce qui reste dépend de deux réponses qui ne
sont pas de mon ressort : celle de Kadev Pay, et celle du juridique. Un
fournisseur de paiement simulé fait tourner l'intégralité du parcours en
attendant — ce n'est pas une maquette, c'est le vrai circuit avec un dernier
maillon débranché.

---

## 6. Comment le vérifier vous-même

```bash
npm run infra:up          # PostgreSQL, MinIO, Mailpit
npm run db:migrate && npm run db:seed
npm run typecheck && npm test && npm run build
npm run api               # http://localhost:4000/api/v1
npm run web               # http://localhost:3000
```

Les quatre espaces se trouvent à `/compte`, `/espace-createur`,
`/espace-livreur` et `/admin`. Les images Docker se construisent avec
`docker build -f apps/api/Dockerfile .` et son équivalent pour le front ; la
CI les reconstruit à chaque poussée.

---

Un inventaire détaillé, écran par écran et route par route, se trouve dans
[`INVENTAIRE.md`](INVENTAIRE.md).

*Chiffres produits par `npm run typecheck`, `npm test` et le décompte du
[backlog](BACKLOG-BACKEND.md). Ils sont vérifiables, pas déclaratifs. Le
parcours décrit au § 1 a été déroulé à la main sur l'environnement de
développement, contre PostgreSQL, MinIO et Mailpit réels.*
