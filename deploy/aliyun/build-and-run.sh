#!/usr/bin/env bash

set -euo pipefail

HOST_PORT="${1:-9000}"
IMAGE="${IMAGE:-ai-job-agent:local}"
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"

if [[ ! -f "$DEPLOY_DIR/.env.prod" ]]; then
  echo "missing $DEPLOY_DIR/.env.prod"
  echo "copy .env.prod.example to .env.prod and fill values first"
  exit 1
fi

cd "$ROOT_DIR"
docker build -t "$IMAGE" .
SKIP_PULL=1 bash "$DEPLOY_DIR/deploy-ecs.sh" "$IMAGE" "$HOST_PORT"
