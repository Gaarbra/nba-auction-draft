#!/usr/bin/env bash
# Compatibility for previously shared commands: the default is now weekly only.
set -euo pipefail
exec bash "$(dirname "$0")/install-refresh-schedule.sh" "$@"
