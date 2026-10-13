#!/bin/bash
# Stop underhood and remove its LaunchAgent. History in ~/.underhood is kept.
set -euo pipefail
LABEL=dev.underhood
PLIST="${LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}/$LABEL.plist"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$PLIST"
echo "underhood removed. Delete ~/.underhood to drop its history."
