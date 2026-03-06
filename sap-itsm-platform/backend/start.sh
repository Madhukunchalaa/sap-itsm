#!/bin/sh
set -e

echo "=== SAP ITSM Backend Starting ==="
echo "PORT: ${PORT:-3001}"
echo "NODE_ENV: ${NODE_ENV:-production}"
echo "DATABASE_URL set: $([ -n "$DATABASE_URL" ] && echo YES || echo NO)"
echo "REDIS_URL set: $([ -n "$REDIS_URL" ] && echo YES || echo NO)"

echo "Running migrations..."
node_modules/.bin/prisma db push --accept-data-loss

echo "Starting server..."
exec node dist/server.js
