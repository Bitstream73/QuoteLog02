#!/bin/sh
# Fix ownership of volume-mounted directories
# Railway mounts volumes after container starts — they may be root-owned
if [ -d /app/data ]; then
  chown -R nodejs:nodejs /app/data 2>/dev/null || true
fi

# Execute the main command as nodejs user
exec su-exec nodejs "$@"
