#!/bin/sh
set -eu
# Railway mounts volumes as root. Grant only the checkout directory to the app user.
if [ -n "${CHECKOUT_DATA_DIR:-}" ]; then
  mkdir -p "$CHECKOUT_DATA_DIR"
  chown node:node "$CHECKOUT_DATA_DIR"
  chmod 700 "$CHECKOUT_DATA_DIR"
fi
exec su-exec node "$@"
