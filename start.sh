#!/bin/sh
set -e
# Ensure session directories exist with correct permissions
mkdir -p /app/session/wwebjs_auth_data/session
chown -R nodeuser:nodejs /app/session || true
exec su -s /bin/sh nodeuser -c "node index.js"
