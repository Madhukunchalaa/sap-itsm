import { Client } from 'pg';

const connectionString = 'postgresql://postgres:YaUaooNTJoIDDmVbZABkwDeytcOBSguy@tramway.proxy.rlwy.net:31692/railway';

async function definitiveAudit() {
  console.log('🔍 Definitive Audit of tramway.proxy.rlwy.net:31692/railway');
  const client = new Client({ connectionString });
  try {
    await client.connect();
    
    // Check tenants
    const tenants = await client.query('SELECT name, slug FROM public.tenants');
    console.log('🏢 Tenants (public):', tenants.rows);

    // Check tickets
    const tickets = await client.query('SELECT count(*) FROM public.itsm_records');
    console.log('🎫 Tickets (public):', tickets.rows[0].count);

    if (parseInt(tickets.rows[0].count) > 0) {
      const sample = await client.query('SELECT record_number, title FROM public.itsm_records LIMIT 5');
      console.log('📝 Sample Tickets:', sample.rows);
    }

    // Check for other schemas
    const schemas = await client.query("SELECT nspname FROM pg_catalog.pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname != 'information_schema'");
    console.log('🌐 Other Schemas:', schemas.rows.map(r => r.nspname));

    for (const schema of schemas.rows) {
      if (schema.nspname === 'public') continue;
      try {
        const count = await client.query(`SELECT count(*) FROM "${schema.nspname}".itsm_records`);
        console.log(`🎫 Tickets in schema "${schema.nspname}":`, count.rows[0].count);
      } catch (e) {}
    }

    await client.end();
  } catch (err) {
    console.error('❌ Audit failed:', err.message);
  }
}

definitiveAudit();
