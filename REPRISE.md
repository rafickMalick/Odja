# Ojà : reprendre le travail

**Point d'étape du 4 octobre 2026.** Ce fichier dit où on s'est arrêté, pour
qu'une nouvelle session — sur un autre poste ou dans le cloud — reprenne sans
rien redemander. À lire en premier, puis [`A-FAIRE.md`](A-FAIRE.md).

> Pour reprendre : « lis `REPRISE.md` puis `A-FAIRE.md`, et continuons ».
> Mettre ce fichier à jour à la fin de chaque session, dans la même PR que le
> travail fait.

---

## 1. Où on en est

- **En ligne** : site https://oja.aworix.agency (Vercel), API Render
  (`api.oja.aworix.agency`), base Neon.
- **Configuration faite par Malik** (Render, Vercel, Brevo) : toutes les
  variables de [`A-FAIRE.md`](A-FAIRE.md) § 1, dont `COOKIE_DOMAIN`
  corrigé (il valait `oja.ox`, ce qui déconnectait tout le monde juste après la
  connexion), `NODE_ENV=production`, le stockage S3 et la liste Brevo de la
  newsletter.
- **Tout ce qui est fusionné dans `main`** : PR #1 à #27, plus le commit
  `551987f` de Rafick (voir § 2).
- **Cinq PR ouvertes**, prêtes à relire (§ 3).

## 2. Ce qui a été fait (3 et 4 octobre)

| PR | Quoi | Statut |
|---|---|---|
| #19 | Newsletter du pied de page : abonnés en base, copiés dans une liste Brevo (`BREVO_NEWSLETTER_LIST_ID`) | fusionnée |
| #20 | Doublon « Politique de confidentialité » retiré du pied de page | fusionnée |
| #21 | Affichage par rôle : appels à s'inscrire réservés aux visiteurs (l'admin voit tout) ; `/connexion` et `/inscription` renvoient un compte connecté chez lui | fusionnée |
| #22 | Idempotence de `POST /checkout` (`Idempotency-Key`) : plus de double commande | fusionnée |
| #23 | Double authentification (TOTP + QR code + 10 codes de secours), **obligatoire pour l'espace admin** ; réinitialisation par un collègue | fusionnée |
| #24 | `npm audit` : 15 → 7 alertes (nodemailer 10, multer, sharp…) | fusionnée |
| #25 | Tests navigateur Playwright (`e2e/`), joués en CI : achat complet, rôles, admin + MFA | fusionnée |
| #26 | `COOKIE_DOMAIN` ignoré s'il ne couvre pas le site (garde-fou après l'incident `oja.ox`) | fusionnée |
| #27 | Instagram (`@oja.bj`) et LinkedIn dans le pied de page ; X et Facebook retirés | fusionnée |
| `551987f` (Rafick) | Un atelier validé ne repasse en validation que si l'IFU, le RCCM ou le gérant **changent vraiment** | sur `main` |

## 3. PR ouvertes — à relire et fusionner

| PR | Quoi | À savoir |
|---|---|---|
| **#28** | Audit automatique de toute action admin (L0-31) + filtre des secrets dans tous les journaux (L0-30) | déjà resynchronisée avec `main` |
| **#29** | Avis clients : note après réception validée, modération (Admin › Avis clients), notes moyennes pièce et atelier | migration `20261004090000_avis_clients` |
| **#30** | Factures : bouton visible **dès le paiement** (il ne s'affichait jamais), émission à l'encaissement par l'ordonnanceur, numérotation sans trou, mentions légales du vendeur | `LEGAL` déplacé dans `packages/contracts/src/legal.ts` |
| **#31** | Codes promo : la raison d'un refus s'affiche sous le champ ; le plafond (commission Ojà) est annoncé au client et à l'admin | décision : **garder le plafond** |
| **#32** | Notifications lisibles sur un appareil en thème sombre (et suivi de livraison) | front seul |

**Fusionner dans l'ordre des numéros.** Plusieurs touchent `A-FAIRE.md`,
`BACKLOG-BACKEND.md`, `INVENTAIRE.md` ou le schéma Prisma : de petits conflits
apparaîtront à chaque fusion. Les résoudre en gardant les deux côtés (`git
fetch origin main` puis `git merge origin/main` sur la branche, jamais de
rebase ni de push forcé).

**Après la fusion de #29 et #30** : l'API se redéploie sur Render et applique
les migrations au démarrage. Regarder alors sur le site la section « Avis des
acheteurs » d'une fiche, Admin › Avis clients et le bouton de facture d'une
commande payée — ces écrans n'ont pas pu être vus en local.

## 4. Diagnostics en cours

### Envoi des photos qui échoue (« L'envoi a échoué. Réessayez. »)

