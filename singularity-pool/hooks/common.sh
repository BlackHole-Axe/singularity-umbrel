#!/usr/bin/env bash
set -euo pipefail
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${HOOK_DIR}/../exports.sh"

singularity_clean_containers() {
  docker ps -aq --filter "name=${SINGULARITY_APP_ID}_" 2>/dev/null \
    | xargs -r docker rm -f 2>/dev/null || true
}
singularity_clean_images() {
  docker images "${SINGULARITY_IMAGE_REPO}" --format '{{.ID}}' 2>/dev/null \
    | sort -u | xargs -r docker rmi -f 2>/dev/null || true
}
singularity_full_cleanup() { singularity_clean_containers; singularity_clean_images; }

# Build the image on-device from the bundled pool/ source so install works
# without publishing to a registry. Tag :latest only (compose references it).
singularity_build_image() {
  local app_data_dir="$1"
  local pool_src="${app_data_dir}/pool"
  if [[ ! -f "${pool_src}/Dockerfile" ]]; then
    echo "SINGULARITY (${SINGULARITY_APP_ID}): no pool/ source found at ${pool_src}"
    return 0
  fi
  echo "SINGULARITY (${SINGULARITY_APP_ID}): building image from bundled source..."
  docker build -t "${SINGULARITY_IMAGE_REPO}:latest" "${pool_src}"
}
