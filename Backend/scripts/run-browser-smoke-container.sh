#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${CONTAINER_RUNTIME:-}" ]]; then
  runtime="${CONTAINER_RUNTIME}"
elif command -v docker >/dev/null 2>&1; then
  runtime="docker"
elif command -v podman >/dev/null 2>&1; then
  runtime="podman"
else
  echo "Browser-Smoke benoetigt podman oder docker." >&2
  exit 1
fi

backend_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repository_root="$(dirname "${backend_root}")"
image="mcr.microsoft.com/playwright:v1.62.1-noble"
lock_file="${XDG_RUNTIME_DIR:-/tmp}/epiber-playwright-smoke.lock"
container_name="epiber-playwright-smoke-$(id -u)"

exec 9>"${lock_file}"
if ! flock -n 9; then
  echo "Eine Browser-Smokesuite laeuft bereits." >&2
  exit 1
fi

if [[ "${runtime}" == "docker" && -z "${DOCKER_HOST:-}" && -S "/run/user/$(id -u)/docker.sock" ]]; then
  export DOCKER_HOST="unix:///run/user/$(id -u)/docker.sock"
fi

"${runtime}" run --rm --ipc=host \
  --name "${container_name}" \
  --cpus "${PLAYWRIGHT_SMOKE_CPUS:-2}" \
  --memory "${PLAYWRIGHT_SMOKE_MEMORY:-2g}" \
  --pids-limit "${PLAYWRIGHT_SMOKE_PIDS:-512}" \
  --network none \
  --user "$(id -u):$(id -g)" \
  --env HOME=/tmp \
  --volume "${repository_root}:/workspace:ro" \
  --workdir /workspace/Backend \
  "${image}" \
  node scripts/run-browser-smoke.js
