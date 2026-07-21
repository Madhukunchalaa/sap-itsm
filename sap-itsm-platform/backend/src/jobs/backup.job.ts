import cron from 'node-cron';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { logger } from '../config/logger';
import { sendEmail } from '../services/email.service';

const BACKUP_EMAIL = 'mkunchala@intraedge.com';

export async function performDatabaseBackup(): Promise<void> {
  return new Promise((resolve, reject) => {
    logger.info('Starting database backup process...');
    
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      const err = new Error('DATABASE_URL is not defined. Cannot perform backup.');
      logger.error(err.message);
      return reject(err);
    }

    const dateStr = new Date().toISOString().split('T')[0];
    const fileName = `db_backup_${dateStr}_${Date.now()}.sql`;
    const tempDir = path.join(__dirname, '../../temp');
    
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const filePath = path.join(tempDir, fileName);

    // Use spawn to avoid shell character escaping issues and buffer limits
    const { spawn } = require('child_process');
    const child = spawn('pg_dump', [dbUrl, '-F', 'c', '-f', filePath]);

    let stderr = '';
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('error', (error: Error) => {
      logger.error(`Database backup failed: ${error.message}`);
      return reject(error);
    });

    child.on('close', async (code: number) => {
      if (code !== 0) {
        const err = new Error(`pg_dump exited with code ${code}. Stderr: ${stderr}`);
        logger.error(err.message);
        return reject(err);
      }

      logger.info(`Backup successful, file saved to ${filePath}. Sending email to ${BACKUP_EMAIL}...`);

      try {
        await sendEmail({
          templateKey: 'DB_BACKUP',
          recipient: BACKUP_EMAIL,
          variables: {
            date: new Date().toLocaleString(),
          },
          attachments: [
            {
              filename: fileName,
              path: filePath,
              contentType: 'application/octet-stream',
            },
          ],
        });

        logger.info(`Database backup emailed successfully to ${BACKUP_EMAIL}.`);
        resolve();
      } catch (emailError) {
        logger.error(`Failed to send database backup email:`, emailError);
        reject(emailError);
      } finally {
        // Clean up the local file to save storage space
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          logger.info(`Cleaned up temporary backup file: ${filePath}`);
        }
      }
    });
  });
}

/**
 * Initializes the automated database backup cron job.
 * Runs at 1:30 PM IST (for testing).
 */
export function initBackupJob() {
  logger.info('Initializing automated database backup job (runs at 1:30 PM IST)...');

  // Runs at 16:35 IST daily (requested for testing)
  cron.schedule('35 16 * * *', async () => {
    try {
      await performDatabaseBackup();
    } catch (err) {
      logger.error('Scheduled backup failed:', err);
    }
  }, {
    timezone: 'Asia/Kolkata'
  });
}
