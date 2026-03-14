import { Client } from 'pg';
import * as fs from 'fs';

const connectionString = 'postgresql://postgres:YaUaooNTJoIDDmVbZABkwDeytcOBSguy@tramway.proxy.rlwy.net:31692/railway';
const auditLogFile = '/tmp/audit_results.json';

async function definitiveFileAudit() {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    
    // Check tenants
    const tenants = await client.query('SELECT name, slug FROM public.tenants');
    
    // Check tickets
    const tickets = await client.query('SELECT record_number, title FROM public.itsm_records');
    
    // Check users
    const users = await client.query('SELECT email, role FROM public.users');

    const results = {
      timestamp: new Date().toISOString(),
      tenants: tenants.rows,
      ticketCount: tickets.rows.length,
      tickets: tickets.rows,
      userCount: users.rows.length,
      users: users.rows
    };

    fs.writeFileSync(auditLogFile, JSON.stringify(results, null, 2));
    console.log(`✅ Audit results written to ${auditLogFile}`);

    await client.end();
  } catch (err) {
    console.error('❌ Audit failed:', err.message);
  }
}

definitiveFileAudit();
