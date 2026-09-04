#!/usr/bin/env bash
#
# Ojà — lancement du projet en développement.
#
#   ./start.sh              tout : infrastructure, base, API et front
#   ./start.sh --demo       idem, avec un atelier validé et des pièces publiées
#   ./start.sh --fresh      remet la base à zéro avant de démarrer
#   ./start.sh --infra      infrastructure seule (pour lancer l'API à la main)
#   ./start.sh --check      vérifie types, tests et build, sans rien démarrer
#   ./start.sh --stop       arrête tout
#
# Le script est **idempotent** : le relancer sur un projet déjà démarré ne
# casse rien et ne réinstalle rien inutilement. C'est ce qui permet d'en faire
# le seul geste à connaître.

set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

# ── Réglages ──────────────────────────────────────────────────────────────
API_PORT="${API_PORT:-4000}"
WEB_PORT="${WEB_PORT:-3000}"
NODE_MIN=20

# ── Affichage ─────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'
  YELLOW=$'\033[33m'; ORANGE=$'\033[38;5;208m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; ORANGE=""; RESET=""
fi

step() { printf "\n${ORANGE}▸${RESET} ${BOLD}%s${RESET}\n" "$1"; }
ok()   { printf "  ${GREEN}✓${RESET} %s\n" "$1"; }
warn() { printf "  ${YELLOW}!${RESET} %s\n" "$1"; }
die()  { printf "\n${RED}✗ %s${RESET}\n\n" "$1" >&2; exit 1; }
note() { printf "    ${DIM}%s${RESET}\n" "$1"; }

# Un échec en cours de route doit dire **où**, pas seulement « erreur ».
trap 'die "Échec ligne $LINENO. Le script est rejouable : corrigez, puis relancez ./start.sh"' ERR

# ── Options ───────────────────────────────────────────────────────────────
WITH_DEMO=0; FRESH=0; INFRA_ONLY=0; CHECK_ONLY=0; STOP=0

for arg in "$@"; do
  case "$arg" in
    --demo)   WITH_DEMO=1 ;;
    --fresh)  FRESH=1 ;;
    --infra)  INFRA_ONLY=1 ;;
    --check)  CHECK_ONLY=1 ;;
    --stop)   STOP=1 ;;
    -h|--help)
      sed -n '3,14p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) die "Option inconnue : $arg   (essayez ./start.sh --help)" ;;
  esac
done

# ── Compose : la commande diffère selon l'installation ────────────────────
compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  else
    docker-compose "$@"
  fi
}

# ══════════════════════════════════════════════════════════ Arrêt
if [[ $STOP -eq 1 ]]; then
  step "Arrêt"
  pkill -f "nest start" 2>/dev/null && ok "API arrêtée" || note "API déjà arrêtée"
  pkill -f "next dev"   2>/dev/null || true
  pkill -f "next start" 2>/dev/null || true
  ok "Front arrêté"

  compose down >/dev/null 2>&1 || true

  # `compose down` ne suffit pas toujours : un conteneur lancé au préalable par
  # `docker run` — ou par une version antérieure de ce script — porte le bon
  # nom mais aucune étiquette compose, et `down` l'ignore silencieusement. On
  # arrête donc aussi par nom, en secours.
  for c in oja-pg oja-minio oja-mailpit oja-redis; do
    docker stop "$c" >/dev/null 2>&1 || true
  done
  ok "Conteneurs arrêtés (les données sont conservées)"
  note "Pour effacer aussi les données : docker compose down -v"
  exit 0
fi

# ══════════════════════════════════════════════════════════ Pré-requis
step "Vérification des pré-requis"

command -v node >/dev/null || die "Node.js n'est pas installé. Il en faut la version $NODE_MIN ou plus."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$NODE_MAJOR" -ge "$NODE_MIN" ]] || die "Node $NODE_MAJOR détecté ; il en faut $NODE_MIN ou plus."
ok "Node $(node -v)"

command -v npm >/dev/null || die "npm n'est pas installé."
ok "npm $(npm -v)"

command -v docker >/dev/null || die "Docker n'est pas installé — il porte PostgreSQL, MinIO et la boîte mail de test."
docker info >/dev/null 2>&1 || die "Docker est installé mais ne répond pas. Démarrez-le, puis relancez."
ok "Docker prêt"

# ── Configuration ─────────────────────────────────────────────────────────
if [[ ! -f .env ]]; then
  [[ -f .env.example ]] || die "Ni .env ni .env.example : le dépôt est incomplet."
  cp .env.example .env
  ok ".env créé depuis .env.example"
  warn "Valeurs de développement uniquement — à remplacer avant toute mise en ligne."
else
  ok ".env présent"
fi

