#!/bin/sh
#
# Démarrage de l'API en conteneur : migrations d'abord, serveur ensuite.
#
# Sans cette étape, une migration oubliée laisse l'API démarrer sur une base
# dont les tables n'existent pas ou ont un retard : `/health` répond (la base
# est joignable) mais chaque lecture renvoie une erreur 500. C'est ce qui est
# arrivé sur Render, où le shell qui permettait de les lancer à la main n'est
# pas disponible sur le plan gratuit.
#
# `migrate deploy` n'applique que les migrations en attente : sur une base à
# jour, il ne fait rien. S'il échoue, le conteneur s'arrête — Render garde
# alors la version précédente en ligne plutôt que d'en servir une cassée.

set -e

# Neon (et tout PgBouncer en mode transaction) : les migrations ont besoin
# d'une connexion directe. DIRECT_DATABASE_URL la fournit quand DATABASE_URL
# passe par le pooler ; sans elle, on utilise DATABASE_URL tel quel.
MIGRATION_URL="${DIRECT_DATABASE_URL:-$DATABASE_URL}"

echo "▸ Migrations de la base…"
DATABASE_URL="$MIGRATION_URL" ./node_modules/.bin/prisma migrate deploy \
  --schema packages/db/prisma/schema.prisma

echo "▸ Démarrage de l'API"
exec node apps/api/dist/main.js
