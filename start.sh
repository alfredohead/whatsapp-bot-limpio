#!/bin/sh
set -e

# Load environment variables from .env if provided
if [ -f /app/.env ]; then
  # Export variables while ignoring comments and blank lines
  export $(grep -v '^#' /app/.env | xargs) || true
fi

# Ensure session directories exist with correct permissions
SESSION_DIR=/app/session/wwebjs_auth_data/session
mkdir -p "$SESSION_DIR"

# Fix permissions in case the volume was mounted with root ownership
chown -R nodeuser:nodejs /app/session || true

# Remove Chromium lock files that may remain from a crashed session
rm -f "$SESSION_DIR/SingletonLock" "$SESSION_DIR/SingletonCookie" "$SESSION_DIR/SingletonSocket"

# Create writable directory for temporary audio files
TEMP_AUDIO_DIR=${TEMP_AUDIO_DIR:-/app/temp_audio}
mkdir -p "$TEMP_AUDIO_DIR"
chown -R nodeuser:nodejs "$TEMP_AUDIO_DIR" || true

# Launch the bot as the nodeuser while preserving environment variables
exec su --preserve-environment -s /bin/sh nodeuser -c "node index.js"
