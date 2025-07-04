#!/bin/sh
set -e

# Robustecemos la lectura de variables desde /app/.env si existe
# Solo cargar .env si no estamos en Fly.io (FLY_APP_NAME no está definido)
if [ -z "$FLY_APP_NAME" ] && [ -f /app/.env ]; then
  echo "INFO: FLY_APP_NAME no está definido, cargando /app/.env"
  set -o allexport
  . /app/.env
  set +o allexport
else
  if [ -n "$FLY_APP_NAME" ]; then
    echo "INFO: FLY_APP_NAME está definido, omitiendo carga de /app/.env para usar secretos de Fly.io."
  else
    echo "INFO: /app/.env no encontrado, continuando sin cargar variables de archivo .env."
  fi
fi

# Ensure session directories exist with correct permissions
SESSION_DIR=/app/session/wwebjs_auth_data/session
mkdir -p "$SESSION_DIR"

# Fix permissions in case the volume was mounted with root ownership
# Use a more specific path to avoid issues with /app itself
chown -R nodeuser:nodejs /app/session || true

# Ensure temp_audio directory exists and has correct permissions
TEMP_AUDIO_DIR=/app/temp_audio
mkdir -p "$TEMP_AUDIO_DIR"
chown -R nodeuser:nodejs "$TEMP_AUDIO_DIR" || true
chmod 755 "$TEMP_AUDIO_DIR"

# Remove Chromium lock files that may remain from a crashed session
rm -f "$SESSION_DIR/SingletonLock" "$SESSION_DIR/SingletonCookie" "$SESSION_DIR/SingletonSocket"

# Launch the bot as the nodeuser while preserving environment variables
exec su --preserve-environment -s /bin/sh nodeuser -c "node index.js"


