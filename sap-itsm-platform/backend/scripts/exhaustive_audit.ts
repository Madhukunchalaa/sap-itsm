import { Client } from 'pg';

const connectionString = 'postgresql://postgres:YaUaooNTJoIDDmVbZABkwDeytcOBSguy@tramway.proxy.rlwy.net:31692/railway';

async function exhaustiveAudit() {
  console.log('🔍 Exhaustive Audit of PROVIDED Railway Database...');
  const client = new Client({ connectionString });
  try {
    await client.connect();
    
    // Get all tables in public schema
    const tablesRes = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'");
    const tables = tablesRes.rows.map(r => r.table_name);
    
    console.log('📊 Table Counts:');
    for (const table of tables) {
      const res = await client.query(`SELECT count(*) FROM "public"."${table}"`);
      console.log(`${table.padEnd(25)}: ${res.rows[0].count}`);
    }

    console.log('\n🏢 Tenant Details:');
    const tenants = await client.query('SELECT name, slug FROM public.tenants');
    console.log(tenants.rows);

    console.log('\n🎫 Ticket Details:');
    const tickets = await client.query('SELECT record_number, title, tenant_id FROM public.itsm_records');
    console.log(tickets.rows);

    await client.end();
  } catch (err) {
    console.error('❌ Audit failed:', err.message);
  }
}

exhaustiveAudit();
