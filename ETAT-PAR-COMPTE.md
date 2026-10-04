# Ojà — état par espace utilisateur

**23 août 2026**

Complète [`ETAT-PROJET.md`](ETAT-PROJET.md) (vue par lot) avec une vue par
espace : ce qu'une personne qui arrive dans chacun des quatre profils peut
réellement faire aujourd'hui, et ce qui lui manque encore.

---

## 1. Client — `/compte`

**Accès.** Réservé aux personnes connectées. Sans session, la nav bar affiche
« Se connecter » ; une fois connecté, « Mon compte » renvoie bien vers
l'espace personnel (le bouton pointait à tort vers le catalogue — corrigé).

**Site public, une fois connecté** (vaut aussi pour le créateur et le livreur) :
les appels à créer un compte — « Vendre sur Ojà », « Devenir livreur », cartes
« Rejoindre Ojà » de l'accueil, encart créateur de « À propos » — ne
s'affichent plus, et `/connexion` ou `/inscription` renvoient dans l'espace.
L'administrateur, lui, voit le site public comme un visiteur.

**Ce qui existe et fonctionne :**
- Inscription et connexion par e-mail + mot de passe, téléphone obligatoire,
  avec validation de chaque champ en direct (message vert/rouge sous le champ,
  toast de confirmation à la soumission).
- **Adresses** : liste des adresses de livraison enregistrées, ajout, choix
  par défaut.
- **Profil** : informations du compte, changement de mot de passe.
- **Commandes** : liste des commandes passées ou en cours, détail par
  sous-commande (une par atelier), confirmation de réception.
- **Réclamations** : ouverture d'un litige depuis une commande, fil de
  messages avec l'équipe Ojà.
- Déconnexion.
- Catalogue, fiche produit, panier, passage en caisse, page de confirmation —
  tout lit des données réelles.
- Barre de recherche uniquement sur `/catalogue` (l'icône dans la nav bar a
  été retirée, elle ne menait nulle part d'utile).
- Page « À propos » distincte de l'accueil (elle affichait le même contenu
  avant).

**Ce qui manque :**
- **Connexion Google** : seule la préparation en base existe (colonne
  `googleId`, mot de passe devenu facultatif). Ni bouton, ni route, ni écran
  « compléter mon inscription » ne sont codés — le chantier n'a pas commencé.
- Codes promo côté client (cf. lots L2/L6 de l'état global). La **facture PDF**
  existe : émise à l'encaissement, téléchargeable depuis la commande dès le
  paiement. Les **avis** sont faits : une fois la réception validée, chaque pièce
  se note depuis la commande.

---

## 2. Fabricant — `/espace-createur`

**Accès.** Un parcours **bloquant** a été mis en place : juste après
l'inscription, seule la page « Ma boutique » est accessible tant que la
boutique n'est pas renseignée *et* le dossier KYC déposé (nom, ville,
contact, adresse d'enlèvement, IFU…). Le reste de l'espace — produits,
commandes, portefeuille — reste inatteignable (redirection forcée, menu
réduit) jusqu'à ce dépôt.

En phase de test, remplir le formulaire suffit à débloquer l'espace — la
vérification réelle (validation e-mail/téléphone/pièces côté admin) reste à
brancher pour la mise en production.

**Ce qui existe et fonctionne, une fois débloqué :**
- **Boutique** : fiche atelier, dossier KYC.
- **Produits** : création, édition, galerie photo, soumission à modération,
  publication après validation admin.
- **Commandes** : réception des sous-commandes, acceptation/refus.
- **Portefeuille** : suivi de ce qui est dû par commande.

**Ce qui manque :**
- **Exécution réelle des versements.** Le montant dû à chaque atelier est
  connu et programmé (+24 h après validation), mais rien ne déclenche
  aujourd'hui le virement — dépend de l'accès Kadev Pay et de la question du
  *split* non tranchée (cf. `ETAT-PROJET.md` § 3-4).
- Validation admin par e-mail/SMS/pièce réelle (aujourd'hui : dossier rempli
  = validé, pour les tests).

---

## 3. Livreur — `/espace-livreur`

**Accès.** Profil à créer (permis, carte grise) avant de recevoir des
missions.

**Ce qui existe et fonctionne :**
- Dépôt des pièces (permis, carte grise) et suivi du dossier.
- **Missions** : réception, enlèvement, début de course, remise avec preuve
  (photo/signature).
- **Gains** : total des frais de livraison encaissés sur ses courses.
- **Historique** des courses.

**Ce qui manque :**
- **La part réelle du livreur n'est pas fixée.** L'espace affiche
  honnêtement le total encaissé, mais pas ce qui lui revient — c'est le point
  le plus visible côté livreur, et il bloque aussi le calcul de la marge
  réelle d'Ojà par commande.
- Suivi temps réel, majorations, retour de colis.

---

## 4. Admin — `/admin`

**Ce qui existe et fonctionne :**
- **Ateliers** : validation des dossiers fabricants (approuver/rejeter).
- **Catalogue** : modération des fiches produits avant publication.
- **Commandes** : recherche, détail, suivi.
- **Litiges** : arbitrage des réclamations clients.
- **Livreurs** : validation des dossiers KYC, affectation des courses non
  assignées.
- **Finances** : grand livre, transactions.
- **Journal** : audit des actions.
- **Réglages** : activation des pays — **seul le Bénin est actif
  aujourd'hui**, la structure des sept autres pays UEMOA reste en place mais
  inactive, prête à être rouverte d'un simple bascule sans redéploiement.
- **Outils** : tâches d'ordonnancement manuelles.

**Double authentification** : obligatoire pour l'espace admin. Un admin qui
ne l'a pas activée y est conduit vers `/double-authentification` ; la page
Administrateurs montre qui l'a activée et permet de la réinitialiser pour un
collègue qui a perdu son téléphone.

**Ce qui manque :**
- Rapprochement quotidien des paiements, traces et alertes.

---

## 5. Ce qui est transversal (n'appartient à aucun espace seul)

**Paiement.** Kadev Pay est branché **côté SDK** : le widget encaisse dans le
navigateur avec la vraie clé publique de test, et la confirmation passe par
`verify()` (appel serveur à serveur, vérifié en réel contre leur bac à sable)
sans passer par un webhook. `PAYMENT_PROVIDER=kadevpay` est actif localement.
**Le webhook lui-même n'est pas branché** — il exige une URL publique
joignable depuis internet, qui n'existe pas encore. C'est le sujet en cours :
mettre la plateforme en ligne pour pouvoir l'enregistrer.

**Pays.** Seul le Bénin est ouvert. La structure multi-pays (UEMOA) est
entièrement conservée en base et dans le code ; ouvrir un autre pays sera un
réglage admin, pas un chantier.

---

## 6. Par ordre d'impact, ce qui reste

1. **Mise en ligne** (URL publique HTTPS) — débloque le webhook Kadev Pay et
   permet un test de bout en bout sans dépendre uniquement du SDK.
2. **Exécution réelle des versements** (fabricant et livreur) — dépend de la
   réponse Kadev Pay sur le *split*/sous-comptes.
3. **Connexion Google** — décidée, pas commencée.
4. Le reste : voir `ETAT-PROJET.md` § 3 (SMS réels,
   juridique…).
