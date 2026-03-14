import { Client } from 'pg';

async function findOtherDBs() {
  const url = 'postgresql://postgres:YaUaooNTJoIDDmVbZABkwDeytcOBSguy@tramway.proxy.rlwy.net:31692/postgres';
  console.log('🔍 Listing all databases on Railway host...');
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    const res = await client.query('SELECT datname FROM pg_database WHERE datistemplate = false;');
    console.log('Found databases:', res.rows.map(r => r.datname));
    await client.end();
  } catch (err) {
    console.error('❌ Failed to list databases:', err.message);
  }
}

findOtherDBs();
