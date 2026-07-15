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

compose build migrator app
compose run --rm migrator
compose up -d --no-deps app
compose ps
