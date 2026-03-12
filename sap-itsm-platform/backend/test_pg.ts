
import { Client } from 'pg';

async function testConnections() {
  const configs = [
    { user: 'postgres', host: 'localhost', database: 'postgres', password: '', port: 5432 },
    { user: 'postgres', host: 'localhost', database: 'postgres', password: 'postgres', port: 5432 },
    { user: 'itsm_user', host: 'localhost', database: 'itsm_db', password: 'itsm_secret_change_in_prod', port: 5432 }
  ];

  for (const config of configs) {
    console.log(`Testing connection: ${config.user}@${config.host}:${config.port}/${config.database}`);
    const client = new Client(config);
    try {
      await client.connect();
      console.log('✅ Connection successful!');
      await client.end();
      return;
    } catch (e) {
      console.log(`❌ Failed: ${e.message}`);
    }
  }
  console.log('No default connections succeeded.');
}

testConnections();
