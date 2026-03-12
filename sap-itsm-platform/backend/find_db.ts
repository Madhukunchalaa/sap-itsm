
import { Client } from 'pg';

async function findLocalConnection() {
  const commonConfigs = [
    { user: 'postgres', host: 'localhost', database: 'postgres', password: 'postgres', port: 5432 },
    { user: 'postgres', host: 'localhost', database: 'postgres', password: '', port: 5432 },
    { user: 'postgres', host: 'localhost', database: 'sap_itsm', password: 'postgres', port: 5432 },
    { user: 'postgres', host: 'localhost', database: 'sap_itsm', password: '', port: 5432 },
    { user: 'postgres', host: 'localhost', database: 'itsm_db', password: 'postgres', port: 5432 },
    { user: 'postgres', host: 'localhost', database: 'itsm_db', password: '', port: 5432 },
  ];

  for (const config of commonConfigs) {
    console.log(`Testing: ${config.user}:${config.password}@localhost:${config.port}/${config.database}`);
    const client = new Client(config);
    try {
      await client.connect();
      console.log('✅ SUCCESS!');
      await client.end();
      // Print the winning connection string in a way I can parse
      console.log(`WINNER: postgresql://${config.user}:${config.password}@localhost:${config.port}/${config.database}`);
      return;
    } catch (e) {
      console.log(`❌ Fail: ${e.message}`);
    }
  }
  console.log('No default connection found.');
}

findLocalConnection();
