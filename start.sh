#!/bin/sh
set -e

# Robustecemos la lectura de variables desde /app/.env si existe
if [ -f /app/.env ]; then
  set -o allexport
  . /app/.env
  set +o allexport
fi

# Ensure session directories exist with correct permissions
SESSION_DIR=/app/session/wwebjs_auth_data/session
mkdir -p "$SESSION_DIR"

# Fix permissions in case the volume was mounted with root ownership
chown -R nodeuser:nodejs /app/session || true

# Remove Chromium lock files that may remain from a crashed session
rm -f "$SESSION_DIR/SingletonLock" "$SESSION_DIR/SingletonCookie" "$SESSION_DIR/SingletonSocket"

# Launch the bot as the nodeuser while preserving environment variables
exec su --preserve-environment -s /bin/sh nodeuser -c "node index.js"
