#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: ./deploy/aliyun/enable-https.sh <domain> [email]"
  echo "example: ./deploy/aliyun/enable-https.sh agent.example.com ops@example.com"
  exit 1
fi

DOMAIN="$1"
EMAIL="${2:-}"
DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required"
  exit 1
fi

if ! command -v docker compose >/dev/null 2>&1; then
  echo "docker compose is required"
  exit 1
fi

mkdir -p "$DEPLOY_DIR/certbot/www" "$DEPLOY_DIR/certbot/conf" "$DEPLOY_DIR/nginx"

CERTBOT_ARGS=(certonly --webroot -w /var/www/certbot -d "$DOMAIN")
if [[ -n "$EMAIL" ]]; then
  CERTBOT_ARGS+=(--email "$EMAIL")
else
  CERTBOT_ARGS+=(--register-unsafely-without-email)
fi
CERTBOT_ARGS+=(--agree-tos --non-interactive)

docker run --rm \
  -v "$DEPLOY_DIR/certbot/www:/var/www/certbot" \
  -v "$DEPLOY_DIR/certbot/conf:/etc/letsencrypt" \
  certbot/certbot:latest \
  "${CERTBOT_ARGS[@]}"

export DOMAIN
envsubst '${DOMAIN}' < "$DEPLOY_DIR/nginx/https.conf.template" > "$DEPLOY_DIR/nginx/default.conf"
docker compose -f "$DEPLOY_DIR/docker-compose.nginx.yml" up -d
docker compose -f "$DEPLOY_DIR/docker-compose.nginx.yml" exec -T nginx nginx -s reload

echo "HTTPS enabled: https://${DOMAIN}"
