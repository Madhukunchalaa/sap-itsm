#!/bin/bash

# ══════════════════════════════════════════════════════════════
# SAP ITSM Platform — Automatic Database Backup Script
# ══════════════════════════════════════════════════════════════

# Load environment variables if .env exists
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

# Configuration
BACKUP_DIR="./backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
FILENAME="itsm_db_backup_${TIMESTAMP}.sql"
DB_URL=${DATABASE_URL}

# Create backup directory if it doesn't exist
mkdir -p $BACKUP_DIR

echo "🚀 Starting backup of $DB_URL..."

# Run pg_dump
# Note: Requires pg_dump to be installed on the system
pg_dump "$DB_URL" > "$BACKUP_DIR/$FILENAME"

if [ $? -eq 0 ]; then
  echo "✅ Backup successful: $BACKUP_DIR/$FILENAME"
  
  # Optional: Keep only last 10 backups
  ls -t $BACKUP_DIR/itsm_db_backup_*.sql | tail -n +11 | xargs rm -f
else
  echo "❌ Backup failed!"
  exit 1
fi
