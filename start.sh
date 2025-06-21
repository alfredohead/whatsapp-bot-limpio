#!/bin/sh
set -e
# Ensure session directories exist with correct permissions
mkdir -p /app/session && chown -R node:node /app/session
exec su -s /bin/sh nodeuser -c "node index.js"
