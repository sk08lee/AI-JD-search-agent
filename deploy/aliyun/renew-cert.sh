#!/usr/bin/env bash

set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"

docker run --rm \
  -v "$DEPLOY_DIR/certbot/www:/var/www/certbot" \
  -v "$DEPLOY_DIR/certbot/conf:/etc/letsencrypt" \
  certbot/certbot:latest \
  renew --webroot -w /var/www/certbot

docker compose -f "$DEPLOY_DIR/docker-compose.nginx.yml" exec -T nginx nginx -s reload
