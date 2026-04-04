#!/bin/bash
# Wrapper script: starts cloudflared, extracts URL, pushes to GitHub
# Requires: GITHUB_TOKEN env var set

LOG=/tmp/cloudflared.log
REPO="grzlly/grzlly.github.io"
FILE_PATH="docs/tunnel.json"

# Start cloudflared in background
cloudflared tunnel --url http://localhost:3000 > "$LOG" 2>&1 &
CF_PID=$!

# Wait for URL to appear
echo "[tunnel-manager] Waiting for tunnel URL..."
for i in $(seq 1 30); do
  URL=$(grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1)
  if [ -n "$URL" ]; then
    echo "[tunnel-manager] Tunnel URL: $URL"
    break
  fi
  sleep 1
done

if [ -z "$URL" ]; then
  echo "[tunnel-manager] ERROR: Could not get tunnel URL after 30s"
  exit 1
fi

# Update tunnel.json on GitHub via API
if [ -n "$GITHUB_TOKEN" ]; then
  # Get current file SHA
  SHA=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
    "https://api.github.com/repos/$REPO/contents/$FILE_PATH" | \
    grep -oP '"sha":\s*"\K[^"]+' | head -1)

  CONTENT=$(echo -n "{\"tunnel\":\"$URL\"}" | base64 -w 0)

  curl -s -X PUT \
    -H "Authorization: token $GITHUB_TOKEN" \
    -H "Content-Type: application/json" \
    "https://api.github.com/repos/$REPO/contents/$FILE_PATH" \
    -d "{\"message\":\"Update tunnel URL\",\"content\":\"$CONTENT\",\"sha\":\"$SHA\"}"

  echo "[tunnel-manager] GitHub updated with new URL"
fi

# Keep running
wait $CF_PID
