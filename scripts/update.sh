#!/bin/sh
set -eu

COMPOSE_FILE="${COMPOSE_FILE:-compose.production.yaml}"
ENV_FILE="${ENV_FILE:-.env.production}"
test -f "$ENV_FILE"

if docker compose version >/dev/null 2>&1; then
  compose() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }
elif command -v docker-compose >/dev/null 2>&1; then
  compose() { docker-compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }
else
  echo "Docker Compose is required." >&2
  exit 1
fi

compose build migrator app worker
compose stop worker
if ! compose run --rm migrator; then
  echo "Migration failed. Existing app retained; worker remains stopped. Restore the pre-update backup with the matching previous release, or fix the migration and rerun this update." >&2
  exit 1
fi
compose up -d --no-deps app worker
compose ps
