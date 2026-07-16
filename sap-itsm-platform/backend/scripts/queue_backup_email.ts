import 'dotenv/config';
import { emailQueue } from '../src/workers/queues';

async function main() {
  await emailQueue.add('sendEmail', {
    event: 'DB_BACKUP',
    recipient: 'mkunchala@intraedge.com',
    variables: { date: new Date().toLocaleDateString() },
    attachments: [
      {
        filename: 'itsm_db_backup_20260716_1149.sql',
        path: './backups/itsm_db_backup_20260716_1149.sql'
      }
    ]
  });
  console.log('Successfully pushed DB_BACKUP job to emailQueue!');
  process.exit(0);
}

main().catch(console.error);
