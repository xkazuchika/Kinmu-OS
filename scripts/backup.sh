#!/bin/sh
set -eu

COMPOSE_FILE="${COMPOSE_FILE:-compose.production.yaml}"
ENV_FILE="${ENV_FILE:-.env.production}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
test -f "$ENV_FILE"

if docker compose version >/dev/null 2>&1; then
  compose() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }
elif command -v docker-compose >/dev/null 2>&1; then
  compose() { docker-compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }
else
  echo "Docker Compose is required." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
umask 077
PARTIAL="$(mktemp "$BACKUP_DIR/kinmu-$TIMESTAMP-XXXXXX")"
FILE="$PARTIAL.dump"
trap 'rm -f "$PARTIAL"' EXIT
trap 'exit 1' HUP INT TERM
compose exec -T db sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$PARTIAL"
ln "$PARTIAL" "$FILE"
echo "$FILE"
