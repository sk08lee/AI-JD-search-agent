#!/usr/bin/env bash

set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required"
  exit 1
fi

if ! command -v docker compose >/dev/null 2>&1; then
  echo "docker compose is required"
  exit 1
fi

if [[ $# -lt 1 ]]; then
  echo "usage: ./deploy/aliyun/deploy-ecs.sh <image> [host_port]"
  echo "example: ./deploy/aliyun/deploy-ecs.sh registry.cn-hangzhou.aliyuncs.com/your_ns/ai-job-agent:latest 9000"
  exit 1
fi

IMAGE="$1"
HOST_PORT="${2:-9000}"
DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"

if [[ ! -f "$DEPLOY_DIR/.env.prod" ]]; then
  echo "missing $DEPLOY_DIR/.env.prod"
  echo "copy .env.prod.example to .env.prod and fill values first"
  exit 1
fi

mkdir -p "$DEPLOY_DIR/output"
export IMAGE HOST_PORT

docker compose -f "$DEPLOY_DIR/docker-compose.ecs.yml" pull
docker compose -f "$DEPLOY_DIR/docker-compose.ecs.yml" up -d
docker compose -f "$DEPLOY_DIR/docker-compose.ecs.yml" ps
