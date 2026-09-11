#!/usr/bin/env bash
# Chrome launches this with a tiny PATH. Find Node portably (no machine-specific
# install paths), then exec the compiled relay host from `npm run build:extension`.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"

NODE=""
for candidate in "$HOME/.local/share/mise/shims/node" /usr/local/bin/node /usr/bin/node; do
  if [[ -x "$candidate" ]]; then
    NODE="$candidate"
    break
  fi
done
if [[ -z "$NODE" ]]; then
  NODE="$(command -v node)"
fi

exec "$NODE" "$DIR/../nativeHost.js"
