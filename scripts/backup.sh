#!/bin/sh
set -eu

COMPOSE_FILE="${COMPOSE_FILE:-compose.production.yaml}"
ENV_FILE="${ENV_FILE:-.env.production}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$BACKUP_DIR/kinmu-$TIMESTAMP.dump"
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
compose exec -T db pg_dump \
  -U "${POSTGRES_USER:-kinmu}" -d "${POSTGRES_DB:-kinmu}" -Fc > "$FILE"
chmod 600 "$FILE"
echo "$FILE"
