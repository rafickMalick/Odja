# Ojà — déploiement de test (gratuit)

Objectif : une URL publique pour tester réellement l'envoi d'e-mail, le
paiement Kadev Pay (webhook compris) et le reste, sans payer d'hébergement.
Pas encore la mise en production — un environnement de recette.

## La pile retenue, et pourquoi

| Brique | Service | Pourquoi celui-là |
|---|---|---|
| Front (Next.js) | **Vercel** | Gratuit, zéro configuration pour Next.js, HTTPS automatique |
| API (NestJS) | **Render** (Docker, plan gratuit) | Le `Dockerfile` existant s'y déploie tel quel ; `render.yaml` ci-joint automatise la création |
| Base de données | **Neon** | Postgres gratuit et **persistant** — contrairement à Render, dont le Postgres gratuit expire au bout de 30 jours |
| Photos produits | **Cloudflare R2** | Compatible S3 (le code n'a rien à changer), gratuit jusqu'à 10 Go, pas de frais de sortie |
| E-mail | **Brevo** | SMTP gratuit, 300 e-mails/jour, **livraison réelle** — contrairement à un bac à sable qui ne livre nulle part |
| Redis | *aucun pour l'instant* | `REDIS_URL` est optionnel dans `env.ts` ; inutile tant qu'on teste |

Chaque compte est gratuit et se crée avec une adresse e-mail — aucune carte
bancaire exigée sur ceux listés ici, sauf mention contraire de leur part.

---

## 1. Neon — base de données

1. Créer un compte sur neon.tech, un nouveau projet (région Europe si
   possible, pour rester proche de Render Frankfurt).
2. Copier la **chaîne de connexion** fournie (`postgresql://...`). C'est la
   valeur de `DATABASE_URL`.

## 2. Cloudflare R2 — photos produits

1. Créer un compte Cloudflare, activer **R2** (Object Storage).
2. Créer un bucket, ex. `oja-prod`.
3. Créer un jeton API R2 (accès lecture/écriture sur ce bucket) : il donne
   une **clé d'accès** et une **clé secrète** — ce sont `S3_ACCESS_KEY` et
   `S3_SECRET_KEY`.
4. `S3_ENDPOINT` : `https://<compte>.r2.cloudflarestorage.com` (visible sur
   la page du bucket).
5. Activer l'accès public au bucket (ou un domaine personnalisé) pour obtenir
   `S3_PUBLIC_BASE_URL` — l'URL par laquelle une photo est servie au client.
6. `S3_REGION=auto`, `S3_BUCKET=oja-prod`.

## 3. Brevo — envoi d'e-mail réel

1. Créer un compte sur brevo.com (plan gratuit, 300 e-mails/jour).
2. Dans *Paramètres → SMTP & API → SMTP*, récupérer :
   `SMTP_HOST` (`smtp-relay.brevo.com`), `SMTP_PORT` (`587`),
   `SMTP_USER`, `SMTP_PASSWORD` (une clé SMTP, pas le mot de passe du compte).
3. Vérifier l'expéditeur (`MAIL_FROM`) dans Brevo, sans quoi les e-mails
   partiront en spam ou seront refusés.

## 4. Render — API

Le fichier [`render.yaml`](render.yaml) à la racine décrit le service : il
suffit de le connecter, pas de le reconfigurer à la main.

1. Créer un compte sur render.com, connecter le dépôt GitHub `Odja`.
2. *New → Blueprint*, sélectionner le dépôt : Render lit `render.yaml` et
   propose de créer le service `oja-api` (Docker, plan gratuit).
3. Les variables marquées `sync: false` dans `render.yaml` demandent une
   valeur manuelle au moment de la création — à remplir avec les valeurs
   obtenues aux étapes 1 à 3 :

   | Variable | Valeur |
   |---|---|
   | `DATABASE_URL` | chaîne Neon |
   | `WEB_ORIGIN` | URL Vercel (étape 5 — à revenir remplir après) |
   | `KADEVPAY_PUBLIC_KEY` / `KADEVPAY_SECRET_KEY` / `KADEVPAY_WEBHOOK_SECRET` | vos clés Kadev Pay de test |
   | `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_PUBLIC_BASE_URL` | valeurs R2 |
   | `SMTP_HOST` / `SMTP_USER` / `SMTP_PASSWORD` | valeurs Brevo |

   `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ARGON2_PEPPER` sont générés
   automatiquement par Render (`generateValue: true`) — rien à saisir.

4. Une fois déployé, Render donne une URL du type
   `https://oja-api.onrender.com`. Noter `https://oja-api.onrender.com/api/v1`.

5. Exécuter les migrations et le seed **une seule fois**, depuis le shell
   Render (*Shell* dans le tableau de bord du service) :
   ```bash
   npm run db:migrate
   npm run db:seed
   ```

**À savoir sur le plan gratuit Render** : le service s'endort après 15 min
sans requête, et met quelques secondes à se réveiller à la suivante. Gênant
pour une démo en direct, sans conséquence pour un webhook Kadev Pay — il
patiente le temps que le service redémarre.

## 5. Vercel — front

1. Créer un compte sur vercel.com, importer le dépôt GitHub `Odja`.
2. **Root Directory** : `apps/web` (c'est un monorepo — sans ça, Vercel
   cherche un `package.json` à la racine du mauvais dossier).
3. Vercel détecte Next.js automatiquement (`npm run build`, sortie
   `.next`) — rien à changer côté commandes.
4. Variable d'environnement à ajouter :
   `NEXT_PUBLIC_API_URL=https://oja-api.onrender.com/api/v1`
   (l'URL Render obtenue à l'étape précédente).
5. Déployer. Vercel donne une URL du type `https://oja.vercel.app`.
6. **Revenir sur Render** et renseigner `WEB_ORIGIN` avec cette URL Vercel,
   puis redéployer le service API — sans ça, le navigateur est bloqué par
   CORS.

## 6. Kadev Pay — webhook

Une fois l'API en ligne (étape 4), sur le tableau de bord Kadev Pay :

- URL de notification : `https://oja-api.onrender.com/api/v1/webhooks/kadevpay`
- Copier le **secret de signature** qu'ils fournissent alors dans
  `KADEVPAY_WEBHOOK_SECRET` sur Render (remplacer le `whsec_placeholder_…`
  actuel), puis redéployer.

## 7. Vérification finale

- [ ] `https://oja-api.onrender.com/api/v1/health` répond
- [ ] `https://oja-api.onrender.com/api/v1/geo/countries` répond (Bénin seul)
- [ ] Le front Vercel charge le catalogue
- [ ] Inscription + e-mail de confirmation reçu (vraie boîte, via Brevo)
- [ ] Une commande de test : paiement Kadev Pay (sandbox) confirmé sans
      passer par le SDK seul — le webhook doit maintenant faire le travail
- [ ] Photo produit uploadée et visible (R2)

---

Pile 100 % gratuite tant que les volumes restent faibles — c'est fait pour
la recette, pas encore pour ouvrir au public (voir `ETAT-PROJET.md` § 3-4
pour ce qui manque encore avant ça).
