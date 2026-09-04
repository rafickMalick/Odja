# ── Étape 1 : construction ──
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
COPY packages/contracts/package.json packages/contracts/

RUN npm ci

COPY packages/ packages/
COPY apps/web/ apps/web/

# L'URL de l'API est figée dans le bundle navigateur au moment du build :
# c'est un argument de construction, pas une variable d'exécution.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN npm run db:generate \
 && npm run build -w @oja/contracts \
 && npm run build -w @oja/web

# ── Étape 2 : exécution ──
# On s'appuie sur la sortie `standalone` de Next : elle n'embarque que les
# modules réellement atteints, ce qui divise l'image par cinq.
FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S oja && adduser -S oja -G oja

COPY --from=build --chown=oja:oja /app/apps/web/.next/standalone ./
COPY --from=build --chown=oja:oja /app/apps/web/.next/static apps/web/.next/static/
COPY --from=build --chown=oja:oja /app/apps/web/public apps/web/public/

USER oja
EXPOSE 3000

CMD ["node", "apps/web/server.js"]
