import { Client } from 'pg';

const connectionString = 'postgresql://postgres:YaUaooNTJoIDDmVbZABkwDeytcOBSguy@tramway.proxy.rlwy.net:31692/railway';

async function deepAudit() {
  console.log('🔍 Deep Schema Audit of PROVIDED Railway Database...');
  const client = new Client({ connectionString });
  try {
    await client.connect();
    
    // 1. List all schemas
    const schemas = await client.query('SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN (\'information_schema\', \'pg_catalog\')');
    console.log('🌐 Schemas found:', schemas.rows.map(r => r.schema_name));

    // 2. Search for itsm_records in all schemas
    console.log('🔎 Searching for tickets in all schemas...');
    for (const schema of schemas.rows) {
      const s = schema.schema_name;
      try {
        const res = await client.query(`SELECT count(*) FROM "${s}"."itsm_records"`);
        console.log(`Schema "${s}" -> itsm_records: ${res.rows[0].count}`);
        if (res.rows[0].count > 0) {
            const sample = await client.query(`SELECT title FROM "${s}"."itsm_records" LIMIT 1`);
            console.log(`Sample Ticket: ${sample.rows[0].title}`);
        }
      } catch (e) {
        // Table doesn't exist in this schema
      }

      try {
        const tenants = await client.query(`SELECT name FROM "${s}"."tenants"`);
        console.log(`Schema "${s}" -> tenants:`, tenants.rows.map(r => r.name));
      } catch (e) {}
    }

    await client.end();
  } catch (err) {
    console.error('❌ Audit failed:', err.message);
  }
}

deepAudit();
