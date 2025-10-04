#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
LOG_DIR="$ROOT_DIR/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/retrain-$TIMESTAMP.log"

python "$ROOT_DIR/train.py" --refresh-data --data-root "$ROOT_DIR/data_exports" --output-root "$ROOT_DIR/models" "$@" | tee "$LOG_FILE"
