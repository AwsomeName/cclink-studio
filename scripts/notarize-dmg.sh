#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <dmg> [<dmg> ...]" >&2
  exit 2
fi

: "${APPLE_API_KEY:?APPLE_API_KEY is required}"
: "${APPLE_API_KEY_ID:?APPLE_API_KEY_ID is required}"
: "${APPLE_API_ISSUER:?APPLE_API_ISSUER is required}"
: "${CSC_LINK:?CSC_LINK is required}"
: "${CSC_KEY_PASSWORD:?CSC_KEY_PASSWORD is required}"
: "${CSC_NAME:?CSC_NAME is required}"

certificate_path="$RUNNER_TEMP/developer-id-dmg.p12"
keychain_path="$RUNNER_TEMP/dmg-signing.keychain-db"
keychain_password="$(uuidgen)"

cleanup_keychain() {
  security delete-keychain "$keychain_path" >/dev/null 2>&1 || true
}
trap cleanup_keychain EXIT

printf '%s' "$CSC_LINK" | base64 -D > "$certificate_path"
security create-keychain -p "$keychain_password" "$keychain_path"
security set-keychain-settings -lut 21600 "$keychain_path"
security unlock-keychain -p "$keychain_password" "$keychain_path"
security import "$certificate_path" \
  -k "$keychain_path" \
  -P "$CSC_KEY_PASSWORD" \
  -T /usr/bin/codesign \
  -T /usr/bin/security

for dmg in "$@"; do
  test -f "$dmg"
  codesign \
    --force \
    --sign "$CSC_NAME" \
    --timestamp \
    --keychain "$keychain_path" \
    "$dmg"
  codesign --verify --verbose=2 "$dmg"
  xcrun notarytool submit "$dmg" \
    --key "$APPLE_API_KEY" \
    --key-id "$APPLE_API_KEY_ID" \
    --issuer "$APPLE_API_ISSUER" \
    --wait
  xcrun stapler staple "$dmg"
  xcrun stapler validate "$dmg"
  spctl \
    --assess \
    --type open \
    --context context:primary-signature \
    --verbose=4 \
    "$dmg"
done
