#!/bin/bash
# Umbrel injects APP_BITCOIN_* automatically (dependencies: [bitcoin]).
# Single source of truth for app identity (used by hooks for build + cleanup).
export SINGULARITY_APP_ID="singularity-pool"
export SINGULARITY_IMAGE_REPO="ghcr.io/blackhole-axe/singularity-pool"
