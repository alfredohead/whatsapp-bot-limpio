#!/bin/sh
set -e

CURRENT_USER=$(whoami)
echo "ENTRYPOINT: Ejecutando este script como usuario: $CURRENT_USER"
echo "ENTRYPOINT: Intentando ejecutar CMD ('$*') como 'nodeuser' via gosu..."

# Ejecuta el CMD pasado desde el Dockerfile (ej. "node", "index.js") como 'nodeuser'
exec gosu nodeuser "$@"