# ── Dépendances ───────────────────────────────────────────────────────────
# On compare le verrou à un témoin qu'on pose nous-même après installation.
# Comparer à `node_modules` ne marche pas : la date d'un dossier ne bouge que
# si l'on y ajoute ou retire une entrée, et `npm install` réécrit le verrou
# après coup — la condition serait donc vraie à chaque lancement.
STAMP="node_modules/.oja-install-stamp"
if [[ ! -d node_modules ]] || [[ ! -f $STAMP ]] || [[ package-lock.json -nt $STAMP ]]; then
  step "Installation des dépendances"
  npm install
  touch "$STAMP"
  ok "Dépendances installées"
else
  ok "Dépendances à jour"
fi

# ══════════════════════════════════════════════════════════ Infrastructure
step "Infrastructure"

if [[ $FRESH -eq 1 ]]; then
  warn "--fresh : les données locales vont être effacées."
  compose down -v >/dev/null 2>&1 || true
  ok "Volumes supprimés"
fi

# Les conteneurs portent un nom fixe (oja-pg, oja-minio…). S'ils tournent déjà
# — démarrés à la main, ou par un compose d'une autre version — `compose up`
# échoue sur un conflit de nom au lieu de les réutiliser. On regarde donc ce
# qui tourne avant de demander quoi que ce soit.
REQUIRED=(oja-pg oja-minio oja-mailpit)
MISSING=()
for c in "${REQUIRED[@]}"; do
  docker ps --format '{{.Names}}' | grep -qx "$c" || MISSING+=("$c")
done

