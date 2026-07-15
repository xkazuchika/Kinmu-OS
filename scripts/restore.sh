#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: CONFIRM_RESTORE=EMPTY_DATABASE scripts/restore.sh backup.dump" >&2
  exit 2
fi
if [ "${CONFIRM_RESTORE:-}" != "EMPTY_DATABASE" ]; then
  echo "Restore refused. Set CONFIRM_RESTORE=EMPTY_DATABASE after confirming the target is empty." >&2
  exit 2
fi

FILE="$1"
COMPOSE_FILE="${COMPOSE_FILE:-compose.production.yaml}"
ENV_FILE="${ENV_FILE:-.env.production}"
test -f "$FILE"
test -f "$ENV_FILE"

if docker compose version >/dev/null 2>&1; then
  compose() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }
elif command -v docker-compose >/dev/null 2>&1; then
  compose() { docker-compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }
else
  echo "Docker Compose is required." >&2
  exit 1
fi

TABLE_COUNT="$(compose exec -T db psql -U "${POSTGRES_USER:-kinmu}" -d "${POSTGRES_DB:-kinmu}" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public';")"
if [ "$TABLE_COUNT" -ne 0 ]; then
  echo "Restore refused: the target database is not empty." >&2
  exit 1
fi

compose exec -T db pg_restore \
  -U "${POSTGRES_USER:-kinmu}" -d "${POSTGRES_DB:-kinmu}" --exit-on-error < "$FILE"
echo "Restore completed."
