# Ojà : ce qui reste à faire

Mis à jour le 4 octobre 2026, après la fusion de la PR #27. Le point d'étape
détaillé (ce qui vient d'être fait, PR ouvertes, diagnostics en cours,
prochaines étapes) est dans [`REPRISE.md`](REPRISE.md).

Pour reprendre : « lis `REPRISE.md` puis `A-FAIRE.md`, et continuons ». Cocher
les cases au fur et à mesure et mettre ces fichiers à jour dans la même PR que
le travail fait.

## Où on en est

- Site en ligne : https://oja.aworix.agency (Vercel). API : Render
  (`oja-api-69ph.onrender.com`, aussi `api.oja.aworix.agency`). Base : Neon.
- Fait et fusionné (PR #1 à #17) : migrations et données de référence au
  démarrage, e-mails par l'API Brevo, session qui se renouvelle, API relayée par
  le site (cookies gardés), gestion des administrateurs depuis le site, service
  client complet (demandes, fil, file d'équipe, formulaire de contact, pièces
  jointes), pages légales, incohérences du front.
- Puis (PR #19 à #27) : newsletter, affichage par rôle, idempotence des
  commandes, double authentification des admins, `npm audit`, tests Playwright,
  garde-fou `COOKIE_DOMAIN`, réseaux sociaux. PR #28 à #32 ouvertes : voir
  `REPRISE.md` § 3.
- Configuration réelle du domaine et des variables : `DEPLOIEMENT.md` § 5 bis.

## 1. Malik (Render et Vercel) — fait

Malik a tout réglé (4 octobre). `COOKIE_DOMAIN` valait `oja.ox`, ce qui
déconnectait tout le monde juste après la connexion : corrigé, et l'API ignore
désormais une valeur incohérente (PR #26).

- [x] Vérifier les variables de l'API sur Render :
  - `MAIL_FROM="Ojà <noreply@oja.aworix.agency>"` et `BREVO_API_KEY`
  - `WEB_ORIGIN=https://oja.aworix.agency` (liens des e-mails)
  - `COOKIE_DOMAIN` vide, ou `oja.aworix.agency` (sa valeur actuelle) ; toute
    autre valeur est ignorée par l'API depuis la PR #26
  - `TRUST_PROXY_HOPS=2`
  - `ADMIN_BOOTSTRAP_EMAIL` (ne sert que tant qu'aucun admin n'existe)
  - `DIRECT_DATABASE_URL` si `DATABASE_URL` passe par le pooler Neon
  - `S3_*` : sans stockage, pas de photos produits, pièces jointes, factures ni
    documents des livreurs
- [x] `NODE_ENV=production` (drapeau `Secure` des cookies)
- [x] Newsletter : créer une liste dans Brevo (Contacts › Listes) et mettre son
  identifiant dans `BREVO_NEWSLETTER_LIST_ID` sur Render. Sans elle, les
  abonnés sont gardés en base mais aucune campagne ne peut leur partir.
- [x] Vercel : `NEXT_PUBLIC_API_URL` reste l'adresse Render ; cliquer « Refresh »
  sur le domaine si Vercel le montre encore en erreur.
- [x] Le prévenir que la PR #15 a réactivé l'e-mail de confirmation à
  l'inscription (son commit l'avait coupé et la CI de main était rouge).

- [ ] Si les photos échouent encore à l'envoi : compartiments
  `<S3_BUCKET>-public` et `<S3_BUCKET>-private`, et règle CORS pour
  `https://oja.aworix.agency` (voir `REPRISE.md` § 4).
- [ ] Chaque admin active sa double authentification à sa prochaine visite de
  l'espace admin, et garde ses codes de secours.

## 2. Princesse

- [ ] Brevo : cliquer « Authenticate » sur `oja.aworix.agency` une fois les
  entrées DNS propagées. **Ne jamais ajouter les entrées NS proposées par Brevo.**
- [ ] Ajouter marcowen.hounton@frstud.fr comme admin : il crée un compte client
  sur le site, puis un admin va dans Admin › Administrateurs et le promeut.
- [ ] Tester en ligne : connexion, rester connecté plus de 15 minutes, accès
  `/admin`, e-mail « mot de passe oublié », envoi d'une demande au support.

## 3. Informations légales

- [ ] Remplir `packages/contracts/src/legal.ts` dès que la société est immatriculée
  (le site **et les factures PDF** le lisent)
  (raison sociale, forme et capital, siège, RCCM, IFU, directeur de la
  publication). Tant que c'est vide, rien ne s'affiche.
- [ ] Faire relire les pages légales par un juriste (CGU, CGV, confidentialité).
- [ ] Confirmer l'autorité compétente citée (APDP au Bénin ; ARTCI si la société
  est en Côte d'Ivoire) et l'adresse `support@oja.market`.

## 4. Site (front)

- [x] Liens des réseaux sociaux du pied de page : Instagram (`@oja.bj`) et la
  page LinkedIn d'Ojà ; X et Facebook retirés tant qu'il n'y a pas de compte.
- [x] Affichage par rôle : les appels à créer un compte ne s'affichent plus
  qu'aux visiteurs (et à l'admin) ; `/connexion` et `/inscription` renvoient
  un compte connecté dans son espace.
- [ ] À trancher : un créateur ou un livreur peut-il acheter ? Aujourd'hui oui
  (aucune restriction côté API).
- [x] Formulaire newsletter du pied de page : enregistre l'abonné en base
  (`newsletter_subscribers`) et le copie dans une liste Brevo.

## 5. Technique

- [x] Cookies : drapeau `Secure` quand `NODE_ENV=production` (déjà en place dans
  `auth.controller.ts` et `cart.controller.ts`).
- [ ] Tables inutilisées `message_threads` et `messages` : décider avec Malik
  avant toute suppression.
- [ ] Parcours livreur complet jamais testé de bout en bout (il faut le stockage S3).
- [ ] Local : Docker ne marche pas sur ce PC (pas de WSL). On utilise Postgres
  portable (voir « Démarrer en local »). Installer WSL si on veut S3 et Mailpit.

## 6. Backlog (voir `BACKLOG-BACKEND.md`)

- [ ] Paiement réel Kadev Pay et URL du webhook
  (`https://api.oja.aworix.agency/api/v1/webhooks/kadevpay`)
- [ ] Versements aux créateurs et livreurs (lot L5)
- [ ] SMS (LN-03)
- [x] Avis clients (L6-11, L6-12) : note et commentaire après réception validée,
  modération dans Admin › Avis clients, avis publiés sur la fiche produit
- [x] MFA des admins (L0-22, L7-16) : obligatoire pour l'espace admin ; page
  `/double-authentification`, réinitialisation dans Admin › Administrateurs
- [ ] Après le déploiement de la MFA : chaque admin l'active à sa prochaine
  visite de l'espace admin (il y est conduit). Garder ses codes de secours.
- [x] Idempotence des requêtes (L0-25) : `POST /checkout` rejoue la commande
  déjà créée pour la même `Idempotency-Key` ; à poser avec `@Idempotent()` sur
  toute future route qui engage de l'argent (versements, remboursements)
- [ ] Dépendances : `npm audit` laisse 7 alertes (aucune critique) qui exigent
  chacune une migration de version majeure, à faire à part :
  - **prisma 6 → 7** : `deepmerge-ts` figé par `@prisma/config` (lecture du
    fichier de configuration, jamais de données utilisateur) ;
  - **next 15 → 16** : `postcss` (compilation des CSS, pas l'exécution) ;
  - **vitest 3 → 5** : outil de test seulement.
- [ ] Durcissement L8 : sauvegardes et test de restauration, alertes,
  tests de charge k6 (Playwright fait : `e2e/`, joué en CI)
- [ ] OpenTelemetry, OpenAPI, cache du catalogue (L1-22)

## 7. Décisions produit en attente (P-01 à P-12)

Rémunération des livreurs, casse pendant le transport, commission minimale,
paiement à la livraison, délai de versement, TVA, validation des CGU.

## Démarrer en local

1. Base : `node start-db.mjs` dans `C:\Users\Princesse\Projets\oja-localdb`
   (Postgres portable, port 55432).
2. API : `npm run api`. Front : `npm run web` (http://localhost:3000).
3. Comptes de test : `oja-localdb\comptes-test.txt` (hors du dépôt, ne pas
   les recopier ici).