Constaté le 3 octobre sur l'espace créateur. Le navigateur envoie la photo
**directement** au stockage S3 avec une URL signée par l'API. Deux causes
probables, toutes deux de configuration :

1. **Noms des compartiments** : le code utilise `<S3_BUCKET>-public` (photos)
   et `<S3_BUCKET>-private` (KYC, factures, preuves), pas `S3_BUCKET` seul
   (`apps/api/src/storage/storage.service.ts`). `DEPLOIEMENT.md` § 2 disait à
   tort de créer un seul compartiment.
2. **CORS** sur les deux compartiments, pour `https://oja.aworix.agency`,
   méthodes `PUT`, `GET`, `HEAD`, en-têtes `*`. `DEPLOIEMENT.md` n'en parlait
   pas.

À vérifier en premier si les photos échouent encore : la console du
navigateur dira « CORS » ou « NoSuchBucket ».

### Statut des fiches qui ne change pas

Une fiche **brouillon** ne passe « En validation » qu'avec le bouton « Envoyer
en validation », qui **n'apparaît qu'une fois tous les blocages levés** :
3 photos minimum (donc lié au point précédent), dossier d'atelier validé,
prix, stock ou délai. L'écran est aussi trompeur (confirmation affichée en
haut, bouton qui disparaît au lieu de se griser).

## 5. Prochaines étapes proposées (pas encore commencées)

1. **PR photos et statut des fiches** : messages d'erreur d'envoi précis (CORS,
   compartiment introuvable, message de l'API) ; confirmation d'enregistrement
   près du bouton, avec le statut ; « Envoyer en validation » toujours visible,
   grisé avec la liste de ce qui manque ; `DEPLOIEMENT.md` corrigé
   (compartiments `-public` / `-private`, CORS, `S3_PUBLIC_BASE_URL`).
2. **Sentry** (site et API) : erreurs remontées avec les secrets masqués
   (filtre de #28), `sendDefaultPii: false`, pas de Session Replay, Sentry
   ajouté aux sous-traitants de `/confidentialite`. Sans DSN, Sentry reste
   éteint : la PR peut être fusionnée avant. Côté compte : région **EU**, deux
   projets (`oja-web` Next.js, `oja-api` NestJS), scrubbers activés,
   « Allowed Domains » = `oja.aworix.agency` ; variables
   `NEXT_PUBLIC_SENTRY_DSN` (Vercel) et `SENTRY_DSN` (Render).
3. **Surveillance de disponibilité** : UptimeRobot (gratuit) sur
   `/api/v1/health` et l'accueil. Grafana plus tard, avec OpenTelemetry (L8),
   avant l'ouverture au public.
4. Migrations majeures pour les 7 alertes `npm audit` restantes
   (prisma 7, next 16, vitest 5), chacune dans sa PR.

## 6. Décisions prises (à ne pas rediscuter)

- Un compte = un rôle. Les appels à s'inscrire ne s'adressent qu'aux
  visiteurs ; **l'admin voit le site public comme un visiteur**.
- **Tous les rôles peuvent acheter** (toujours ouvert dans `A-FAIRE.md` § 4
  si l'équipe veut revenir dessus).
- Double authentification **obligatoire** pour l'espace admin, facultative
  ailleurs ; QR code généré dans le navigateur (bibliothèque `qrcode`).
- Avis **modérés** avant publication ; auteur affiché « Prénom I. ».
- Codes promo **plafonnés à la commission Ojà**, plafond annoncé.
- Facture **datée du paiement**, numérotée sans trou.

## 7. Comment on travaille sur ce dépôt

- **Une PR par sujet**, branche depuis `main` à jour ; messages de commit et
  PR en français. Ne jamais pousser sur `main` directement.
- **Ne jamais commiter `packages/db/generated/`** : la CI et le Dockerfile
  régénèrent le client Prisma (`npm run db:generate`). Après un
  `db:generate` local, `git checkout -- packages/db/generated`.
- **Migrations** : générées avec
  `prisma migrate diff --from-schema-datamodel <ancien> --to-schema-datamodel prisma/schema.prisma --script`,
  puis `npm run db:check-migrations`. Ne pas lancer `prisma format` (il
  réaligne tout le schéma).
- **Tests de bout en bout** (`*.e2e.test.ts`) : ils exigent PostgreSQL, absent
  sur le poste Windows de dev ; la CI les joue. Les fichiers de test sont
  exclus du `tsc` de l'API : les vérifier avec un `tsconfig` qui les inclut.
- **Tests navigateur** : `npm run test:browser` (site sur :3000, API sur :4000,
  jeu de démonstration chargé).
- `ADMIN_MFA_REQUIRED` est coupé dans `apps/api/vitest.config.ts` pour les
  tests qui ne concernent pas la MFA.
