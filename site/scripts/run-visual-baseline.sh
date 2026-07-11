#!/bin/sh

set -eu

IMAGE="mcr.microsoft.com/playwright:v1.61.1-noble"
SITE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
NODE_MODULES_VOLUME="xgif-playwright-node-modules"
USER_ID=$(id -u)
GROUP_ID=$(id -g)

docker volume create "$NODE_MODULES_VOLUME" >/dev/null
docker run --rm \
  --volume "$NODE_MODULES_VOLUME:/work/node_modules" \
  "$IMAGE" \
  chown "$USER_ID:$GROUP_ID" /work/node_modules

docker run --rm --init --ipc=host \
  --user "$USER_ID:$GROUP_ID" \
  --env CI=1 \
  --env HOME=/tmp \
  --volume "$SITE_DIR:/work" \
  --volume "$NODE_MODULES_VOLUME:/work/node_modules" \
  --workdir /work \
  "$IMAGE" \
  sh -lc 'npm ci && npm run test:visual -- "$@"' sh "$@"
