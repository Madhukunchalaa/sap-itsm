import { Client } from 'pg';

const connectionString = 'postgresql://postgres:YaUaooNTJoIDDmVbZABkwDeytcOBSguy@tramway.proxy.rlwy.net:31692/railway';

async function auditDB() {
  console.log('🔍 Auditing PRODUCTION database with raw SQL...');
  const client = new Client({ connectionString });
  try {
    await client.connect();
    
    console.log('📊 Table Row Counts:');
    const tables = [
      'tenants', 'users', 'agents', 'itsm_records', 'comments', 
      'time_entries', 'sla_tracking', 'audit_logs'
    ];

    for (const table of tables) {
      try {
        const res = await client.query(`SELECT count(*) FROM ${table}`);
        console.log(`${table.padEnd(15)}: ${res.rows[0].count}`);
      } catch (e) {
        console.log(`${table.padEnd(15)}: ERROR - ${e.message}`);
      }
    }

    const tickets = await client.query('SELECT "record_number", "title" FROM itsm_records LIMIT 5');
    if (tickets.rows.length > 0) {
      console.log('⚠️ Tickets found via Raw SQL:', tickets.rows);
    } else {
      console.log('✅ No tickets found via Raw SQL.');
    }

    await client.end();
  } catch (err) {
    console.error('❌ Audit failed:', err.message);
  }
}

auditDB();
