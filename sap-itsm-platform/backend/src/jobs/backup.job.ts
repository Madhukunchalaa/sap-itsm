import cron from 'node-cron';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { logger } from '../config/logger';
import { sendEmail } from '../services/email.service';

const BACKUP_EMAIL = 'mkunchala@intraedge.com';

/**
 * Initializes the automated database backup cron job.
 * Runs at 1:30 PM IST (for testing).
 */
export function initBackupJob() {
  logger.info('Initializing automated database backup job (runs at 1:30 PM IST)...');

  cron.schedule('30 13 * * *', async () => {
    logger.info('Starting automated database backup...');
    
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      logger.error('DATABASE_URL is not defined. Cannot perform backup.');
      return;
    }

    const dateStr = new Date().toISOString().split('T')[0];
    const fileName = `db_backup_${dateStr}.sql`;
    const tempDir = path.join(__dirname, '../../temp');
    
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const filePath = path.join(tempDir, fileName);

    // Use pg_dump to export the database.
    // In Railway, ensure postgresql client is installed via nixpacks.toml.
    const command = `pg_dump "${dbUrl}" -F c -f "${filePath}"`;

    exec(command, async (error, stdout, stderr) => {
      if (error) {
        logger.error(`Database backup failed: ${error.message}`);
        return;
      }
      
      if (stderr) {
        // pg_dump often writes warnings/info to stderr, so we just log it as debug.
        logger.debug(`pg_dump output: ${stderr}`);
      }

      logger.info(`Backup successful, file saved to ${filePath}. Sending email to ${BACKUP_EMAIL}...`);

      try {
        await sendEmail({
          templateKey: 'DB_BACKUP',
          recipient: BACKUP_EMAIL,
          variables: {
            date: dateStr,
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
      } catch (emailError) {
        logger.error(`Failed to send database backup email:`, emailError);
      } finally {
        // Clean up the local file to save storage space
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          logger.info(`Cleaned up temporary backup file: ${filePath}`);
        }
      }
    });
  }, {
    timezone: 'Asia/Kolkata'
  });
}
