#!/bin/sh
# Build the image here, copy it to the droplet over SSH, and restart the app (migrations run on start).
# Usage: scripts/deploy.sh root@<droplet-ip>
# No registry is involved: the image is streamed with docker save | docker load.
set -eu
target=${1:?usage: scripts/deploy.sh root@<droplet-ip>}
tag=$(git rev-parse --short HEAD)
[ -z "$(git status --porcelain)" ] || { echo "Commit your changes first; the image is tagged with the commit." >&2; exit 1; }

docker buildx build --platform linux/amd64 -t "slotnest:$tag" --load .
scp deploy/compose.yml "$target:/opt/slotnest/compose.yml"
scp deploy/Caddyfile deploy/backup.sh "$target:/opt/slotnest/"
docker save "slotnest:$tag" | gzip | ssh "$target" 'gunzip | docker load'
ssh "$target" "cd /opt/slotnest && sed -i 's/^APP_TAG=.*/APP_TAG=$tag/' .env && docker compose up -d && docker image prune -f"
echo "Deployed slotnest:$tag"