if [[ ${#MISSING[@]} -eq 0 ]]; then
  ok "Conteneurs déjà en marche"
else
  compose up -d >/dev/null 2>&1 || {
    # Un conteneur arrêté garde son nom : on le relance plutôt que d'exiger
    # de l'utilisateur qu'il aille le supprimer lui-même.
    for c in "${MISSING[@]}"; do docker start "$c" >/dev/null 2>&1 || true; done
    for c in "${REQUIRED[@]}"; do
      docker ps --format '{{.Names}}' | grep -qx "$c" \
        || die "Le conteneur $c n'a pas pu démarrer.
   Voir :        docker logs $c
   Repartir à neuf : docker rm -f ${REQUIRED[*]} oja-redis && ./start.sh"
    done
  }
  ok "Conteneurs démarrés"
fi
note "PostgreSQL :55432   MinIO :59000 (console :59001)   Mailpit :58025"

# Attendre que PostgreSQL réponde vraiment. « Conteneur démarré » ne veut pas
# dire « base prête » : les migrations échoueraient sur une base qui achève son
# initialisation.
printf "  ${DIM}attente de PostgreSQL"
for i in $(seq 1 60); do
  if docker exec oja-pg pg_isready -U oja >/dev/null 2>&1; then
    printf "${RESET}\n"; ok "PostgreSQL prêt"; break
  fi
  printf "."
  sleep 1
  [[ $i -eq 60 ]] && { printf "${RESET}\n"; die "PostgreSQL n'a pas répondu en 60 s. Voir : docker logs oja-pg"; }
done

# MinIO de même : le stockage est sollicité dès la première photo.
printf "  ${DIM}attente de MinIO"
for i in $(seq 1 60); do
  if curl -sf -m 2 http://localhost:59000/minio/health/live >/dev/null 2>&1; then
    printf "${RESET}\n"; ok "MinIO prêt"; break
  fi
  printf "."
  sleep 1
  [[ $i -eq 60 ]] && { printf "${RESET}\n"; warn "MinIO ne répond pas — les envois de fichiers échoueront."; break; }
done

# ══════════════════════════════════════════════════════════ Base de données
step "Base de données"

npm run db:generate >/dev/null
ok "Client Prisma généré"

# Contrôle mécanique : Prisma régénère un DROP de l'index de recherche dans
# chaque migration touchant les produits. C'est arrivé quatre fois.
npm run db:check-migrations
npm run db:migrate:deploy >/dev/null
ok "Migrations appliquées"

npm run db:seed >/dev/null
ok "Données de référence en place (pays, villes, catégories, tarifs)"

if [[ $WITH_DEMO -eq 1 ]]; then
  npm run db:demo >/dev/null
  ok "Jeu de démonstration : un atelier validé et ses pièces publiées"
fi

# ══════════════════════════════════════════════════════════ Contrôles
if [[ $CHECK_ONLY -eq 1 ]]; then
  step "Contrôles"
  npm run typecheck && ok "Types"
  npm test          && ok "Tests"
  npm run build     && ok "Build"
  printf "\n${GREEN}${BOLD}Tout est au vert.${RESET}\n\n"
  exit 0
fi

# ══════════════════════════════════════════════════════════ Applications
if [[ $INFRA_ONLY -eq 1 ]]; then
  printf "\n${GREEN}${BOLD}Infrastructure prête.${RESET}\n\n"
  printf "  Lancez ensuite, dans deux terminaux :\n"
  printf "    ${BOLD}npm run api${RESET}    puis    ${BOLD}npm run web${RESET}\n\n"
  exit 0
fi

step "Démarrage des applications"

# Un port déjà pris est la panne la plus fréquente, et la plus déroutante :
# l'ancien serveur répond, on croit que le nouveau tourne.
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && exec 3<&- && return 0 || return 1; }

for p in "$API_PORT:l'API:API" "$WEB_PORT:le front:WEB"; do
  port="${p%%:*}"; rest="${p#*:}"; name="${rest%%:*}"; var="${rest##*:}"
  if port_busy "$port"; then
    die "Le port $port est déjà occupé — $name ne démarrerait pas, et vous verriez l'ancien serveur.
   Libérez-le, ou changez de port :  ${var}_PORT=$((port+10)) ./start.sh"
  fi
done

mkdir -p .logs
API_LOG=".logs/api.log"; WEB_LOG=".logs/web.log"

npm run api > "$API_LOG" 2>&1 &
API_PID=$!
npm run web > "$WEB_LOG" 2>&1 &
WEB_PID=$!

# Arrêter les deux ensemble, quoi qu'il arrive : un Ctrl-C ne doit pas laisser
# un serveur orphelin qui occupera le port au prochain lancement.
cleanup() {
  trap - INT TERM EXIT
  printf "\n${ORANGE}▸${RESET} ${BOLD}Arrêt${RESET}\n"
  kill "$API_PID" "$WEB_PID" 2>/dev/null || true
  wait "$API_PID" "$WEB_PID" 2>/dev/null || true
  ok "API et front arrêtés"
  note "L'infrastructure tourne toujours. Pour tout arrêter : ./start.sh --stop"
  exit 0
}
trap cleanup INT TERM

printf "  ${DIM}attente de l'API"
for i in $(seq 1 90); do
  if curl -sf -m 2 "http://localhost:$API_PORT/api/v1/health" >/dev/null 2>&1; then
    printf "${RESET}\n"; ok "API en ligne"; break
  fi
  kill -0 "$API_PID" 2>/dev/null || { printf "${RESET}\n"; tail -30 "$API_LOG"; die "L'API s'est arrêtée. Journal complet : $API_LOG"; }
  printf "."
  sleep 1
  [[ $i -eq 90 ]] && { printf "${RESET}\n"; tail -30 "$API_LOG"; die "L'API n'a pas répondu en 90 s. Journal : $API_LOG"; }
done

printf "  ${DIM}attente du front"
for i in $(seq 1 90); do
  if curl -sf -m 2 "http://localhost:$WEB_PORT/" >/dev/null 2>&1; then
    printf "${RESET}\n"; ok "Front en ligne"; break
  fi
  kill -0 "$WEB_PID" 2>/dev/null || { printf "${RESET}\n"; tail -30 "$WEB_LOG"; die "Le front s'est arrêté. Journal complet : $WEB_LOG"; }
  printf "."
  sleep 1
  [[ $i -eq 90 ]] && { printf "${RESET}\n"; tail -30 "$WEB_LOG"; die "Le front n'a pas répondu en 90 s. Journal : $WEB_LOG"; }
done

# ══════════════════════════════════════════════════════════ Récapitulatif
cat <<RECAP

${GREEN}${BOLD}Ojà tourne.${RESET}

  ${BOLD}Boutique${RESET}            http://localhost:$WEB_PORT
  ${BOLD}Espace client${RESET}       http://localhost:$WEB_PORT/compte
  ${BOLD}Espace créateur${RESET}     http://localhost:$WEB_PORT/espace-createur
  ${BOLD}Espace livreur${RESET}      http://localhost:$WEB_PORT/espace-livreur
  ${BOLD}Administration${RESET}      http://localhost:$WEB_PORT/admin

  ${DIM}API                 http://localhost:$API_PORT/api/v1${RESET}
  ${DIM}Boîte mail          http://localhost:58025${RESET}
  ${DIM}Stockage            http://localhost:59001   (oja / oja_dev_secret)${RESET}

  ${DIM}Journaux            $API_LOG   ·   $WEB_LOG${RESET}

  Le paiement passe par un fournisseur simulé : depuis ${BOLD}/admin/outils${RESET},
  on encaisse une commande et on déclenche les tâches périodiques à la main.

  ${DIM}Ctrl-C pour arrêter l'API et le front. ./start.sh --stop pour tout arrêter.${RESET}

RECAP

# Rester au premier plan tant que les deux serveurs tournent : le script est le
# processus qu'on interrompt, pas un lanceur qui rend la main et laisse deux
# orphelins derrière lui.
wait "$API_PID" "$WEB_PID"
