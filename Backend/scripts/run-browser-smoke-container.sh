#!/usr/bin/env bash
set -euo pipefail

has_profile=false
for argument in "$@"; do
  if [[ "${argument}" == "--profile" ]]; then has_profile=true; fi
done

if [[ "${has_profile}" == "false" ]]; then
  mapfile -t profiles < <(node scripts/run-browser-smoke.js "$@" --list | node -e '
    let input = "";
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => { for (const profile of JSON.parse(input).profiles) console.log(profile); });
  ')
  failures=()
  for profile in "${profiles[@]}"; do
    if ! "$0" "$@" --profile "${profile}"; then failures+=("${profile}"); fi
  done
  if (( ${#failures[@]} )); then
    echo "Browser-Smoke fehlgeschlagen: ${failures[*]}" >&2
    exit 1
  fi
  exit 0
fi

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
runtime_dir="${XDG_RUNTIME_DIR:-}"
if [[ -z "${runtime_dir}" || ! -d "${runtime_dir}" || ! -w "${runtime_dir}" ]]; then
  runtime_dir="/run/user/$(id -u)"
fi
if [[ ! -d "${runtime_dir}" || ! -w "${runtime_dir}" ]]; then runtime_dir="/tmp"; fi
lock_file="${runtime_dir}/epiber-playwright-smoke.lock"
container_name="epiber-playwright-smoke-$(id -u)-$$"
cid_file="${runtime_dir}/${container_name}.cid"

cleanup() {
  if [[ -s "${cid_file}" ]]; then
    "${runtime}" rm -f "$(cat "${cid_file}")" >/dev/null 2>&1 || true
  fi
  rm -f "${cid_file}"
}
trap cleanup EXIT INT TERM HUP

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
  --cidfile "${cid_file}" \
  --cpus "${PLAYWRIGHT_SMOKE_CPUS:-3}" \
  --memory "${PLAYWRIGHT_SMOKE_MEMORY:-3g}" \
  --pids-limit "${PLAYWRIGHT_SMOKE_PIDS:-1024}" \
  --network none \
  --user "$(id -u):$(id -g)" \
  --env HOME=/tmp \
  --volume "${repository_root}:/workspace:ro" \
  --workdir /workspace/Backend \
  "${image}" \
  node scripts/run-browser-smoke.js "$@"
