#!/bin/sh
set -e
# Ensure the session directory is owned by nodeuser so Chromium can write to it
if [ -d /app/session ]; then
  chown -R nodeuser:nodejs /app/session || true
fi
exec su -s /bin/sh nodeuser -c "node index.js"
