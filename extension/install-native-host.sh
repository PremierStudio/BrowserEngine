#!/usr/bin/env bash
# Install the Chrome native-messaging host so the unpacked extension can
# reach a running `browser-engine` MCP process.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
HOST="$ROOT/native/host.sh"
chmod +x "$HOST"
ID="pofhkiebdcchdedejdniobgfgakllkij"
DEST_DIR="${HOME}/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
mkdir -p "$DEST_DIR"
cat > "${DEST_DIR}/ai.premierstudio.browser_engine.json" <<EOF
{
  "name": "ai.premierstudio.browser_engine",
  "description": "BrowserEngine native host",
  "path": "${HOST}",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://${ID}/"
  ]
}
EOF
echo "Wrote ${DEST_DIR}/ai.premierstudio.browser_engine.json"
echo "Load unpacked: ${ROOT}"
echo "Expected extension ID: ${ID}"
