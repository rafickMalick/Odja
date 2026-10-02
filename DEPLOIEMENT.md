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
| Photos produits | **Cloudflare R2** ou **Supabase Storage** | Compatibles S3 tous les deux (le code n'a rien à changer) ; R2 est gratuit jusqu'à 10 Go sans frais de sortie, Supabase Storage est inclus dans son plan gratuit si vous utilisez déjà Supabase pour la base |
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

## 2. Stockage des photos — Cloudflare R2 ou Supabase Storage

Le code parle S3 et ignore lequel des deux sert derrière `S3_ENDPOINT` —
choisissez l'un ou l'autre, pas besoin des deux.

### Option A — Cloudflare R2

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

### Option B — Supabase Storage

Pertinent si vous utilisez déjà Supabase pour `DATABASE_URL` : un seul compte
pour la base et les photos.

1. Dans le tableau de bord Supabase, section **Storage**, créer un bucket
   public, ex. `oja-prod`.
2. *Settings → API* : `S3_ACCESS_KEY` / `S3_SECRET_KEY` viennent des clés S3
   du bucket (section *Storage → S3 Access Keys*, à créer si absente).
3. `S3_ENDPOINT` : `https://<projet>.supabase.co/storage/v1/s3`.
4. `S3_REGION` : la région du projet Supabase (visible dans *Settings →
   General*, ex. `eu-west-1`) — **pas** `auto`, contrairement à R2.
5. `S3_PUBLIC_BASE_URL` : `https://<projet>.supabase.co/storage/v1/object/public/oja-prod`.
6. `S3_BUCKET=oja-prod`.

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
   | `DATABASE_URL` | chaîne Neon (ou Supabase, si vous avez choisi cette option) |
   | `DIRECT_DATABASE_URL` | chaîne Neon **directe**, sans `-pooler` dans l'hôte : les migrations ne passent pas par le pooler. Inutile si `DATABASE_URL` est déjà directe |
   | `ADMIN_BOOTSTRAP_EMAIL` | e-mail du **premier administrateur**. Ce compte devient ADMIN au démarrage s'il existe, ou dès son inscription sinon. Sans effet dès qu'un admin existe : on peut la laisser en place |
   | `WEB_ORIGIN` | URL Vercel (étape 5 — à revenir remplir après) |
   | `KADEVPAY_PUBLIC_KEY` / `KADEVPAY_SECRET_KEY` / `KADEVPAY_WEBHOOK_SECRET` | vos clés Kadev Pay de test |
   | `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_PUBLIC_BASE_URL` | valeurs R2 ou Supabase Storage (§ 2) — `S3_REGION` vaut `auto` pour R2, la région du projet pour Supabase |
   | `BREVO_API_KEY` | **clé API Brevo** (Brevo › SMTP & API › API Keys). Indispensable sur le plan gratuit : Render y bloque les ports SMTP depuis septembre 2025, et sans elle l'inscription attendrait un e-mail qui ne part jamais |
   | `SMTP_USER` / `SMTP_PASSWORD` | valeurs Brevo (ignorées si `BREVO_API_KEY` est renseignée) |
   | `MAIL_FROM` | l'expéditeur vérifié dans Brevo, ex. `Ojà <bonjour@oja.market>` |

   `SMTP_HOST` (`smtp-relay.brevo.com`) et `SMTP_PORT` (`587`) sont déjà fixés
   dans `render.yaml`, rien à saisir pour ces deux-là. `JWT_ACCESS_SECRET`,
   `JWT_REFRESH_SECRET`, `ARGON2_PEPPER` sont générés automatiquement par
   Render (`generateValue: true`) — rien à saisir non plus.

4. Une fois déployé, Render donne une URL du type
   `https://oja-api.onrender.com`. Noter `https://oja-api.onrender.com/api/v1`.

5. **Les migrations s'appliquent seules** à chaque démarrage du conteneur
   (`apps/api/docker-entrypoint.sh`) : rien à lancer à la main, et une
   migration ajoutée plus tard part avec le déploiement suivant. Si l'une
   échoue, le conteneur s'arrête et Render garde la version précédente en
   ligne ; le message est dans les logs du déploiement.

6. **Les données de référence** (pays, villes, catégories, tarifs) se
   chargent seules au démarrage, **une seule fois** : seulement si la base
   n'a encore aucun pays. Ensuite, le seed n'est plus jamais rejoué
   automatiquement, car il remettrait les réglages faits depuis l'admin
   (pays ouverts, grilles) aux valeurs du fichier.

7. **Premier administrateur** : renseigner `ADMIN_BOOTSTRAP_EMAIL`, puis
   s'inscrire sur le site avec cette adresse (n'importe quel profil). Le
   compte devient ADMIN à l'inscription, ou au démarrage suivant s'il existait
   déjà. Une trace `user.admin.bootstrap` est écrite au journal d'audit.

   Ne jamais lancer `npm run db:migrate` sur cette base : c'est la commande
   de **développement** (`prisma migrate dev`), qui peut proposer de la
   réinitialiser.

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

## 5 bis. Domaine personnalisé — `oja.aworix.agency`

Le domaine `aworix.agency` est géré chez **OVH**. Ojà s'y installe en
sous-domaines, sans toucher au site principal :

| Adresse | Service |
|---|---|
| `oja.aworix.agency` | front (Vercel) |
| `api.oja.aworix.agency` | API (Render) |

1. **Vercel** → projet → *Settings → Domains* → ajouter `oja.aworix.agency`.
2. **Render** → service `oja-api` → *Settings → Custom Domains* → ajouter
   `api.oja.aworix.agency`.
3. **OVH** → *Web Cloud → Noms de domaine → aworix.agency → Zone DNS* →
   *Ajouter une entrée* → **CNAME**, deux fois :

   | Sous-domaine | Cible |
   |---|---|
   | `oja` | la valeur affichée par Vercel (en général `cname.vercel-dns.com.`) |
   | `api.oja` | `oja-api.onrender.com.` |

   Le point final de la cible est exigé par OVH. Laisser la propagation se
   faire (quelques minutes à quelques heures) ; Vercel et Render émettent le
   certificat HTTPS d'eux-mêmes une fois le DNS vu.
4. **Variables**, puis redéployer les deux services :
   - Render : `WEB_ORIGIN=https://oja.aworix.agency` et
     `COOKIE_DOMAIN=oja.aworix.agency`
   - Vercel : `NEXT_PUBLIC_API_URL=https://api.oja.aworix.agency/api/v1` —
     elle est figée au build, un simple redémarrage ne suffit pas.
5. **Kadev Pay** : remplacer l'URL du webhook (§ 6) par
   `https://api.oja.aworix.agency/api/v1/webhooks/kadevpay`.

**Pourquoi `COOKIE_DOMAIN`.** Sans lui, les cookies de session posés par
l'API n'appartiennent qu'à `api.oja.aworix.agency` : le serveur du front ne
les reçoit pas et les pages rendues côté serveur voient tout le monde
déconnecté. `oja.aworix.agency` les partage entre le front et l'API, et
seulement eux — `aworix.agency` les enverrait aussi aux autres sites du
domaine.

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
- [ ] Photo produit uploadée et visible (R2 ou Supabase Storage, selon l'option choisie au § 2)

---

Pile 100 % gratuite tant que les volumes restent faibles — c'est fait pour
la recette, pas encore pour ouvrir au public (voir `ETAT-PROJET.md` § 3-4
pour ce qui manque encore avant ça).
