#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <dmg> [<dmg> ...]" >&2
  exit 2
fi

: "${APPLE_API_KEY:?APPLE_API_KEY is required}"
: "${APPLE_API_KEY_ID:?APPLE_API_KEY_ID is required}"
: "${APPLE_API_ISSUER:?APPLE_API_ISSUER is required}"

for dmg in "$@"; do
  test -f "$dmg"
  xcrun notarytool submit "$dmg" \
    --key "$APPLE_API_KEY" \
    --key-id "$APPLE_API_KEY_ID" \
    --issuer "$APPLE_API_ISSUER" \
    --wait
  xcrun stapler staple "$dmg"
  xcrun stapler validate "$dmg"
done
