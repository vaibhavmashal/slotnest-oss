#!/bin/sh
# Run your own Slotnest with Docker: app, Postgres and Caddy (HTTPS via Let's Encrypt) from deploy/compose.yml.
# Usage: scripts/selfhost.sh <domain>      e.g. scripts/selfhost.sh book.example.com, or localhost to try it out
# The first run writes deploy/.env with generated secrets; later runs rebuild and restart with what's in it.
set -eu
cd "$(dirname "$0")/.."
env_file=deploy/.env

if [ ! -f "$env_file" ]; then
  host=${1:?usage: scripts/selfhost.sh <domain>  (the domain this server answers on, or localhost)}
  # Docker can run openssl for us, so the host needs nothing but Docker.
  rand() { docker run --rm alpine:3 sh -c "apk add -q openssl >/dev/null && openssl rand $*"; }
  db_password=$(rand -hex 24)
  token_key=$(rand -base64 32)
  sed -e "s|^SITE_HOST=.*|SITE_HOST=$host|" \
      -e "s|^APP_URL=.*|APP_URL=https://$host|" \
      -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$db_password|" \
      -e "s|^TOKEN_ENCRYPTION_KEY=.*|TOKEN_ENCRYPTION_KEY=$token_key|" \
      -e "s|^EMAIL_FROM=.*|EMAIL_FROM=\"Slotnest <bookings@$host>\"|" \
      deploy/env.production.example > "$env_file"
  chmod 600 "$env_file"
  echo "Wrote $env_file. Keep a copy of TOKEN_ENCRYPTION_KEY: losing it means everyone reconnects their calendars."
fi

docker build -t slotnest:latest .
docker compose -f deploy/compose.yml --env-file "$env_file" up -d

host=$(sed -n 's/^SITE_HOST=//p' "$env_file")
echo
echo "Slotnest is starting at https://$host (migrations run first; give it a minute)."
echo "Sign in at https://$host/login. Until you set up email in $env_file, the sign-in link is printed here:"
echo "  docker compose -f deploy/compose.yml logs app | grep -A8 'Sign in to Slotnest'"
