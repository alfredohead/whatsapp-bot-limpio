#!/bin/sh
set -e

echo "DEBUG: User ID: $(id -u)"
echo "DEBUG: Group ID: $(id -g)"
echo "DEBUG: Whoami: $(whoami)"

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

# Resolve repository directory to support ejecución local fuera de /app
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Ensure session directories exist with correct permissions
DEFAULT_LOCAL_SESSION="$SCRIPT_DIR/session/wwebjs_auth_data"
SESSION_DIR="${WA_SESSION_PATH:-${WHATSAPP_SESSION_PATH:-}}"
if [ -z "$SESSION_DIR" ]; then
  if [ -d /app ]; then
    SESSION_DIR="/app/session/wwebjs_auth_data"
  else
    SESSION_DIR="$DEFAULT_LOCAL_SESSION"
  fi
fi

mkdir -p "$SESSION_DIR"
echo "INFO: Directorio de sesión asegurado en $SESSION_DIR"

# Fix permissions in case the volume was mounted with root ownership
if id -u nodeuser >/dev/null 2>&1; then
  chown -R nodeuser:nodeuser "$SESSION_DIR" 2>/dev/null || true
fi

# Ensure temp_audio directory exists and has correct permissions
DEFAULT_LOCAL_TEMP="$SCRIPT_DIR/temp_audio"
TEMP_AUDIO_DIR="${WA_TEMP_AUDIO:-${WHATSAPP_TEMP_AUDIO_DIR:-}}"
if [ -z "$TEMP_AUDIO_DIR" ]; then
  if [ -d /app ]; then
    TEMP_AUDIO_DIR="/app/temp_audio"
  else
    TEMP_AUDIO_DIR="$DEFAULT_LOCAL_TEMP"
  fi
fi

mkdir -p "$TEMP_AUDIO_DIR"
echo "INFO: Directorio temporal de audio asegurado en $TEMP_AUDIO_DIR"
if id -u nodeuser >/dev/null 2>&1; then
  chown -R nodeuser:nodeuser "$TEMP_AUDIO_DIR" 2>/dev/null || true
fi
chmod 755 "$TEMP_AUDIO_DIR" || true

# Remove Chromium lock files that may remain from a crashed session
rm -f "$SESSION_DIR/SingletonLock" "$SESSION_DIR/SingletonCookie" "$SESSION_DIR/SingletonSocket"

# Launch the bot
exec node index.js