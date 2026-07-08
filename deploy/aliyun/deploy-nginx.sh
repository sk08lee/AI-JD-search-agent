#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: ./deploy/aliyun/deploy-nginx.sh <image> <domain>"
  echo "example: ./deploy/aliyun/deploy-nginx.sh registry.cn-hangzhou.aliyuncs.com/your_ns/ai-job-agent:latest agent.example.com"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required"
  exit 1
fi

if ! command -v docker compose >/dev/null 2>&1; then
  echo "docker compose is required"
  exit 1
fi

IMAGE="$1"
DOMAIN="$2"
DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"

if [[ ! -f "$DEPLOY_DIR/.env.prod" ]]; then
  echo "missing $DEPLOY_DIR/.env.prod"
  echo "copy .env.prod.example to .env.prod and fill values first"
  exit 1
fi

mkdir -p "$DEPLOY_DIR/output" "$DEPLOY_DIR/certbot/www" "$DEPLOY_DIR/certbot/conf" "$DEPLOY_DIR/nginx"

export DOMAIN
if [[ -f "$DEPLOY_DIR/certbot/conf/live/$DOMAIN/fullchain.pem" && -f "$DEPLOY_DIR/certbot/conf/live/$DOMAIN/privkey.pem" ]]; then
  envsubst '${DOMAIN}' < "$DEPLOY_DIR/nginx/https.conf.template" > "$DEPLOY_DIR/nginx/default.conf"
  echo "existing certificate detected, using HTTPS config"
else
  envsubst '${DOMAIN}' < "$DEPLOY_DIR/nginx/http.conf.template" > "$DEPLOY_DIR/nginx/default.conf"
  echo "certificate not found, using HTTP config"
fi

export IMAGE
docker compose -f "$DEPLOY_DIR/docker-compose.nginx.yml" pull
docker compose -f "$DEPLOY_DIR/docker-compose.nginx.yml" up -d
docker compose -f "$DEPLOY_DIR/docker-compose.nginx.yml" ps

if [[ -f "$DEPLOY_DIR/certbot/conf/live/$DOMAIN/fullchain.pem" && -f "$DEPLOY_DIR/certbot/conf/live/$DOMAIN/privkey.pem" ]]; then
  echo "deployment ready: https://${DOMAIN}"
else
  echo "HTTP deployment ready. Resolve domain DNS to ECS IP, then run:"
  echo "bash deploy/aliyun/enable-https.sh ${DOMAIN}"
fi
