import { Client } from 'pg';

async function test() {
  const configs = [
    'postgresql://postgres:YaUaooNTJoIDDmVbZABkwDeytcOBSguy@ballast.proxy.rlwy.net:45865/railway',
    'postgresql://postgres:YaUaooNTJoIDDmVbZABkwDeytcOBSguy@ballast.proxy.rlwy.net:45865/postgres'
  ];

  for (const url of configs) {
    console.log(`🔍 Testing: ${url.split('@')[1]}`);
    const client = new Client({ connectionString: url });
    try {
      await client.connect();
      console.log('✅ Success!');
      await client.end();
      return;
    } catch (e) {
      console.log(`❌ Fail: ${e.message}`);
    }
  }
}

test();
