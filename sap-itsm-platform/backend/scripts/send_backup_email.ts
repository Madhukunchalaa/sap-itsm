import { sendEmail } from '../src/services/email.service';

async function main() {
  console.log('Starting email dispatch...');
  try {
    await sendEmail({
      templateKey: 'DB_BACKUP',
      recipient: 'mkunchala@intraedge.com',
      variables: { date: new Date().toLocaleDateString() },
      attachments: [
        {
          filename: 'itsm_db_backup_20260716_1149.sql',
          path: './backups/itsm_db_backup_20260716_1149.sql'
        }
      ]
    });
    console.log('Email dispatched successfully to mkunchala@intraedge.com!');
  } catch (error) {
    console.error('Failed to send email:', error);
  }
  process.exit(0);
}

main();
