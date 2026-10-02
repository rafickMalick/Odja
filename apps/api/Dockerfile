# ── Étape 1 : construction ──
# Toutes les dépendances, y compris de développement : Prisma et TypeScript
# sont nécessaires pour produire le client et compiler.
FROM node:22-alpine AS build

WORKDIR /app

# Les manifestes d'abord : cette couche ne change qu'à l'ajout d'une
# dépendance, et Docker réutilise alors le cache de `npm ci`.
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
COPY packages/contracts/package.json packages/contracts/

RUN npm ci

COPY packages/ packages/
COPY apps/api/ apps/api/

# Le client Prisma est généré avant la compilation : le code de l'API importe
# ses types.
RUN npm run db:generate \
 && npm run build -w @oja/contracts \
 && npm run build -w @oja/domain \
 && npm run build -w @oja/api

# Les dépendances de développement sortent de l'image finale.
RUN npm prune --omit=dev

# ── Étape 2 : exécution ──
FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

# Jamais root. Un débordement dans une dépendance ne doit pas donner la machine.
RUN addgroup -S oja && adduser -S oja -G oja

COPY --from=build --chown=oja:oja /app/node_modules node_modules/
COPY --from=build --chown=oja:oja /app/package.json ./
COPY --from=build --chown=oja:oja /app/apps/api/dist apps/api/dist/
COPY --from=build --chown=oja:oja /app/apps/api/package.json apps/api/
COPY --from=build --chown=oja:oja /app/packages packages/
COPY --chown=oja:oja apps/api/docker-entrypoint.sh apps/api/
# Fins de ligne Unix et droit d'exécution, quel que soit le poste qui a
# poussé le fichier : un script en CRLF ne s'exécute pas sous Alpine.
RUN sed -i 's/\r$//' apps/api/docker-entrypoint.sh && chmod +x apps/api/docker-entrypoint.sh

USER oja
EXPOSE 4000

# La sonde interroge la vraie route de santé, qui vérifie la base : un
# conteneur qui répond mais ne voit plus PostgreSQL n'est pas en bonne santé.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migrations en attente appliquées à chaque démarrage, puis le serveur.
CMD ["./apps/api/docker-entrypoint.sh"]
