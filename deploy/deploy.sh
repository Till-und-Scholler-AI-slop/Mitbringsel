#!/usr/bin/env bash
# Deploys one environment on the server. Called by .github/workflows/deploy.yml
# from inside the environment directory (the one holding .env):
#
#   cd /opt/personal-projects/slop/mitbringsel/staging
#   echo "$GHCR_TOKEN" | bash incoming/deploy.sh <image-tag> <ghcr-user>
#
# The workflow uploads the new compose files and this script to incoming/.
# The script installs them, pulls and starts the new images and waits until
# all containers are healthy. If that fails, it restores the previous compose
# files and image tag and exits non-zero.
#
# Database migrations are not rolled back: the old backend then runs against
# the migrated schema, so migrations must stay backward compatible.

set -euo pipefail

readonly INCOMING=incoming
readonly PREVIOUS=previous
readonly WAIT_TIMEOUT=120
# Only images built from this repository carry this label (see ci.yml), so
# pruning never touches images of other projects on the server.
readonly IMAGE_LABEL=org.opencontainers.image.source=https://github.com/Till-und-Scholler-AI-slop/Mitbringsel

log() { printf '[deploy] %s\n' "$*"; }
fail() { log "ERROR: $*"; exit 1; }

tag=${1:-}
ghcr_user=${2:-}
[[ -n $tag && -n $ghcr_user ]] || fail "usage: deploy.sh <image-tag> <ghcr-user>, GHCR token on stdin"
# The tag ends up in .env and in image references; allow only safe characters.
[[ $tag =~ ^[A-Za-z0-9._-]+$ ]] || fail "invalid image tag: $tag"
[[ -f .env ]] || fail "no .env in $PWD; create it from .env.example first"
[[ -f $INCOMING/docker-compose.yml ]] || fail "no $INCOMING/docker-compose.yml; the workflow uploads it"

# Log in with a throwaway Docker config instead of ~/.docker: the short-lived
# token never stays on disk, and logins of other projects that use the same
# server user are left alone.
DOCKER_CONFIG=$(mktemp -d)
export DOCKER_CONFIG
trap 'rm -rf "$DOCKER_CONFIG"' EXIT
# With DOCKER_CONFIG set, Docker no longer looks for plugins in
# ~/.docker/cli-plugins, so Compose must be installed system-wide.
docker compose version >/dev/null 2>&1 \
  || fail "docker compose not found; install the docker-compose-plugin package"
docker login ghcr.io --username "$ghcr_user" --password-stdin >/dev/null
log "logged in to ghcr.io"

current_tag() { sed -n 's/^IMAGE_TAG=//p' .env; }

set_tag() {
  if grep -q '^IMAGE_TAG=' .env; then
    sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$1/" .env
  else
    printf 'IMAGE_TAG=%s\n' "$1" >>.env
  fi
}

# Replaces the active compose files with the ones in the given directory.
install_compose_files() {
  rm -f docker-compose*.yml
  cp "$1"/docker-compose*.yml .
}

up() {
  docker compose up --detach --remove-orphans --wait --wait-timeout "$WAIT_TIMEOUT"
}

previous_tag=$(current_tag)
log "deploying $tag (currently ${previous_tag:-none})"

# Keep the running state so a failed deploy can restore it.
rm -rf "$PREVIOUS"
mkdir "$PREVIOUS"
if compgen -G 'docker-compose*.yml' >/dev/null; then
  cp docker-compose*.yml "$PREVIOUS"/
fi

rollback() {
  log "deploy of $tag failed"
  if ! compgen -G "$PREVIOUS/docker-compose*.yml" >/dev/null; then
    fail "first deploy, nothing to roll back to"
  fi
  log "rolling back to $previous_tag"
  install_compose_files "$PREVIOUS"
  set_tag "$previous_tag"
  if up; then
    fail "rolled back to $previous_tag"
  fi
  docker compose ps
  fail "rollback to $previous_tag failed as well, check the server"
}

install_compose_files "$INCOMING"
set_tag "$tag"

# Only our own images: postgres is updated deliberately, not on every deploy,
# because a new image would restart the database.
docker compose pull --quiet backend web || rollback
up || { docker compose ps; docker compose logs --tail 50 backend web; rollback; }

log "all containers healthy"
docker compose ps

# Remove our images no container uses anymore (older versions). Images of the
# other environment are still in use and stay.
docker image prune --all --force --filter "label=$IMAGE_LABEL" >/dev/null
rm -rf "$INCOMING"
log "deployed $tag"
