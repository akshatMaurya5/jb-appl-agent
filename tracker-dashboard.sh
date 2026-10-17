#!/usr/bin/env bash

# tracker-dashboard.sh — Open Career-Ops Interactive Dashboard in Browser
# Re-generates latest application data from data/applications.md and launches your default browser.

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HTML_PATH="$DIR/tracker-dashboard.html"

echo "=========================================================="
echo "  ⚡ Career-Ops Interactive Application Dashboard"
echo "=========================================================="

# 1. Regenerate dashboard from data/applications.md
if command -v node >/dev/null 2>&1; then
  node "$DIR/generate-dashboard.mjs"
else
  echo "⚠ Warning: Node.js not detected in PATH; using existing dashboard HTML."
fi

# 2. Check that the dashboard HTML exists
if [ ! -f "$HTML_PATH" ]; then
  echo "❌ Error: Dashboard file not found at: $HTML_PATH"
  exit 1
fi

echo ""
echo "🚀 Opening dashboard in your default browser..."
echo "📂 Path: $HTML_PATH"

# 3. Open in platform-specific default browser
OS_TYPE="$(uname -s)"
case "$OS_TYPE" in
  Darwin*)
    open "$HTML_PATH"
    ;;
  Linux*)
    if grep -qi microsoft /proc/version 2>/dev/null; then
      # WSL environment
      wslpath -w "$HTML_PATH" | xargs -I {} cmd.exe /c start "" "{}"
    elif command -v xdg-open >/dev/null 2>&1; then
      xdg-open "$HTML_PATH"
    elif command -v sensible-browser >/dev/null 2>&1; then
      sensible-browser "$HTML_PATH"
    else
      echo "Please open: file://$HTML_PATH in your browser."
    fi
    ;;
  CYGWIN*|MINGW*|MSYS*)
    start "$HTML_PATH"
    ;;
  *)
    echo "Please open: file://$HTML_PATH in your browser."
    ;;
esac

echo ""
echo "✓ Done! Press Ctrl+C if you ran this in a dedicated terminal."
