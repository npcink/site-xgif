#!/bin/sh
# Called only inside an isolated source copy on the M4 host.
set -eu
RUN_ID=$1
shift
case "$RUN_ID" in xgif-visual-????????????-????????????) ;; *) exit 2 ;; esac
SITE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cleanup() { docker rm --force "$RUN_ID" >/dev/null 2>&1 || :; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
docker run --rm --init --ipc=host \
  --name "$RUN_ID" --label "xgif.visual.run=$RUN_ID" \
  --user "$(id -u):$(id -g)" \
  --env CI=1 --env ASTRO_TELEMETRY_DISABLED=1 --env npm_config_cache=/tmp/xgif-npm-cache \
  --volume "$SITE_DIR:/work" --workdir /work \
  mcr.microsoft.com/playwright:v1.61.1-noble \
  sh -c 'npm ci && npm run test:visual -- "$@"' sh "$@"
