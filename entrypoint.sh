#!/bin/sh
set -e
# Ejecuta el CMD pasado desde el Dockerfile (ej. "node", "index.js") como 'nodeuser'
exec gosu nodeuser "$@"
