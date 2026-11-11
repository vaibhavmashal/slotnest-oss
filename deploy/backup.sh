#!/bin/sh
# Nightly backup on the droplet (cron, see cloud-init.yml): database dump plus uploaded logos and photos.
# Keeps 14 days in /opt/slotnest/backups. Droplet backups (DigitalOcean) give a second, off-machine copy.
set -eu
cd /opt/slotnest
stamp=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p backups
docker compose exec -T db pg_dump -U slotnest -Fc slotnest > "backups/db-$stamp.dump"
docker compose exec -T app tar -C /data -cz assets > "backups/assets-$stamp.tar.gz"
find backups -type f -mtime +14 -delete
