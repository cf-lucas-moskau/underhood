#!/bin/bash
# Install underhood as a LaunchAgent: starts at login, restarts if it dies.
# Any arguments are passed to underhood, e.g.:
#   ./scripts/install.sh --host 100.x.y.z --allow-kill
set -euo pipefail

LABEL=dev.underhood
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AGENTS="${LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
PLIST="$AGENTS/$LABEL.plist"
DATA="${UNDERHOOD_DATA_DIR:-$HOME/.underhood}"
NODE="$(command -v node || true)"

if [ -z "$NODE" ]; then
  echo "node not found on PATH. Install Node 20.19+ (brew install node) and retry." >&2
  exit 1
fi

cd "$ROOT"
if [ ! -d node_modules ]; then npm ci --no-audit --no-fund; fi
npm run build --silent

mkdir -p "$AGENTS" "$DATA"

xml() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' <<<"$1"; }
ARGS="    <string>$(xml "$NODE")</string>
    <string>$(xml "$ROOT/dist/server/cli.js")</string>
    <string>--data-dir</string>
    <string>$(xml "$DATA")</string>"
for a in "$@"; do ARGS="$ARGS
    <string>$(xml "$a")</string>"; done

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
$ARGS
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>$(xml "$DATA/underhood.log")</string>
  <key>StandardErrorPath</key>
  <string>$(xml "$DATA/underhood.log")</string>
</dict>
</plist>
PLIST
plutil -lint "$PLIST" >/dev/null

if [ -n "${UNDERHOOD_NO_LOAD:-}" ]; then
  echo "Wrote $PLIST (not loaded)"
  exit 0
fi

DOMAIN="gui/$(id -u)"
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
launchctl kickstart -k "$DOMAIN/$LABEL"
echo "underhood installed and running. Logs: $DATA/underhood.log"
